import type {
  DeploymentConfig,
  PanoramaResourceConfig,
  PanosBootstrapConfig,
  PanwVmseriesResourceConfig,
  ResourceRecord,
} from "../../../types/index.js";
import type {
  FirewallBootstrapResult,
  FirewallConfigAddOnInput,
  FirewallConfigAddOnResult,
  FirewallDeactivationResult,
  FirewallVerificationResult,
  PanoramaConfigAddOnInput,
  PanoramaConfigAddOnResult,
  PanoramaBootstrapResult,
  PanoramaOnboardingResult,
  ResolvedBootstrapSettings,
} from "../../../types/panwBootstrapService.js";
import type { PanoramaConfigPushConfig } from "../../../types/panw.js";
import type { ConnectedDevice, VmAuthKeyResult } from "../../../types/panosClient.js";
import type { LogFn } from "../../../types/logging.js";
import { optionalEnv, requireEnv } from "../../../utils/index.js";
import { PanosApiClient } from "./client.js";
import { setInitialAdminPassword } from "./ssh.js";

export class PanwBootstrapService {
  async bootstrapPanorama(
    deployment: DeploymentConfig,
    resource: PanoramaResourceConfig,
    record: ResourceRecord,
    outputs: Record<string, unknown>,
    log: LogFn,
  ): Promise<PanoramaBootstrapResult> {
    const managementAddress = resolvePanoramaManagementAddress(outputs);
    const settings = resolveBootstrapSettings(resource.bootstrap);
    const client = new PanosApiClient({
      host: managementAddress,
      port: settings.apiPort,
      rejectUnauthorized: settings.tlsRejectUnauthorized,
      log,
    });

    await ensureApiAccess(client, managementAddress, settings, log);

    const serial = resolvePanoramaSerial(resource);
    log(`Setting Panorama serial for ${resource.hostname}`);
    await client.setSerial(serial);
    await waitForApiAccess(client, settings, log);

    log(`Setting Panorama hostname to ${resource.hostname}`);
    await client.setHostname(resource.hostname);
    await client.commit();

    log(`Fetching Panorama license for ${resource.hostname}`);
    await client.fetchLicense();
    await waitForLicensedPanorama(client, settings, log);

    let authKeyResult: VmAuthKeyResult | null = null;
    if (settings.generateVmAuthKey) {
      log(`Generating Panorama VM auth key for ${deployment.name}`);
      authKeyResult = await client.generateVmAuthKey(settings.vmAuthKeyLifetimeHours);
    }

    return {
      managementAddress,
      vmAuthKey: authKeyResult?.authKey ?? record.panos?.vmAuthKey ?? null,
      vmAuthKeyExpiresAt: authKeyResult?.expiresAt ?? record.panos?.vmAuthKeyExpiresAt ?? null,
    };
  }

  async verifyFirewallsConnected(
    resource: PanoramaResourceConfig,
    outputs: Record<string, unknown>,
    expectedFirewalls: PanwVmseriesResourceConfig[],
    log: LogFn,
  ): Promise<FirewallVerificationResult> {
    const managementAddress = resolvePanoramaManagementAddress(outputs);
    const settings = resolveBootstrapSettings(resource.bootstrap);
    const client = new PanosApiClient({
      host: managementAddress,
      port: settings.apiPort,
      rejectUnauthorized: settings.tlsRejectUnauthorized,
      log,
    });

    await waitForApiAccess(client, settings, log);

    const expectedCount = expectedFirewalls.length;
    const deadline = Date.now() + settings.readinessTimeoutMs;
    while (Date.now() < deadline) {
      const devices = await client.showConnectedDevices();
      if (devices.length >= expectedCount) {
        return {
          managementAddress,
          connectedDeviceCount: devices.length,
        };
      }
      log(`Panorama sees ${devices.length}/${expectedCount} connected firewall(s); waiting`);
      await sleep(30_000);
    }

    throw new Error(
      `Timed out waiting for ${expectedCount} firewall(s) to connect to Panorama ${resource.hostname}`,
    );
  }

