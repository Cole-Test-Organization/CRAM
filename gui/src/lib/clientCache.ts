export type CachedApiResponse = {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  bodyBase64: string;
};

export type ClientCacheBridge = {
  put: (key: string, response: CachedApiResponse) => Promise<void>;
  get: (key: string) => Promise<CachedApiResponse | null>;
  keys: () => Promise<string[]>;
  delete: (key: string) => Promise<void>;
  prune?: (keeping: string[]) => Promise<void>;
};

export function isClientCacheBridge(value: unknown): value is ClientCacheBridge {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ClientCacheBridge>;
  return typeof candidate.put === 'function'
    && typeof candidate.get === 'function'
    && typeof candidate.keys === 'function'
    && typeof candidate.delete === 'function'
    && (candidate.prune === undefined || typeof candidate.prune === 'function');
}
