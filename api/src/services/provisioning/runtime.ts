import { ResourceBroker } from "./resourceBroker.js";
import { PostgresConfigRepository } from "./config/postgresConfigRepository.js";
import { PostgresStateRepository } from "./state/postgresStateRepository.js";
import { createDefaultResourceAdapterRegistry } from "./resources/index.js";
import { SecretResolver, SecretsService } from "./secrets/index.js";
import { ProvisioningService } from "./provisioningService.js";
import { ProvisioningJobWorker } from "./jobWorker.js";

export interface ProvisioningRuntimeOptions {
  userId: number;
}

export interface ProvisioningRuntime {
  userId: number;
  config: PostgresConfigRepository;
  store: PostgresStateRepository;
  secrets: SecretsService;
  secretResolver: SecretResolver;
  broker: ResourceBroker;
  service: ProvisioningService;
}

// Single construction point for provisioning's shared object graph. The service
// and worker both receive the same broker/store/secrets instances; only the API
// process creates a worker, while MCP processes use the service for reads/enqueue.
export function createProvisioningRuntime(options: ProvisioningRuntimeOptions): ProvisioningRuntime {
  const config = new PostgresConfigRepository(options.userId);
  const store = new PostgresStateRepository(options.userId);
  const secrets = new SecretsService();
  const secretResolver = new SecretResolver(options.userId, secrets);
  const broker = new ResourceBroker({
    store,
    configRepository: config,
    secretResolver,
    resourceAdapters: createDefaultResourceAdapterRegistry(),
  });
  const service = new ProvisioningService({
    userId: options.userId,
    broker,
    store,
    config,
    secrets,
    secretResolver,
  });

  return {
    userId: options.userId,
    config,
    store,
    secrets,
    secretResolver,
    broker,
    service,
  };
}

export function createProvisioningWorker(runtime: ProvisioningRuntime): ProvisioningJobWorker {
  return new ProvisioningJobWorker({
    userId: runtime.userId,
    broker: runtime.broker,
    store: runtime.store,
    secretResolver: runtime.secretResolver,
  });
}