  async onboardFirewalls(
    deployment: DeploymentConfig,
    resource: PanoramaResourceConfig,
    outputs: Record<string, unknown>,
    expectedFirewalls: PanwVmseriesResourceConfig[],
    log: LogFn,
  ): Promise<PanoramaOnboardingResult> {
    const managementAddress = resolvePanoramaManagementAddress(outputs);
    const settings = resolveBootstrapSettings(resource.bootstrap);
    const onboarding = resolveOnboardingConfig(deployment.name, resource);
    const client = new PanosApiClient({
      host: managementAddress,
      port: settings.apiPort,
      rejectUnauthorized: settings.tlsRejectUnauthorized,
      log,
    });

    await waitForApiAccess(client, settings, log);
    const devices = await client.showConnectedDevices();
    const firewalls = selectOnboardingFirewalls(expectedFirewalls, onboarding.firewalls);
    const serials = resolveConnectedFirewallSerials(firewalls, devices);

    log(`Ensuring Panorama template ${onboarding.template}`);
    await client.ensureTemplate(onboarding.template);
    log(`Ensuring Panorama template stack ${onboarding.templateStack}`);
    await client.ensureTemplateStack(onboarding.templateStack, onboarding.template);
    for (const serial of serials) {
      log(`Adding firewall ${serial} to template stack ${onboarding.templateStack}`);
      await client.addDeviceToTemplateStack(onboarding.templateStack, serial);
    }

    log(`Ensuring Panorama device group ${onboarding.deviceGroup}`);
    await client.ensureDeviceGroup(onboarding.deviceGroup);
    for (const serial of serials) {
      log(`Adding firewall ${serial} to device group ${onboarding.deviceGroup}`);
      await client.addDeviceToDeviceGroup(onboarding.deviceGroup, serial, onboarding.vsys);
    }

    if (onboarding.commit) {
      log("Committing Panorama onboarding config");
      await client.commit();
    } else {
      log("Skipping Panorama commit because onboarding.commit is false");
    }

    return {
      managementAddress,
      connectedDeviceCount: devices.length,
      deviceGroup: onboarding.deviceGroup,
      template: onboarding.template,
      templateStack: onboarding.templateStack,
      firewallSerials: serials,
    };
  }

  async applyConfigAddOns(
    deployment: DeploymentConfig,
    resource: PanoramaResourceConfig,
    outputs: Record<string, unknown>,
    expectedFirewalls: PanwVmseriesResourceConfig[],
    addOns: PanoramaConfigAddOnInput[],
    log: LogFn,
  ): Promise<PanoramaConfigAddOnResult> {
    const managementAddress = resolvePanoramaManagementAddress(outputs);
    const settings = resolveBootstrapSettings(resource.bootstrap);
    const onboarding = resolveOnboardingConfig(deployment.name, resource);
    const client = new PanosApiClient({
      host: managementAddress,
      port: settings.apiPort,
      rejectUnauthorized: settings.tlsRejectUnauthorized,
      log,
    });

    await waitForApiAccess(client, settings, log);
    const devices = await client.showConnectedDevices();
    const variables = configAddOnVariables(deployment, resource, onboarding);
    const appliedAddOns: string[] = [];
    const pushedTemplateStacks = new Set<string>();
    const pushedDeviceGroups = new Set<string>();
    const pushedSerials = new Set<string>();

    for (const addOn of addOns) {
      const operations = parseConfigAddOnXml(addOn.content, addOn.file);

      // Phase 1: load. PAN-OS `action=set` merges named entries, so re-running
      // this step is idempotent — it updates the same nodes in place rather than
      // duplicating rules/objects.
      log(
        `[config-addon ${addOn.name}] load: applying ${operations.length} config set(s) from ${addOn.file}`,
      );
      for (const operation of operations) {
        const xpath = substituteConfigAddOnVariables(operation.xpath, variables, addOn.file);
        const element = substituteConfigAddOnVariables(operation.element, variables, addOn.file);
        log(`[config-addon ${addOn.name}] load: set ${xpath}`);
        await client.configSet(xpath, element);
      }

      // Phase 2: commit to Panorama.
      const shouldCommit = addOn.commit ?? true;
      if (shouldCommit) {
        log(`[config-addon ${addOn.name}] commit: committing candidate config to Panorama`);
        await client.commit();
      } else {
        log(`[config-addon ${addOn.name}] commit: skipped (commit=false)`);
      }

      // Phase 3 + 4: push (commit-all) to template stack / device group and poll
      // the resulting jobs to completion within timeoutSeconds.
      const push = addOn.push;
      const templateStack = resolvePushTarget(push?.templateStack, onboarding.templateStack);
      const deviceGroup = resolvePushTarget(push?.deviceGroup, onboarding.deviceGroup);
      if (templateStack || deviceGroup) {
        if (!shouldCommit) {
          throw new Error(
            `Panorama config add-on ${addOn.name} requests a push but has commit=false; commit is required before pushing`,
          );
        }
        const pushFirewalls = selectOnboardingFirewalls(
          expectedFirewalls,
          stringArrayValue(push?.firewalls) ?? onboarding.firewalls,
        );
        const serials = resolveConnectedFirewallSerials(pushFirewalls, devices);
        const vsys = stringValue(push?.vsys) ?? onboarding.vsys;
        const timeoutMs = pushTimeoutMs(push);
        for (const serial of serials) pushedSerials.add(serial);

        if (templateStack) {
          log(
            `[config-addon ${addOn.name}] push: template-stack ${templateStack} -> ${serials.length} firewall(s)`,
          );
          await client.commitAllTemplateStack(templateStack, serials, timeoutMs);
          pushedTemplateStacks.add(templateStack);
        }
        if (deviceGroup) {
          log(
            `[config-addon ${addOn.name}] push: device-group ${deviceGroup} -> ${serials.length} firewall(s)`,
          );
          await client.commitAllDeviceGroup(
            deviceGroup,
            serials.map((serial) => ({ serial, vsys })),
            timeoutMs,
          );
          pushedDeviceGroups.add(deviceGroup);
        }
      } else {
        log(`[config-addon ${addOn.name}] push: skipped (no template-stack/device-group target)`);
      }

      log(`[config-addon ${addOn.name}] done`);
      appliedAddOns.push(addOn.name);
    }

    return {
      managementAddress,
      appliedAddOns,
      pushedTemplateStack: [...pushedTemplateStacks].join(",") || null,
      pushedDeviceGroup: [...pushedDeviceGroups].join(",") || null,
      firewallSerials: [...pushedSerials],
    };
  }

