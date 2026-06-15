import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveProjectPath, terraformModuleDir, toProjectRelativePath, workDir } from "../../utils/paths.js";
import type { FirewallConfig, NetworkInterfaceConfig } from "../../types/index.js";
import type { LogFn } from "../../types/logging.js";
import { captureCommand, ensureDir, requireEnv, runCommand } from "../../utils/index.js";
import type { ProviderApplyResult } from "../../types/providerAdapter.js";

export async function terraformApplyVm(
  config: FirewallConfig,
  bootstrapIsoPath: string,
  log: LogFn,
): Promise<ProviderApplyResult> {
  const tfWorkDir = path.join(workDir, config.hostname, "terraform");
  await ensureDir(tfWorkDir);

  const varsPath = path.join(tfWorkDir, "terraform.tfvars.json");
  const statePath = path.join(tfWorkDir, "terraform.tfstate");
  await writeFile(varsPath, `${JSON.stringify(toTerraformVars(config, bootstrapIsoPath), null, 2)}\n`);

  const env = terraformEnv(config, tfWorkDir);
  await runCommand("terraform", ["-chdir=terraform/panw-vm", "init", "-input=false"], {
    cwd: path.resolve(terraformModuleDir, "..", ".."),
    env,
    log,
  });
  await runCommand(
    "terraform",
    [
      "-chdir=terraform/panw-vm",
      "apply",
      "-input=false",
      "-auto-approve",
      `-var-file=${varsPath}`,
      `-state=${statePath}`,
    ],
    {
      cwd: path.resolve(terraformModuleDir, "..", ".."),
      env,
      log,
    },
  );

  const outputJson = await captureCommand(
    "terraform",
    ["-chdir=terraform/panw-vm", "output", "-json", `-state=${statePath}`],
    {
      cwd: path.resolve(terraformModuleDir, "..", ".."),
      env,
      log,
    },
  );
  const parsed = JSON.parse(outputJson) as Record<string, { value: unknown }>;
  const vmId = parsed.vm_id?.value as number | undefined;
  return {
    vmId,
    providerResourceId: vmId === undefined ? null : String(vmId),
    bootstrapIsoFileId: parsed.bootstrap_iso_file_id?.value as string | undefined,
    terraformStatePath: toProjectRelativePath(statePath),
  };
}

export async function terraformDestroyVm(
  config: FirewallConfig,
  terraformStatePath: string,
  log: LogFn,
): Promise<void> {
  const resolvedTerraformStatePath = resolveProjectPath(terraformStatePath);
  const tfWorkDir = path.dirname(resolvedTerraformStatePath);
  const varsPath = path.join(tfWorkDir, "terraform.tfvars.json");
  const env = terraformEnv(config, tfWorkDir);

  await mkdir(tfWorkDir, { recursive: true });
  await runCommand("terraform", ["-chdir=terraform/panw-vm", "init", "-input=false"], {
    cwd: path.resolve(terraformModuleDir, "..", ".."),
    env,
    log,
  });
  await runCommand(
    "terraform",
    [
      "-chdir=terraform/panw-vm",
      "destroy",
      "-input=false",
      "-auto-approve",
      `-var-file=${varsPath}`,
      `-state=${resolvedTerraformStatePath}`,
    ],
    {
      cwd: path.resolve(terraformModuleDir, "..", ".."),
      env,
      log,
    },
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
