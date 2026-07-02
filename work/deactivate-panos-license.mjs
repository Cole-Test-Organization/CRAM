#!/usr/bin/env node
import fs from "node:fs";
import https from "node:https";

const host = process.argv[2];
if (!host) {
  console.error("usage: node work/deactivate-panos-license.mjs <management-host>");
  process.exit(2);
}

const env = readEnvFile("api/src/services/provisioning/.env");
const username = env.PANOS_ADMIN_USERNAME || "admin";
const password = env.PANOS_ADMIN_PASSWORD;
const deactivationApiKey = env.PANW_LICENSE_DEACTIVATION_API_KEY;

if (!password) throw new Error("PANOS_ADMIN_PASSWORD is missing");
if (!deactivationApiKey) throw new Error("PANW_LICENSE_DEACTIVATION_API_KEY is missing");

async function main() {
  const api = new PanosApi(host);
  await retry("PAN-OS API keygen", 20, 15_000, async () => {
    await api.keygen(username, password);
  });

  let serial = null;
  try {
    const info = await api.systemInfo();
    serial = info.serial;
    console.log(
      `system-info host=${info.hostname ?? "unknown"} serial=${serial ?? "unknown"} vmLicense=${info.vmLicense ?? "unknown"}`,
    );
    if (!info.vmLicense || ["none", "unknown"].includes(info.vmLicense.toLowerCase())) {
      console.log("license-state=no-active-license");
      return;
    }
  } catch (error) {
    console.log(`system-info failed; proceeding with deactivation: ${error.message}`);
  }

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      console.log(`deactivation-attempt=${attempt}/4${serial ? ` serial=${serial}` : ""}`);
      try {
        await api.setDeactivationApiKey(deactivationApiKey);
      } catch (error) {
        if (/API key is same as old/i.test(error.message)) {
          console.log("deactivation-api-key=already-set");
        } else {
          throw error;
        }
      }
      await api.deactivate();
      console.log(`deactivation-result=success${serial ? ` serial=${serial}` : ""}`);
      return;
    } catch (error) {
      const retryable = /Invalid or missing deactivation token|support account|API key is same as old/i.test(error.message);
      console.log(`deactivation-result=failed attempt=${attempt}/4 error=${error.message}`);
      if (attempt === 4 || !retryable) throw error;
      await sleep(60_000);
    }
  }
}

function readEnvFile(path) {
  const values = {};
  const text = fs.readFileSync(path, "utf8");
  for (const line of text.split(/\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2] ?? "";
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

class PanosApi {
  constructor(hostname) {
    this.hostname = hostname;
    this.key = null;
  }

  async keygen(user, password) {
    const body = await this.request({ type: "keygen", user, password });
    const key = xmlText(body, "key");
    if (!key) throw new Error("keygen response did not include a key");
    this.key = key;
  }

  async systemInfo() {
    const body = await this.op("<show><system><info></info></system></show>");
    return {
      hostname: xmlText(body, "hostname"),
      serial: xmlText(body, "serial"),
      vmLicense: xmlText(body, "vm-license"),
    };
  }

  async setDeactivationApiKey(key) {
    await this.op(
      `<request><license><api-key><set><key>${xmlEscape(key)}</key></set></api-key></license></request>`,
    );
  }

  async deactivate() {
    const body = await this.op(
      "<request><license><deactivate><VM-Capacity><mode>auto</mode></VM-Capacity></deactivate></license></request>",
    );
    const job = xmlText(body, "job");
    if (job) {
      console.log(`deactivation-job=${job}`);
      await this.waitForJob(job, 300_000);
    }
  }

  async waitForJob(job, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const body = await this.op(`<show><jobs><id>${xmlEscape(job)}</id></jobs></show>`);
      const status = xmlText(body, "status");
      const result = xmlText(body, "result");
      const progress = xmlText(body, "progress");
      console.log(`deactivation-job=${job} status=${status ?? "unknown"} progress=${progress ?? "unknown"}`);
      if (status === "FIN") {
        if (!result || result === "OK") return;
        throw new Error(`job ${job} finished with result ${result}: ${failureDetails(body)}`);
      }
      await sleep(10_000);
    }
    throw new Error(`timed out waiting for job ${job}`);
  }

  async op(cmd) {
    if (!this.key) throw new Error("PAN-OS API key has not been generated");
    return await this.request({ type: "op", cmd, key: this.key });
  }

  async request(params) {
    const body = new URLSearchParams(params).toString();
    return await new Promise((resolve, reject) => {
      const req = https.request(
        {
          host: this.hostname,
          port: 443,
          path: "/api/",
          method: "POST",
          rejectUnauthorized: false,
          timeout: 60_000,
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            "content-length": Buffer.byteLength(body),
          },
        },
        (res) => {
          let responseBody = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => {
            responseBody += chunk;
          });
          res.on("end", () => {
            if (/<response\b[^>]*\bstatus\s*=\s*["']success["']/i.test(responseBody)) {
              resolve(responseBody);
              return;
            }
            reject(new Error(xmlText(responseBody, "msg") || stripXml(responseBody).trim() || "PAN-OS API request failed"));
          });
        },
      );
      req.on("timeout", () => req.destroy(new Error(`PAN-OS API request to ${this.hostname} timed out`)));
      req.on("error", reject);
      req.write(body);
      req.end();
    });
  }
}

async function retry(label, attempts, delayMs, fn) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await fn();
      return;
    } catch (error) {
      lastError = error;
      console.log(`${label} attempt=${attempt}/${attempts} error=${error.message}`);
      if (attempt !== attempts) await sleep(delayMs);
    }
  }
  throw lastError;
}

function xmlText(body, tag) {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = body.match(new RegExp(`<${escaped}(?:\\s+[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, "i"));
  return match?.[1] ? xmlUnescape(stripXml(match[1]).trim()) : null;
}

function failureDetails(body) {
  return [xmlText(body, "details"), xmlText(body, "warnings"), xmlText(body, "line"), xmlText(body, "msg")]
    .filter(Boolean)
    .join("; ");
}

function stripXml(value) {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}

function xmlEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function xmlUnescape(value) {
  return value
    .replaceAll("&apos;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&gt;", ">")
    .replaceAll("&lt;", "<")
    .replaceAll("&amp;", "&");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

await main();