  async bootstrapFirewall(
    resource: PanwVmseriesResourceConfig,
    outputs: Record<string, unknown>,
    authCode: string,
    log: LogFn,
  ): Promise<FirewallBootstrapResult> {
    const managementAddress = resolveFirewallManagementAddress(outputs);
    const settings = resolveBootstrapSettings(resource.bootstrap);
    const client = new PanosApiClient({
      host: managementAddress,
      port: settings.apiPort,
      rejectUnauthorized: settings.tlsRejectUnauthorized,
      log,
    });

    await ensureApiAccess(client, managementAddress, settings, log);
    log(`Fetching VM-Series license for ${resource.hostname}`);
    try {
      await client.fetchLicense(authCode);
    } catch (error) {
      const existingLicense = await readActiveFirewallLicense(client);
      if (existingLicense) {
        log(
          `VM-Series license fetch failed for ${resource.hostname}, ` +
            `but firewall already reports active license ${existingLicense}; continuing`,
        );
      } else {
      throw new Error(`Failed to fetch VM-Series license for ${resource.hostname}: ${errorMessage(error)}`);
      }
    }
    const vmLicense = await waitForLicensedFirewall(client, resource, settings, log);
    let serial: string | null = null;
    try {
      serial = (await client.showSystemInfo()).serial ?? null;
    } catch {
      // Serial is a convenience for delicense/reporting; failing to read it must
      // not fail bootstrap. Deactivation reads it live again at teardown.
    }
    return { managementAddress, vmLicense, serial };
  }

