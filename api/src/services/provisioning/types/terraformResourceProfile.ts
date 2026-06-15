export type TerraformValueResolver = "currentPublicIpCidrList" | "localSshPublicKey";

export type TerraformValueSpec =
  | null
  | string
  | number
  | boolean
  | unknown[]
  | {
      value?: unknown;
      path?: string;
      default?: unknown;
      defaultPath?: string;
      envPath?: string;
      envListPath?: string;
      resolver?: TerraformValueResolver;
      fromResource?: string;
      output?: string;
      state?: string;
      optional?: boolean;
      first?: TerraformValueSpec[];
    };

export interface TerraformResourceProfile {
  name: string;
  provider: string;
  kind: string;
  terraform: {
    stack: string;
    outputs?: {
      providerResourceId?: string | null;
    };
    environment?: Record<string, TerraformValueSpec>;
    vars: Record<string, TerraformValueSpec>;
  };
}
