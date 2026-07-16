import type {
  ResourceKind,
  ResourceLifecycleStatus,
  ResourcePowerState,
  ProviderType,
} from "./common.js";

export interface ResourceRecord {
  id: string;
  deploymentId: string;
  name?: string | null;
  hostname: string;
  kind?: ResourceKind | null;
  lifecycleStatus: ResourceLifecycleStatus;
  configPath: string;
  provider?: ProviderType | null;
  vmId?: number | null;
  providerResourceId?: string | null;
  authCode?: string | null;
  serial?: string | null;
  bootstrapIsoPath?: string | null;
  bootstrapIsoFileId?: string | null;
  terraformStatePath?: string | null;
  panos?: {
    managementAddress?: string | null;
    vmAuthKey?: string | null;
    vmAuthKeyExpiresAt?: string | null;
    vmLicense?: string | null;
    scmFolder?: string | null;
    scmConnected?: boolean | null;
    connectedDeviceCount?: number | null;
    deviceGroup?: string | null;
    template?: string | null;
    templateStack?: string | null;
    onboardedFirewallSerials?: string[] | null;
    configAddOns?: string[] | null;
  } | null;
  outputs?: Record<string, unknown> | null;
  lastJobId?: string | null;
  powerState?: ResourcePowerState | null;
  powerStateCheckedAt?: string | null;
  updatedAt: string;
}

export interface BrokerState {
  activeJobId?: string | null;
  schemaVersion?: number;
  resources: Record<string, ResourceRecord>;
}

export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "canceled";

export interface JobRecord {
  id: string;
  action: string;
  hostname?: string;
  status: JobStatus;
  startedAt: string;
  finishedAt?: string;
  logs: string[];
  error?: string;
}
