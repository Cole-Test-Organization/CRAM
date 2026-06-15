import type { ProviderAdapter } from "../types/providerAdapter.js";
import { AwsProviderAdapter } from "./aws/adapter.js";
import { ProxmoxProviderAdapter } from "./proxmox/adapter.js";

const adapters: Record<string, ProviderAdapter> = {
  aws: new AwsProviderAdapter(),
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