  async applyFirewallConfigAddOns(
    deployment: DeploymentConfig,
    resource: PanwVmseriesResourceConfig,
    outputs: Record<string, unknown>,
    addOns: FirewallConfigAddOnInput[],
    log: LogFn,
  ): Promise<FirewallConfigAddOnResult> {
    const managementAddress = resolveFirewallManagementAddress(outputs);
    const settings = resolveBootstrapSettings(resource.bootstrap);
    const client = new PanosApiClient({
      host: managementAddress,
      port: settings.apiPort,
      rejectUnauthorized: settings.tlsRejectUnauthorized,
      log,
    });

    await waitForApiAccess(client, settings, log);
    const variables = firewallConfigAddOnVariables(deployment, resource);
    const appliedAddOns: string[] = [];

    for (const addOn of addOns) {
      const operations = parseConfigAddOnXml(addOn.content, addOn.file);

      log(
        `[config-addon ${addOn.name}] load: applying ${operations.length} config set(s) from ${addOn.file}`,
      );
      for (const operation of operations) {
        const xpath = substituteConfigAddOnVariables(operation.xpath, variables, addOn.file);
        const element = substituteConfigAddOnVariables(operation.element, variables, addOn.file);
        log(`[config-addon ${addOn.name}] load: set ${xpath}`);
        await client.configSet(xpath, element);
      }

      const shouldCommit = addOn.commit ?? true;
      if (shouldCommit) {
        log(`[config-addon ${addOn.name}] commit: committing candidate config to firewall`);
        await client.commit();
      } else {
        log(`[config-addon ${addOn.name}] commit: skipped (commit=false)`);
      }

      log(`[config-addon ${addOn.name}] done`);
      appliedAddOns.push(addOn.name);
    }

    return {
      managementAddress,
      appliedAddOns,
    };
  }

  /**
   * Best-effort VM-Series license deactivation, run during teardown while the
   * firewall API is still reachable. Releases Flex/VM-Series credits so a later
   * cold boot does not hit `NOV-021 Insufficient credits`. This never throws —
   * the caller decides whether a failed deactivation should block the destroy.
   */
  async deactivateFirewallLicense(
    resource: PanwVmseriesResourceConfig,
    outputs: Record<string, unknown>,
    log: LogFn,
  ): Promise<FirewallDeactivationResult> {
    // Auto-mode deactivation needs the CSP Licensing API Key. Without it the
    // firewall cannot authenticate to the licensing server, so we skip cleanly
    // (and name the env var to set) rather than fire a call that will fail.
    const deactivationApiKey = resolveDeactivationApiKey(resource);
    if (!deactivationApiKey) {
      const envName = resource.license.deactivationApiKeyEnv;
      return {
        deactivated: false,
        reason:
          "no CSP Licensing API Key configured" +
          (envName ? ` (set ${envName})` : " (set license.deactivationApiKey or license.deactivationApiKeyEnv)"),
      };
    }

    let managementAddress: string;
    try {
      managementAddress = resolveFirewallManagementAddress(outputs);
    } catch (error) {
      return { deactivated: false, reason: `no firewall management address: ${errorMessage(error)}` };
    }

    const settings = resolveBootstrapSettings(resource.bootstrap);
    const client = new PanosApiClient({
      host: managementAddress,
      port: settings.apiPort,
      rejectUnauthorized: settings.tlsRejectUnauthorized,
      log,
    });

    // At teardown the firewall is normally already up, so use a bounded probe
    // window rather than the full readiness timeout: we do not want a dead
    // firewall to stall a destroy for 40 minutes.
    const deactivateProbeMs = Math.min(settings.readinessTimeoutMs, 180_000);
    try {
      await waitForApiAccessBounded(client, settings, deactivateProbeMs);
    } catch (error) {
      return {
        deactivated: false,
        reason: `firewall API not reachable for deactivation: ${errorMessage(error)}`,
      };
    }

    let serial: string | null = null;
    try {
      const info = await client.showSystemInfo();
      serial = info.serial ?? null;
      const vmLicense = info.vmLicense?.trim().toLowerCase() ?? null;
      if (!vmLicense || ["none", "unknown", ""].includes(vmLicense)) {
        return { deactivated: false, serial, reason: "firewall reports no active VM-Series license" };
      }
    } catch (error) {
      // Proceed to attempt deactivation anyway; the deactivate call is the
      // authoritative action even if system-info readback failed.
      log(`Could not read firewall license state before deactivation: ${errorMessage(error)}`);
    }

    try {
      log(
        `Deactivating VM-Series license for ${resource.hostname}` +
          (serial ? ` (serial ${serial})` : ""),
      );
      await client.setLicenseDeactivationApiKey(deactivationApiKey);
      await client.deactivateVmSeriesLicense(300_000);
      return { deactivated: true, serial };
    } catch (error) {
      return { deactivated: false, serial, reason: errorMessage(error) };
    }
  }
}

