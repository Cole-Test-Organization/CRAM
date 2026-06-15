import type { ResourceConfig, ResourceRecord } from "../types/index.js";
import type { LogFn } from "../types/logging.js";
import type { ResourceAdapter, ResourceAdapterContext, ResourceUpResult } from "./types.js";

export class GenericTerraformResourceAdapter<TResource extends ResourceConfig = ResourceConfig>
  implements ResourceAdapter<TResource> {
  readonly kind = "*";

  async up(
    context: ResourceAdapterContext<TResource>,
    _record: ResourceRecord,
    log: LogFn,
  ): Promise<ResourceUpResult> {
    log(`Applying ${context.deployment.provider.type} ${context.resource.kind} Terraform resource`);
    const applyResult = await context.terraform.apply(context, log);
    return {
      resourcePatch: applyResult,
    };
  }

  async down(
    context: ResourceAdapterContext<TResource>,
    record: ResourceRecord,
    log: LogFn,
  ): Promise<void> {
    log(`Destroying ${context.deployment.provider.type} ${context.resource.kind} Terraform resource`);
    await context.terraform.destroy(context, record, log);
  }
}
