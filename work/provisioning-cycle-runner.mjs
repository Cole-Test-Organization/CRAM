#!/usr/bin/env node
import { appendFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const API_BASE = process.env.PROVISIONING_API_BASE ?? "http://127.0.0.1:3200/api";
const POLL_MS = Number(process.env.PROVISIONING_POLL_MS ?? "15000");
const REPORT = path.resolve("work/provisioning-run-report-2026-06-26.jsonl");
const FINAL = path.resolve("work/provisioning-run-summary-2026-06-26.md");
const DEACTIVATION_SECRET = "PANW_LICENSE_DEACTIVATION_API_KEY";

const args = parseArgs(process.argv.slice(2));
const results = [];

writeFileSync(REPORT, "");

function parseArgs(argv) {
  const out = { deployments: null, skip: new Set() };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--deployments") {
      out.deployments = (argv[++i] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    } else if (arg === "--skip") {
      out.skip = new Set((argv[++i] ?? "").split(",").map((s) => s.trim()).filter(Boolean));
    } else {
      throw new Error(`Unknown argument ${arg}`);
    }
  }
  return out;
}

function emit(type, data = {}) {
  const entry = { ts: new Date().toISOString(), type, ...data };
  appendFileSync(REPORT, `${JSON.stringify(entry)}\n`);
  const label = data.deployment ? ` ${data.deployment}` : "";
  const message = data.message ?? data.status ?? "";
  console.log(`[${entry.ts}] ${type}${label}${message ? `: ${message}` : ""}`);
}