async function readActiveFirewallLicense(client: PanosApiClient): Promise<string | null> {
  try {
    const systemInfo = await client.showSystemInfo();
    const vmLicense = systemInfo.vmLicense?.trim() ?? null;
    if (vmLicense && !["none", "unknown"].includes(vmLicense.toLowerCase())) return vmLicense;
  } catch {
    return null;
  }
  return null;
}

function resolveDeactivationApiKey(resource: PanwVmseriesResourceConfig): string | null {
  if (resource.license.deactivationApiKey) return resource.license.deactivationApiKey;
  if (resource.license.deactivationApiKeyEnv) {
    return optionalEnv(resource.license.deactivationApiKeyEnv) ?? null;
  }
  return null;
}

interface ResolvedOnboardingConfig {
  deviceGroup: string;
  template: string;
  templateStack: string;
  firewalls: string[] | null;
  vsys: string;
  commit: boolean;
}

export interface ConfigAddOnOperation {
  xpath: string;
  element: string;
}

function resolveOnboardingConfig(
  deploymentName: string,
  resource: PanoramaResourceConfig,
): ResolvedOnboardingConfig {
  const onboarding = resource.onboarding ?? {};
  const templateStack = stringValue(onboarding.templateStack) ?? `${deploymentName}-stack`;
  return {
    deviceGroup: stringValue(onboarding.deviceGroup) ?? `${deploymentName}-dg`,
    template: stringValue(onboarding.template) ?? `${templateStack}-template`,
    templateStack,
    firewalls: stringArrayValue(onboarding.firewalls),
    vsys: stringValue(onboarding.vsys) ?? "vsys1",
    commit: onboarding.commit ?? true,
  };
}

function selectOnboardingFirewalls(
  expectedFirewalls: PanwVmseriesResourceConfig[],
  configuredFirewalls: string[] | null,
): PanwVmseriesResourceConfig[] {
  if (!configuredFirewalls) return expectedFirewalls;
  const byName = new Map<string, PanwVmseriesResourceConfig>();
  for (const firewall of expectedFirewalls) {
    byName.set(firewall.hostname, firewall);
    if (firewall.name) byName.set(firewall.name, firewall);
  }

  return configuredFirewalls.map((name) => {
    const firewall = byName.get(name);
    if (!firewall) {
      throw new Error(`Panorama onboarding references unknown firewall ${name}`);
    }
    return firewall;
  });
}

function resolveConnectedFirewallSerials(
  firewalls: PanwVmseriesResourceConfig[],
  devices: ConnectedDevice[],
): string[] {
  return firewalls.map((firewall) => {
    const device = devices.find((candidate) => {
      if (!candidate.serial) return false;
      const connected = candidate.connected?.toLowerCase();
      if (connected && connected !== "yes") return false;
      return candidate.hostname === firewall.hostname || candidate.hostname === firewall.name;
    });
    if (!device?.serial) {
      const seen = devices
        .map((candidate) => `${candidate.hostname ?? "(unknown)"}:${candidate.serial ?? "(no-serial)"}`)
        .join(", ");
      throw new Error(
        `Panorama does not show connected firewall ${firewall.hostname}. Connected devices: ${seen}`,
      );
    }
  return device.serial;
  });
}

export function parseConfigAddOnXml(content: string, file: string): ConfigAddOnOperation[] {
  const operations: ConfigAddOnOperation[] = [];
  // Strip XML comments first so a <set ...> mentioned inside a doc comment is not
  // mistaken for a real operation. Add-on files carry a header comment that
  // documents placeholders, so this guard keeps authoring safe.
  const withoutComments = content.replace(/<!--[\s\S]*?-->/g, "");
  const setPattern = /<set\b([^>]*)>([\s\S]*?)<\/set>/gi;
  for (const match of withoutComments.matchAll(setPattern)) {
    const attrs = match[1] ?? "";
    const element = match[2]?.trim() ?? "";
    const xpath = xmlAttributeValue(attrs, "xpath");
    if (!xpath) throw new Error(`PAN-OS config add-on ${file} has a <set> without an xpath attribute`);
    if (!element) throw new Error(`PAN-OS config add-on ${file} has an empty <set> for xpath ${xpath}`);
    operations.push({ xpath, element });
  }
  if (!operations.length) {
    throw new Error(`PAN-OS config add-on ${file} must include at least one <set xpath="..."> element`);
  }
  return operations;
}

