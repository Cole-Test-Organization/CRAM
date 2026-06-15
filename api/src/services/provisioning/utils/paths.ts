import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

// projectRoot is the provisioning service's data/config/work root. The source
// runs in place under tsx (no dist/), so the default is the provisioning service
// dir itself (one level up from utils/). Override with PROVISIONING_ROOT when
// data/work should live on a container volume or elsewhere.
export const projectRoot = process.env.PROVISIONING_ROOT
  ? path.resolve(process.env.PROVISIONING_ROOT)
  : path.resolve(here, "..");
export const dataDir = path.join(projectRoot, "data");
export const databaseDir = path.join(projectRoot, "database");
export const databaseDeploymentsDir = path.join(databaseDir, "deployments");
export const databaseLegacyFirewallsDir = path.join(databaseDir, "legacy-firewalls");
export const databaseProviderProfilesDir = path.join(databaseDir, "provider-profiles");
export const databaseResourceProfilesDir = path.join(databaseDir, "resource-profiles");
export const workDir = path.join(projectRoot, "work");
export const defaultConfigPath = path.join(
  "database",
  "legacy-firewalls",
  "fw-lab-01.yaml",
);
export const statePath = path.join(dataDir, "state.json");
export const jobsPath = path.join(dataDir, "jobs.json");

// Terraform stacks are shipped artifacts. Default under projectRoot/terraform so
// projectRoot-relative stack refs ("terraform/<stack>") resolve unchanged;
// override with PROVISIONING_TERRAFORM_ROOT to relocate them (e.g. api/terraform).
export const terraformRoot = process.env.PROVISIONING_TERRAFORM_ROOT
  ? path.resolve(process.env.PROVISIONING_TERRAFORM_ROOT)
  : path.join(projectRoot, "terraform");
export const terraformModuleDir = path.join(terraformRoot, "panw-vm");

const hostProjectPathMarkers = [
  "/api/src/services/provisioning/",
  "/services/provisioning/",
];

export function toProjectRelativePath(filePath: string | null | undefined): string | null {
  if (!filePath) return filePath ?? null;
  if (looksLikeUrl(filePath)) return filePath;

  const repoRelativeFromCurrentRoot = path.relative(projectRoot, filePath);
  if (
    path.isAbsolute(filePath) &&
    repoRelativeFromCurrentRoot &&
    !repoRelativeFromCurrentRoot.startsWith("..") &&
    !path.isAbsolute(repoRelativeFromCurrentRoot)
  ) {
    return normalizePathSeparators(repoRelativeFromCurrentRoot);
  }

  if (path.isAbsolute(filePath)) {
    const normalized = normalizePathSeparators(filePath);
    const marker = hostProjectPathMarkers.find((candidate) => normalized.includes(candidate));
    if (marker) {
      return normalizePathSeparators(normalized.slice(normalized.indexOf(marker) + marker.length));
    }
    return filePath;
  }

  return normalizePathSeparators(filePath);
}

export function resolveProjectPath(filePath: string): string {
  if (looksLikeUrl(filePath)) return filePath;
  const relativePath = toProjectRelativePath(filePath);
  if (relativePath && !path.isAbsolute(relativePath)) {
    return path.resolve(projectRoot, relativePath);
  }
  return filePath;
}

function normalizePathSeparators(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

function looksLikeUrl(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(value);
}