async function api(pathname, options = {}) {
  const res = await fetch(`${API_BASE}${pathname}`, {
    method: options.method ?? "GET",
    headers: options.body ? { "content-type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await res.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!res.ok) {
    const error = typeof body === "object" && body?.error ? body.error : text || res.statusText;
    throw new Error(`${res.status} ${res.statusText}: ${error}`);
  }
  return body;
}

async function enqueue(deployment, action, params = {}) {
  const job = await api(`/provisioning/deployments/${encodeURIComponent(deployment)}/${action}`, {
    method: "POST",
    body: { params },
  });
  emit("job-queued", { deployment, action, jobId: job.id, status: job.status });
  return job.id;
}

async function waitJob(jobId, deployment, action) {
  let lastLogCount = 0;
  let lastStatus = null;
  for (;;) {
    const job = await api(`/provisioning/jobs/${encodeURIComponent(jobId)}`);
    if (job.status !== lastStatus) {
      emit("job-status", { deployment, action, jobId, status: job.status });
      lastStatus = job.status;
    }
    const logs = Array.isArray(job.logs) ? job.logs : [];
    for (const line of logs.slice(lastLogCount)) {
      emit("job-log", { deployment, action, jobId, message: line });
    }
    lastLogCount = logs.length;
    if (["succeeded", "failed", "canceled"].includes(job.status)) return job;
    await sleep(POLL_MS);
  }
}

async function runJob(deployment, action, params = {}) {
  const jobId = await enqueue(deployment, action, params);
  return waitJob(jobId, deployment, action);
}

async function deploymentResources(deployment) {
  const resources = await api("/provisioning/resources");
  return resources.filter((resource) => resource.deploymentId === deployment);
}

function liveResources(resources) {
  return resources.filter((resource) => resource.lifecycleStatus !== "destroyed");
}

function launchParams(detail) {
  const params = {};
  for (const input of detail.inputs ?? []) {
    if (input.source === "step-condition" && input.type === "boolean") {
      params[input.name] = input.enablesWhen ?? true;
    } else if (Object.hasOwn(input, "default")) {
      params[input.name] = input.default;
    }
  }
  return params;
}

async function verifyDeployment(detail) {
  const resources = await deploymentResources(detail.id);
  const live = liveResources(resources);
  emit("verify", {
    deployment: detail.id,
    status: "resources",
    message: `${live.length} live resource(s): ${live.map((r) => `${r.hostname}/${r.kind}/${r.lifecycleStatus}`).join(", ")}`,
  });

  if (live.length === 0) {
    throw new Error("deploy job succeeded but no live resources were recorded");
  }

  for (const resource of live) {
    try {
      const refreshed = await api(`/provisioning/resources/${encodeURIComponent(resource.id)}/power-state`);
      emit("power-state", {
        deployment: detail.id,
        target: resource.hostname,
        status: refreshed.powerState ?? "unknown",
      });
    } catch (error) {
      emit("power-state-skipped", {
        deployment: detail.id,
        target: resource.hostname,
        message: error.message,
      });
    }
  }
}

async function ensureTornDown(deployment, reason) {
  const before = liveResources(await deploymentResources(deployment));
  if (!before.length) {
    emit("teardown-skip", { deployment, message: `no live resources (${reason})` });
    return { status: "succeeded", skipped: true };
  }
  emit("teardown-start", {
    deployment,
    message: `${reason}: ${before.map((r) => `${r.hostname}/${r.lifecycleStatus}`).join(", ")}`,
  });
  const job = await runJob(deployment, "deprovision", {});
  const after = liveResources(await deploymentResources(deployment));
  if (after.length) {
    emit("teardown-leftovers", {
      deployment,
      message: after.map((r) => `${r.hostname}/${r.lifecycleStatus}`).join(", "),
    });
  }
  return job;
}

async function runDeployment(detail) {
  const params = launchParams(detail);
  const result = {
    deployment: detail.id,
    provider: detail.provider,
    deployStatus: "not-run",
    retryStatus: null,
    deprovisionStatus: "not-run",
    error: null,
  };

  try {
    await ensureTornDown(detail.id, "pre-clean");

    emit("deploy-start", {
      deployment: detail.id,
      message: Object.keys(params).length ? `params=${JSON.stringify(params)}` : "default params",
    });
    let deploy = await runJob(detail.id, "deploy", params);
    result.deployStatus = deploy.status;

    if (deploy.status !== "succeeded") {
      result.error = deploy.error ?? `deploy ended with ${deploy.status}`;
      emit("deploy-failed", { deployment: detail.id, message: result.error });
      await ensureTornDown(detail.id, "after failed deploy");

      emit("deploy-retry-start", { deployment: detail.id, message: "retrying once after teardown" });
      deploy = await runJob(detail.id, "deploy", params);
      result.retryStatus = deploy.status;
      if (deploy.status !== "succeeded") {
        result.error = deploy.error ?? `retry ended with ${deploy.status}`;
        emit("deploy-retry-failed", { deployment: detail.id, message: result.error });
        await ensureTornDown(detail.id, "after failed retry");
        return result;
      }
    }

    await verifyDeployment(detail);
    const teardown = await ensureTornDown(detail.id, "post-verify");
    result.deprovisionStatus = teardown.status;
    return result;
  } catch (error) {
    result.error = error.message;
    emit("deployment-error", { deployment: detail.id, message: error.message });
    try {
      const teardown = await ensureTornDown(detail.id, "after exception");
      result.deprovisionStatus = teardown.status;
    } catch (teardownError) {
      emit("teardown-error", { deployment: detail.id, message: teardownError.message });
      result.deprovisionStatus = "failed";
      result.error = `${result.error}; teardown: ${teardownError.message}`;
    }
    return result;
  }
}

async function main() {
  emit("start", { message: `api=${API_BASE}` });
  const deployments = await api("/provisioning/deployments");
  const secrets = await api("/provisioning/secrets");
  const storedSecrets = new Set(secrets.map((secret) => secret.name));
  const selectedIds = args.deployments ?? deployments.filter((d) => d.deployable).map((d) => d.id);

  const details = [];
  for (const id of selectedIds) {
    if (args.skip.has(id)) continue;
    const detail = await api(`/provisioning/deployments/${encodeURIComponent(id)}`);
    const missing = (detail.requiredEnv ?? []).filter((name) => !storedSecrets.has(name));
    if (missing.length) {
      emit("preflight-missing-secret", { deployment: id, message: missing.join(", ") });
      results.push({ deployment: id, deployStatus: "skipped", deprovisionStatus: "not-run", error: `missing secrets: ${missing.join(", ")}` });
      continue;
    }
    if (detail.resourceKinds?.includes("panw-vmseries") && !detail.requiredEnv?.includes(DEACTIVATION_SECRET)) {
      emit("preflight-missing-deactivation", { deployment: id, message: `${DEACTIVATION_SECRET} not in requiredEnv` });
      results.push({ deployment: id, deployStatus: "skipped", deprovisionStatus: "not-run", error: `${DEACTIVATION_SECRET} not required` });
      continue;
    }
    details.push(detail);
  }

  emit("preflight-complete", { message: `${details.length} deployment(s) ready` });
  for (const detail of details) {
    emit("deployment-start", { deployment: detail.id, message: `${detail.provider}; ${detail.resourceKinds.join(",")}` });
    const result = await runDeployment(detail);
    results.push(result);
    emit("deployment-complete", { deployment: detail.id, status: result.error ? "failed" : "succeeded", message: result.error ?? "ok" });
  }

  writeSummary(results);
  emit("complete", { message: `summary=${FINAL}` });
  if (results.some((result) => result.error)) process.exitCode = 1;
}

function writeSummary(items) {
  const lines = [
    "# Provisioning Run Summary - 2026-06-26",
    "",
    `API: ${API_BASE}`,
    "",
    "| Deployment | Provider | Deploy | Retry | Deprovision | Error |",
    "|---|---|---:|---:|---:|---|",
  ];
  for (const item of items) {
    lines.push(`| ${item.deployment} | ${item.provider ?? ""} | ${item.deployStatus} | ${item.retryStatus ?? ""} | ${item.deprovisionStatus} | ${escapeCell(item.error ?? "")} |`);
  }
  lines.push("");
  lines.push(`Detailed JSONL log: ${REPORT}`);
  writeFileSync(FINAL, `${lines.join("\n")}\n`);
}

function escapeCell(value) {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  emit("fatal", { message: error.stack ?? error.message });
  process.exitCode = 1;
});
