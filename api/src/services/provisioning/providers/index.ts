import type { ProviderAdapter } from "../types/providerAdapter.js";
import { AwsProviderAdapter } from "./aws/adapter.js";
import { GcpProviderAdapter } from "./gcp/adapter.js";
import { ProxmoxProviderAdapter } from "./proxmox/adapter.js";

const adapters: Record<string, ProviderAdapter> = {
  aws: new AwsProviderAdapter(),
  gcp: new GcpProviderAdapter(),
  proxmox: new ProxmoxProviderAdapter(),
};

export function getProviderAdapter(provider: string): ProviderAdapter {
  const adapter = adapters[provider];
  if (!adapter) {
    throw new Error(
      `Unsupported provider ${provider}. Registered providers: ${Object.keys(adapters).join(", ")}`,
    );
  }
  return adapter;
}

export function listProviderAdapters(): ProviderAdapter[] {
  return Object.values(adapters);
}
