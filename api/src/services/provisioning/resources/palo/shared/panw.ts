import type { PanwVmseriesResourceConfig, ResourceRecord } from "../../../types/index.js";
import type { LogFn } from "../../../types/logging.js";
import { PanwBootstrapService } from "./bootstrapService.js";

/**
 * VM-Series license deactivation before a destroy.
 *
 * Releases Flex/VM-Series credits via the firewall's own PAN-OS API
 * (`request license deactivate VM-Series mode auto`) so a later cold boot does
 * not fail with `NOV-021 Insufficient credits`. The firewall API is still up at
 * this point in teardown.
 *
 * A failed/skipped deactivation is a hard error by default so credits are never
 * silently orphaned. The deployment's `destroy.allowWithoutDelicense` switch is
 * honored only when PANW_ALLOW_DESTROY_WITHOUT_DELICENSE=true is also set.
 *
 * Returns true when it is safe to continue because the firewall deactivated its
 * license or reported that no active VM-Series license remained.
 */
export async function deactivateLicenseIfPossible(
  config: PanwVmseriesResourceConfig,
  record: ResourceRecord,
  outputs: Record<string, unknown>,
  log: LogFn,
  bootstrap: PanwBootstrapService = new PanwBootstrapService(),
): Promise<boolean> {
  const allowWithout =
    config.destroy?.allowWithoutDelicense === true &&
    process.env.PANW_ALLOW_DESTROY_WITHOUT_DELICENSE === "true";

  if (!record.authCode) {
    const message = "no auth code is recorded for this firewall";
    if (allowWithout) {
      log(`WARNING: Destroying without de-licensing because ${message}.`);
      return false;
    }
    throw new Error(
      `Refusing to destroy without de-licensing: ${message}. ` +
        "Record an auth code or set destroy.allowWithoutDelicense=true for lab testing.",
    );
  }

  const result = await bootstrap.deactivateFirewallLicense(config, outputs, log);
  if (result.deactivated) {
    log(`VM-Series license deactivated for ${config.hostname}${result.serial ? ` (serial ${result.serial})` : ""}.`);
    return true;
  }

  if (result.alreadyUnlicensed) {
    log(
      `VM-Series license already inactive for ${config.hostname}` +
        `${result.serial ? ` (serial ${result.serial})` : ""}; continuing destroy.`,
    );
    return true;
  }

  const reason = result.reason ?? "deactivation did not complete";
  if (allowWithout) {
    log(`WARNING: Continuing destroy of ${config.hostname} without confirmed de-licensing: ${reason}.`);
    return false;
  }
  throw new Error(
    `Refusing to destroy ${config.hostname} without de-licensing: ${reason}. ` +
      "Set destroy.allowWithoutDelicense=true to override for lab testing.",
  );
}
