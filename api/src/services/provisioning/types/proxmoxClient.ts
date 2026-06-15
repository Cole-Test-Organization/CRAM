export interface ProxmoxConnection {
  endpoint: string;
  apiToken: string;
  insecure?: boolean;
}

export interface ProxmoxApiResponse<T> {
  data: T;
}