function xmlAttributeValue(attrs: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = attrs.match(new RegExp(`\\b${escaped}\\s*=\\s*(['"])(.*?)\\1`, "i"));
  return match?.[2] ? xmlUnescape(match[2]) : null;
}

function configAddOnVariables(
  deployment: DeploymentConfig,
  resource: PanoramaResourceConfig,
  onboarding: ResolvedOnboardingConfig,
): Record<string, string> {
  return {
    deploymentName: deployment.name,
    panoramaHostname: resource.hostname,
    deviceGroup: onboarding.deviceGroup,
    template: onboarding.template,
    templateStack: onboarding.templateStack,
    vsys: onboarding.vsys,
  };
}

function firewallConfigAddOnVariables(
  deployment: DeploymentConfig,
  resource: PanwVmseriesResourceConfig,
): Record<string, string> {
  return {
    deploymentName: deployment.name,
    firewallHostname: resource.hostname,
    hostname: resource.hostname,
    vsys: "vsys1",
  };
}

export function substituteConfigAddOnVariables(
  value: string,
  variables: Record<string, string>,
  file: string,
): string {
  return value.replace(/\$\{([A-Za-z0-9_.-]+)\}/g, (_match, name: string) => {
    const replacement = variables[name];
    if (replacement === undefined) {
      throw new Error(`PAN-OS config add-on ${file} references unknown variable ${name}`);
    }
    return replacement;
  });
}

function resolvePushTarget(value: boolean | string | null | undefined, fallback: string): string | null {
  if (value === true) return fallback;
  if (typeof value === "string" && value) return value;
  return null;
}

function pushTimeoutMs(push: PanoramaConfigPushConfig | null | undefined): number {
  const seconds = push?.timeoutSeconds;
  if (seconds === undefined || seconds === null) return 1_200_000;
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) {
    throw new Error("Panorama config add-on push.timeoutSeconds must be a positive number");
  }
  return seconds * 1000;
}

function stringArrayValue(value: unknown): string[] | null {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string" && item)) {
    throw new Error("Panorama onboarding firewalls must be a string array");
  }
  return value;
}

async function ensureApiAccess(
  client: PanosApiClient,
  managementAddress: string,
  settings: ResolvedBootstrapSettings,
  log: LogFn,
): Promise<void> {
  const deadline = Date.now() + settings.readinessTimeoutMs;
  let lastError: unknown = null;

  while (Date.now() < deadline) {
    try {
      await client.generateApiKey(settings.adminUsername, settings.adminPassword);
      return;
    } catch (error) {
      lastError = error;
    }

    const remainingMs = Math.max(1, deadline - Date.now());
    try {
      log(`PAN-OS API is not accepting password auth yet; trying first-login SSH bootstrap`);
      await setInitialAdminPassword({
        host: managementAddress,
        port: settings.sshPort,
        username: settings.adminUsername,
        initialPassword: settings.initialAdminPassword,
        privateKeyPath: settings.sshPrivateKeyPath,
        agentSocket: settings.sshAgentSocket,
        newPassword: settings.adminPassword,
        timeoutMs: Math.min(remainingMs, 240_000),
        log,
      });
      await waitForApiAccess(client, settings, log);
      return;
    } catch (error) {
      lastError = error;
      log(`PAN-OS first-login bootstrap is not ready yet: ${errorMessage(error)}`);
      await sleep(30_000);
    }
  }

  throw new Error(`Timed out waiting for PAN-OS API or SSH bootstrap readiness: ${errorMessage(lastError)}`);
}

async function waitForApiAccess(
  client: PanosApiClient,
  settings: ResolvedBootstrapSettings,
  log: LogFn,
): Promise<void> {
  const deadline = Date.now() + settings.readinessTimeoutMs;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    try {
      await client.generateApiKey(settings.adminUsername, settings.adminPassword);
      await client.showSystemInfo();
      return;
    } catch (error) {
      lastError = error;
      await sleep(15_000);
    }
  }

  throw new Error(`Timed out waiting for PAN-OS API readiness: ${errorMessage(lastError)}`);
}

async function waitForApiAccessBounded(
  client: PanosApiClient,
  settings: ResolvedBootstrapSettings,
  windowMs: number,
): Promise<void> {
  const deadline = Date.now() + windowMs;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    try {
      await client.generateApiKey(settings.adminUsername, settings.adminPassword);
      await client.showSystemInfo();
      return;
    } catch (error) {
      lastError = error;
      await sleep(10_000);
    }
  }

  throw new Error(`Timed out waiting for PAN-OS API readiness: ${errorMessage(lastError)}`);
}

