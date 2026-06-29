import https from "node:https";
import type {
    ConnectedDevice,
    PanosApiClientOptions,
    SystemInfo,
    VmAuthKeyResult,
} from "../../../types/panosClient.js";

export class PanosApiError extends Error {
    constructor(
        message: string,
        readonly responseBody?: string,
    ) {
        super(message);
        this.name = "PanosApiError";
    }
}

export class PanosApiClient {
    private apiKey: string | null = null;

    constructor(private readonly options: PanosApiClientOptions) {}

    async generateApiKey(username: string, password: string): Promise<string> {
        const body = await this.request({
            type: "keygen",
            user: username,
            password,
        });
        const key = xmlText(body, "key");
        if (!key)
            throw new PanosApiError(
                "PAN-OS keygen response did not include an API key",
                body,
            );
        this.apiKey = key;
        return key;
    }

    setApiKey(apiKey: string): void {
        this.apiKey = apiKey;
    }

    async showSystemInfo(): Promise<SystemInfo> {
        const body = await this.op(
            "<show><system><info></info></system></show>",
        );
        return {
            hostname: xmlText(body, "hostname"),
            serial: xmlText(body, "serial"),
            vmLicense: xmlText(body, "vm-license"),
        };
    }

    async setSerial(serial: string): Promise<void> {
        await this.op(
            `<set><serial-number>${xmlEscape(serial)}</serial-number></set>`,
            {
                ignoreDisconnect: true,
            },
        );
    }

    async setHostname(hostname: string): Promise<void> {
        await this.configSet(
            "/config/devices/entry[@name='localhost.localdomain']/deviceconfig/system",
            `<hostname>${xmlEscape(hostname)}</hostname>`,
        );
    }

    async commit(): Promise<void> {
        const body = await this.request({
            type: "commit",
            cmd: "<commit></commit>",
            key: this.requireApiKey(),
        });
        const jobId = xmlText(body, "job");
        if (jobId) {
            this.log(`PAN-OS commit started (job ${jobId})`);
            await this.waitForJob(jobId, 600_000, `commit job ${jobId}`);
            this.log(`PAN-OS commit finished (job ${jobId})`);
        } else {
            this.log("PAN-OS commit returned no job id (no changes to commit)");
        }
    }

    async fetchLicense(authCode?: string | null): Promise<void> {
        if (authCode) {
            await this.op(
                `<request><license><fetch><auth-code>${xmlEscape(authCode)}</auth-code></fetch></license></request>`,
            );
            return;
        }

        await this.op("<request><license><fetch></fetch></license></request>");
    }

    async setLicenseDeactivationApiKey(apiKey: string): Promise<void> {
        await this.op(
            `<request><license><api-key><set><key>${xmlEscape(apiKey)}</key></set></api-key></license></request>`,
        );
    }

    async deactivateVmSeriesLicense(timeoutMs = 300_000): Promise<void> {
        const body = await this.op(
            "<request><license><deactivate><VM-Capacity><mode>auto</mode></VM-Capacity></deactivate></license></request>",
            { ignoreDisconnect: true },
        );
        const jobId = xmlText(body, "job");
        if (jobId) {
            this.log(`PAN-OS license deactivation started (job ${jobId})`);
            await this.waitForJob(
                jobId,
                timeoutMs,
                `license deactivation job ${jobId}`,
            );
            this.log(`PAN-OS license deactivation finished (job ${jobId})`);
        } else {
            this.log(
                "PAN-OS license deactivation completed (no job id returned)",
            );
        }
    }

    async generateVmAuthKey(lifetimeHours: number): Promise<VmAuthKeyResult> {
        const body = await this.op(
            `<request><bootstrap><vm-auth-key><generate><lifetime>${lifetimeHours}</lifetime></generate></vm-auth-key></bootstrap></request>`,
        );
        const authKey =
            xmlText(body, "authkey") ??
            xmlText(body, "auth-key") ??
            xmlText(body, "vm-auth-key") ??
            textMatch(body, /vm-auth-key\s+([^\s<]+)\s+generated/i) ??
            textMatch(body, /vm\s+auth\s+key\s+([^\s<]+)\s+generated/i) ??
            textMatch(
                body,
                /(?:auth(?:entication)?\s*key|vm-auth-key)\s*[:=]\s*([^\s<]+)/i,
            );
        if (!authKey)
            throw new PanosApiError(
                "VM auth key response did not include an auth key",
                body,
            );

        return {
            authKey,
            expiresAt:
                xmlText(body, "expires") ??
                xmlText(body, "expires-at") ??
                textMatch(body, /expires(?:\s+at)?\s*[:=]\s*([^<\n]+)/i),
        };
    }

