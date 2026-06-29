import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { projectRoot, workDir } from "../../utils/paths.js";
import type { FirewallConfig, NetworkInterfaceConfig } from "../../types/index.js";
import type { LogFn } from "../../types/logging.js";
import { captureCommand, ensureDir, requireEnv, runCommand } from "../../utils/index.js";
import type { ProviderApplyResult } from "../../types/providerAdapter.js";
import {
  terraformInit,
  terraformSelectWorkspace,
  terraformWorkspace,
  withPgBackend,
} from "../../resources/terraformRunner.js";

// Proxmox VM-Series provisions through a dedicated, hardcoded Terraform stack
// (terraform/panw-vm) rather than a per-kind resource profile + the generic runner:
// it clones a Proxmox template and uploads a bootstrap ISO, which the generic AWS-style
// path doesn't model. State lives in the Terraform pg backend (one workspace per
// resource), the same as every other stack, so a deploy survives a restart and any
// replica can tear it down. The connection string is injected via env (PG_CONN_STR),
// never on the command line.
const PANW_VM_STACK = "terraform/panw-vm";

export async function terraformApplyVm(
  config: FirewallConfig,
  bootstrapIsoPath: string,
  log: LogFn,
  deploymentName: string,
): Promise<ProviderApplyResult> {
  const tfWorkDir = path.join(workDir, config.hostname, "terraform");
  await ensureDir(tfWorkDir);

  const varsPath = path.join(tfWorkDir, "terraform.tfvars.json");
  await writeFile(
    varsPath,
    `${JSON.stringify(toTerraformVars(config, bootstrapIsoPath), null, 2)}\n`,
  );

  const env = withPgBackend(terraformEnv(config, tfWorkDir));
  const workspace = terraformWorkspace(deploymentName, config.hostname);
  await terraformInit(PANW_VM_STACK, env, log);
  await terraformSelectWorkspace(PANW_VM_STACK, workspace, env, log);
  await runCommand(
    "terraform",
    [
      `-chdir=${PANW_VM_STACK}`,
      "apply",
      "-input=false",
      "-auto-approve",
      `-var-file=${varsPath}`,
    ],
    { cwd: projectRoot, env, log },
  );

  const outputJson = await captureCommand(
    "terraform",
    [`-chdir=${PANW_VM_STACK}`, "output", "-json"],
    { cwd: projectRoot, env, log },
  );
  const parsed = JSON.parse(outputJson) as Record<string, { value: unknown }>;
  const vmId = parsed.vm_id?.value as number | undefined;
  return {
    vmId,
    providerResourceId: vmId === undefined ? null : String(vmId),
    bootstrapIsoFileId: parsed.bootstrap_iso_file_id?.value as string | undefined,
    outputs: {
      vm_id: vmId ?? null,
      vm_name: parsed.vm_name?.value ?? config.hostname,
      bootstrap_iso_file_id: parsed.bootstrap_iso_file_id?.value ?? null,
      firewall: {
        management_ip: config.management.ipAddress ?? null,
      },
    },
    // State is in the pg backend; persist the workspace name (mapped to the
    // terraform_workspace column) exactly as the generic runner does.
    terraformStatePath: workspace,
  };
}

export async function terraformDestroyVm(
  config: FirewallConfig,
  workspaceName: string | null,
  log: LogFn,
  deploymentName: string,
  bootstrapIsoPath: string,
): Promise<void> {
  const workspace = workspaceName ?? terraformWorkspace(deploymentName, config.hostname);
  if (!workspaceName) {
    log(`No Terraform workspace recorded for ${config.hostname}; using expected workspace ${workspace}.`);
  }
  const tfWorkDir = path.join(workDir, config.hostname, "terraform");
  const varsPath = path.join(tfWorkDir, "terraform.tfvars.json");
  await mkdir(tfWorkDir, { recursive: true });
  // Regenerate the tfvars so destroy works even if the work dir was wiped since apply
  // (state itself is durable in the pg backend). The ISO path is irrelevant at destroy.
  await writeFile(
    varsPath,
    `${JSON.stringify(toTerraformVars(config, bootstrapIsoPath), null, 2)}\n`,
  );

  const env = withPgBackend(terraformEnv(config, tfWorkDir));
  await terraformInit(PANW_VM_STACK, env, log);
  await terraformSelectWorkspace(PANW_VM_STACK, workspace, env, log);
  await runCommand(
    "terraform",
    [
      `-chdir=${PANW_VM_STACK}`,
      "destroy",
      "-input=false",
      "-auto-approve",
      `-var-file=${varsPath}`,
    ],
    { cwd: projectRoot, env, log },
  );
}

function toTerraformVars(config: FirewallConfig, bootstrapIsoPath: string): Record<string, unknown> {
  return {
    proxmox_insecure: config.proxmox.insecure ?? true,
    proxmox_ssh_username: config.proxmox.sshUsername ?? "root",
    target_node: config.proxmox.targetNode,
    template_node: config.proxmox.templateNode ?? config.proxmox.targetNode,
    template_vm_id: config.proxmox.templateVmId,
    vm_id: config.proxmox.vmId ?? null,
    vm_name: config.hostname,
    cpu_cores: config.vm.cpuCores,
    cpu_type: config.vm.cpuType ?? "host",
    memory_mb: config.vm.memoryMb,
    started: config.vm.started ?? true,
    vm_datastore_id: config.proxmox.vmDatastoreId ?? "local-lvm",
    iso_datastore_id: config.proxmox.isoDatastoreId,
    bootstrap_iso_path: bootstrapIsoPath,
    interfaces: config.interfaces.map(toTerraformInterface),
  };
}

function toTerraformInterface(iface: NetworkInterfaceConfig): Record<string, unknown> {
  return {
    name: iface.name,
    bridge: iface.bridge,
    model: iface.model ?? "virtio",
    vlan_id: iface.vlanId ?? null,
    mac_address: iface.macAddress ?? null,
    firewall: iface.firewall ?? false,
  };
}

function terraformEnv(config: FirewallConfig, tfWorkDir: string): NodeJS.ProcessEnv {
  return {
    TF_DATA_DIR: path.join(tfWorkDir, ".terraform"),
    TF_VAR_proxmox_endpoint: requireEnv(config.proxmox.endpointEnv),
    TF_VAR_proxmox_api_token: requireEnv(config.proxmox.apiTokenEnv),
  };
}