async function waitForLicensedPanorama(
  client: PanosApiClient,
  settings: ResolvedBootstrapSettings,
  log: LogFn,
): Promise<void> {
  const deadline = Date.now() + settings.readinessTimeoutMs;
  while (Date.now() < deadline) {
    const systemInfo = await client.showSystemInfo();
    if (systemInfo.serial && systemInfo.serial !== "unknown") return;
    log(`Panorama serial is still pending; waiting`);
    await sleep(15_000);
  }

  throw new Error("Timed out waiting for Panorama serial to populate after license fetch");
}

async function waitForLicensedFirewall(
  client: PanosApiClient,
  resource: PanwVmseriesResourceConfig,
  settings: ResolvedBootstrapSettings,
  log: LogFn,
): Promise<string | null> {
  const deadline = Date.now() + settings.readinessTimeoutMs;
  while (Date.now() < deadline) {
    const systemInfo = await client.showSystemInfo();
    const vmLicense = systemInfo.vmLicense?.trim() ?? null;
    if (vmLicense && !["none", "unknown"].includes(vmLicense.toLowerCase())) return vmLicense;
    log(`${resource.hostname} VM-Series license is still ${vmLicense ?? "pending"}; waiting`);
    await sleep(30_000);
  }

  throw new Error(`Timed out waiting for VM-Series license on ${resource.hostname}`);
}

function resolveBootstrapSettings(config: PanosBootstrapConfig | undefined): ResolvedBootstrapSettings {
  const adminPassword =
    config?.adminPassword ??
    envValue(config?.adminPasswordEnv) ??
    optionalEnv("PANOS_ADMIN_PASSWORD") ??
    null;
  if (!adminPassword) {
    throw new Error(
      "Missing PAN-OS admin password. Set bootstrap.adminPasswordEnv or PANOS_ADMIN_PASSWORD.",
    );
  }

  const initialAdminPassword =
    config?.initialAdminPassword ??
    envValue(config?.initialAdminPasswordEnv) ??
    optionalEnv("PANOS_INITIAL_ADMIN_PASSWORD") ??
    "admin";

  return {
    adminUsername: config?.adminUsername ?? "admin",
    adminPassword,
    initialAdminPassword,
    sshPrivateKeyPath: process.env.PANOS_SSH_PRIVATE_KEY ?? null,
    sshAgentSocket: process.env.SSH_AUTH_SOCK ?? null,
    apiPort: config?.apiPort ?? 443,
    sshPort: config?.sshPort ?? 22,
    tlsRejectUnauthorized: config?.tlsRejectUnauthorized ?? false,
    readinessTimeoutMs: (config?.readinessTimeoutSeconds ?? 900) * 1000,
    generateVmAuthKey: config?.generateVmAuthKey ?? true,
    vmAuthKeyLifetimeHours: config?.vmAuthKeyLifetimeHours ?? 8760,
  };
}

function resolvePanoramaSerial(resource: PanoramaResourceConfig): string {
  if (resource.license.serial) return resource.license.serial;
  if (resource.license.serialEnv) return requireEnv(resource.license.serialEnv);
  throw new Error(`Panorama ${resource.hostname} needs license.serial or license.serialEnv`);
}

function resolvePanoramaManagementAddress(outputs: Record<string, unknown>): string {
  const panorama = objectValue(outputs.panorama);
  const address = stringValue(panorama?.mgmt_public) ?? stringValue(panorama?.mgmt_private);
  if (!address) throw new Error("Terraform output panorama.mgmt_public or panorama.mgmt_private is required");
  return address;
}

function resolveFirewallManagementAddress(outputs: Record<string, unknown>): string {
  const firewall = objectValue(outputs.firewall);
  const address = stringValue(firewall?.management_public) ?? stringValue(firewall?.management_ip);
  if (!address) throw new Error("Terraform output firewall.management_public or firewall.management_ip is required");
  return address;
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function envValue(name?: string | null): string | null {
  return name ? optionalEnv(name) ?? null : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function xmlUnescape(value: string): string {
  return value
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