    async showConnectedDevices(): Promise<ConnectedDevice[]> {
        const body = await this.op(
            "<show><devices><connected></connected></devices></show>",
        );
        const devicesBySerial = new Map<string, ConnectedDevice>();
        for (const match of body.matchAll(
            /<entry(?:\s+[^>]*)?>([\s\S]*?)<\/entry>/g,
        )) {
            const entry = match[1] ?? "";
            const serial = xmlText(entry, "serial");
            if (!serial) continue;
            if (devicesBySerial.has(serial)) continue;
            devicesBySerial.set(serial, {
                serial,
                hostname: xmlText(entry, "hostname"),
                connected: xmlText(entry, "connected"),
            });
        }

        return [...devicesBySerial.values()];
    }

    async ensureTemplate(templateName: string): Promise<void> {
        await this.configSet(
            panoramaBaseXpath("template"),
            `<entry name="${xmlEscape(templateName)}"></entry>`,
        );
    }

    async ensureTemplateStack(
        templateStackName: string,
        templateName: string,
    ): Promise<void> {
        await this.configSet(
            panoramaBaseXpath("template-stack"),
            [
                `<entry name="${xmlEscape(templateStackName)}">`,
                "<settings></settings>",
                "<templates>",
                `<member>${xmlEscape(templateName)}</member>`,
                "</templates>",
                "</entry>",
            ].join(""),
        );
    }

    async addDeviceToTemplateStack(
        templateStackName: string,
        serial: string,
    ): Promise<void> {
        await this.configSet(
            `${panoramaBaseXpath("template-stack")}/entry[@name='${xpathLiteral(templateStackName)}']/devices`,
            `<entry name="${xmlEscape(serial)}"></entry>`,
        );
    }

    async ensureDeviceGroup(deviceGroupName: string): Promise<void> {
        await this.configSet(
            panoramaBaseXpath("device-group"),
            `<entry name="${xmlEscape(deviceGroupName)}"></entry>`,
        );
    }

    async addDeviceToDeviceGroup(
        deviceGroupName: string,
        serial: string,
        vsys = "vsys1",
    ): Promise<void> {
        await this.configSet(
            `${panoramaBaseXpath("device-group")}/entry[@name='${xpathLiteral(deviceGroupName)}']/devices`,
            [
                `<entry name="${xmlEscape(serial)}">`,
                "<vsys>",
                `<entry name="${xmlEscape(vsys)}"></entry>`,
                "</vsys>",
                "</entry>",
            ].join(""),
        );
    }

    async commitAllTemplateStack(
        templateStackName: string,
        serials: string[],
        timeoutMs = 1_200_000,
    ): Promise<void> {
        if (!serials.length)
            throw new Error(
                "Template stack push needs at least one firewall serial",
            );
        const members = serials
            .map((serial) => `<member>${xmlEscape(serial)}</member>`)
            .join("");
        await this.commitAll(
            [
                "<commit-all>",
                "<template-stack>",
                `<name>${xmlEscape(templateStackName)}</name>`,
                `<device>${members}</device>`,
                "</template-stack>",
                "</commit-all>",
            ].join(""),
            timeoutMs,
            `template-stack push ${templateStackName}`,
        );
    }

    async commitAllDeviceGroup(
        deviceGroupName: string,
        devices: { serial: string; vsys: string }[],
        timeoutMs = 1_200_000,
    ): Promise<void> {
        if (!devices.length)
            throw new Error(
                "Device group push needs at least one firewall serial",
            );
        const entries = devices
            .map((device) =>
                [
                    `<entry name="${xmlEscape(device.serial)}">`,
                    "<vsys>",
                    `<member>${xmlEscape(device.vsys)}</member>`,
                    "</vsys>",
                    "</entry>",
                ].join(""),
            )
            .join("");

        await this.commitAll(
            [
                "<commit-all>",
                "<shared-policy>",
                "<device-group>",
                `<entry name="${xmlEscape(deviceGroupName)}">`,
                `<devices>${entries}</devices>`,
                "</entry>",
                "</device-group>",
                "</shared-policy>",
                "</commit-all>",
            ].join(""),
            timeoutMs,
            `device-group push ${deviceGroupName}`,
        );
    }

    async waitForJob(
        jobId: string,
        timeoutMs = 600_000,
        label?: string,
    ): Promise<void> {
        const what = label ?? `job ${jobId}`;
        const deadline = Date.now() + timeoutMs;
        let lastProgress: string | null = null;
        while (Date.now() < deadline) {
            const body = await this.op(
                `<show><jobs><id>${xmlEscape(jobId)}</id></jobs></show>`,
            );
            const status = firstLeafXmlText(body, "status");
            const result = firstLeafXmlText(body, "result");
            const progress = firstLeafXmlText(body, "progress");
            if (status === "FIN") {
                if (!result || result === "OK") return;
                throw new PanosApiError(
                    `PAN-OS ${what} finished with result ${result}`,
                    body,
                );
            }
            // Emit a poll line only when progress advances, to keep logs readable while
            // still making a stalled job obvious from broker output (spec 3.1 item 5).
            if (progress && progress !== lastProgress) {
                this.log(
                    `PAN-OS ${what} progress ${progress}% (status ${status ?? "ACT"})`,
                );
                lastProgress = progress;
            }
            await sleep(10_000);
        }

        throw new PanosApiError(`Timed out waiting for PAN-OS ${what}`);
    }

    async op(
        cmd: string,
        options: { ignoreDisconnect?: boolean } = {},
    ): Promise<string> {
        return await this.request(
            {
                type: "op",
                cmd,
                key: this.requireApiKey(),
            },
            options,
        );
    }

    async configSet(xpath: string, element: string): Promise<void> {
        await this.request({
            type: "config",
            action: "set",
            xpath,
            element,
            key: this.requireApiKey(),
        });
    }

    private async commitAll(
        cmd: string,
        timeoutMs: number,
        label = "commit-all",
    ): Promise<void> {
        const body = await this.request({
            type: "commit",
            action: "all",
            cmd,
            key: this.requireApiKey(),
        });
        const jobId = xmlText(body, "job");
        if (!jobId)
            throw new PanosApiError(
                "PAN-OS commit-all response did not include a job id",
                body,
            );
        this.log(`PAN-OS ${label} started (job ${jobId})`);
        await this.waitForJob(jobId, timeoutMs, `${label} job ${jobId}`);
        this.log(`PAN-OS ${label} finished (job ${jobId})`);
    }

    private log(message: string): void {
        this.options.log?.(message);
    }

    private requireApiKey(): string {
        if (!this.apiKey)
            throw new Error("PAN-OS API key has not been generated");
        return this.apiKey;
    }

    private async request(
        params: Record<string, string>,
        options: { ignoreDisconnect?: boolean } = {},
    ): Promise<string> {
        const body = new URLSearchParams(params).toString();
        const timeoutMs = this.options.timeoutMs ?? 60_000;

        return await new Promise<string>((resolve, reject) => {
            const request = https.request(
                {
                    host: this.options.host,
                    port: this.options.port ?? 443,
                    path: "/api/",
                    method: "POST",
                    rejectUnauthorized:
                        this.options.rejectUnauthorized ?? false,
                    timeout: timeoutMs,
                    headers: {
                        "content-type": "application/x-www-form-urlencoded",
                        "content-length": Buffer.byteLength(body),
                    },
                },
                (response) => {
                    let responseBody = "";
                    response.setEncoding("utf8");
                    response.on("data", (chunk: string) => {
                        responseBody += chunk;
                    });
                    response.on("end", () => {
                        try {
                            assertPanosSuccess(responseBody);
                            resolve(responseBody);
                        } catch (error) {
                            reject(error);
                        }
                    });
                },
            );

            request.on("timeout", () => {
                request.destroy(
                    new Error(
                        `PAN-OS API request to ${this.options.host} timed out`,
                    ),
                );
            });
            request.on("error", (error: NodeJS.ErrnoException) => {
                if (
                    options.ignoreDisconnect &&
                    ["ECONNRESET", "EPIPE", "ETIMEDOUT"].includes(
                        error.code ?? "",
                    )
                ) {
                    resolve("");
                    return;
                }
                reject(error);
            });
            request.write(body);
            request.end();
        });
    }
}

function panoramaBaseXpath(
    child: "device-group" | "template" | "template-stack",
): string {
    return `/config/devices/entry[@name='localhost.localdomain']/${child}`;
}

function xpathLiteral(value: string): string {
    if (value.includes("'")) {
        throw new Error(
            `PAN-OS xpath values cannot include single quotes: ${value}`,
        );
    }
    return value;
}

function assertPanosSuccess(body: string): void {
    if (/<response\b[^>]*\bstatus\s*=\s*["']success["']/i.test(body)) return;
    const message =
        xmlText(body, "msg") ?? xmlText(body, "line") ?? stripXml(body).trim();
    throw new PanosApiError(message || "PAN-OS API request failed", body);
}

export function xmlText(body: string, tagName: string): string | null {
    const escaped = tagName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = body.match(
        new RegExp(
            `<${escaped}(?:\\s+[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`,
            "i",
        ),
    );
    return match?.[1] ? xmlUnescape(stripXml(match[1]).trim()) : null;
}

function firstLeafXmlText(body: string, tagName: string): string | null {
    const escaped = tagName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const matches = [
        ...body.matchAll(
            new RegExp(
                `<${escaped}(?:\\s+[^>]*)?>([^<>]*)<\\/${escaped}>`,
                "gi",
            ),
        ),
    ];
    const value = matches[0]?.[1];
    return value ? xmlUnescape(stripXml(value).trim()) : null;
}

export function xmlEscape(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

function xmlUnescape(value: string): string {
    return value
        .replace(/&apos;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&gt;/g, ">")
        .replace(/&lt;/g, "<")
        .replace(/&amp;/g, "&");
}

function textMatch(body: string, pattern: RegExp): string | null {
    const match = stripXml(body).match(pattern);
    return match?.[1]?.trim() ?? null;
}

function stripXml(value: string): string {
    return value.replace(/<[^>]+>/g, " ");
}

async function sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
}
