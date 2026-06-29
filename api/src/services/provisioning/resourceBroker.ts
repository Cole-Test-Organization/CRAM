import path from "node:path";
import { getProviderAdapter } from "./providers/index.js";
import {
    ResourceAdapterRegistry,
    TerraformRunner,
    type ResourceActionRequest,
    type ResourceAdapterContext,
} from "./resources/index.js";
import { GenericTerraformResourceAdapter } from "./resources/genericTerraformResourceAdapter.js";
import { FileStateRepository, type StateRepository } from "./state/index.js";
import {
    ConfigRepository,
    ModuleConfigRepository,
    validateDeploymentReferences,
} from "./config/index.js";
import { SecretResolver } from "./secrets/index.js";
import {
    clearSecretOverlay,
    installSecretOverlay,
} from "./utils/secretSource.js";
import type { BrokerEventListener } from "./events.js";
import type {
    DeploymentConfig,
    DeploymentStepConfig,
    JobRecord,
    ProviderConfig,
    ResourceBrokerRunOptions,
    ResourcePowerAction,
    ResourcePowerActionResult,
    ResourcePowerState,
    ResourcePowerSelector,
    ResourcePlacementConfig,
    ResourceRecord,
    ResourceConfig,
    TerraformResourceProfile,
} from "./types/index.js";
import type { LogFn } from "./types/logging.js";
import type {
    ProviderPortForward,
    ProviderPortForwardRequest,
} from "./types/providerAdapter.js";
import { httpError } from "../../lib/http-error.js";
import { nowIso } from "./utils/index.js";
import {
    projectRoot,
    resolveProjectPath as resolveProjectFilePath,
    toProjectRelativePath,
} from "./utils/paths.js";

export interface ResourceBrokerOptions {
    stateRepository?: StateRepository;
    rootDir?: string;
    resourceAdapters?: ResourceAdapterRegistry;
    configRepository?: ConfigRepository;
    secretResolver?: SecretResolver;
}

export class ResourceBroker {
    private readonly stateRepository: StateRepository;
    private readonly rootDir: string;
    private readonly terraform = new TerraformRunner();
    private readonly resourceAdapters: ResourceAdapterRegistry;
    private readonly config: ConfigRepository;
    private readonly secretResolver?: SecretResolver;

    constructor(options: ResourceBrokerOptions = {}) {
        this.stateRepository =
            options.stateRepository ?? new FileStateRepository();
        this.rootDir = options.rootDir ?? projectRoot;
        this.resourceAdapters =
            options.resourceAdapters ??
            new ResourceAdapterRegistry(
                [],
                new GenericTerraformResourceAdapter(),
            );
        this.config = options.configRepository ?? new ModuleConfigRepository();
        this.secretResolver = options.secretResolver;
    }

    async loadProviderProfile(profileName: string): Promise<ProviderConfig> {
        if (!profileName) throw new Error("provider profile name is required");
        const profile = await this.config.getProviderProfile(profileName);
        if (!profile)
            throw new Error(`provider profile ${profileName} not found`);
        return profile;
    }

    async loadAppProfile<TProfile = unknown>(
        group: string,
        profileName: string,
    ): Promise<TProfile> {
        if (!group) throw new Error("app profile group is required");
        if (!profileName) throw new Error("app profile name is required");
        const profile = await this.config.getAppProfile<TProfile>(
            group,
            profileName,
        );
        if (profile == null)
            throw new Error(`app profile ${group}/${profileName} not found`);
        return profile;
    }

    async loadConfigProfile<TProfile = unknown>(
        group: string,
        profileName: string,
    ): Promise<TProfile> {
        if (!group) throw new Error("config profile group is required");
        if (!profileName) throw new Error("config profile name is required");
        const profile = await this.config.getConfigProfile<TProfile>(
            group,
            profileName,
        );
        if (profile == null)
            throw new Error(`config profile ${group}/${profileName} not found`);
        return profile;
    }

    async loadTerraformResourceProfile(
        deployment: DeploymentConfig,
        resource: ResourceConfig,
    ): Promise<TerraformResourceProfile> {
        const profileName =
            typeof resource.terraformProfile === "string" &&
            resource.terraformProfile
                ? resource.terraformProfile
                : `${deployment.provider.type}-${resource.kind}`;
        const profile = await this.config.getResourceProfile(profileName);
        if (!profile)
            throw new Error(
                `terraform resource profile ${profileName} not found`,
            );
        return profile;
    }

    private async loadDeploymentConfig(
        configRef: string,
        params?: Record<string, unknown>,
    ): Promise<DeploymentConfig> {
        const deployment = await this.config.getRawDeploymentConfig(configRef);
        if (!deployment)
            throw new Error(`deployment config ${configRef} not found`);
        return await this.prepareDeploymentConfig(
            deployment,
            configRef,
            params,
        );
    }

    private async prepareDeploymentConfig(
        deployment: DeploymentConfig,
        configRef: string,
        params?: Record<string, unknown>,
    ): Promise<DeploymentConfig> {
        const withProvider = await this.applyProviderProfile(
            deployment,
            configRef,
        );
        const withResourcePreparation =
            await this.resourceAdapters.prepareDeployment(
                withProvider,
                this,
                configRef,
                params,
            );
        validateDeploymentConfig(withResourcePreparation, configRef);
        return withResourcePreparation;
    }

    private async applyProviderProfile(
        deployment: DeploymentConfig,
        configRef: string,
    ): Promise<DeploymentConfig> {
        if (!deployment.providerProfile) return deployment;
        if (typeof deployment.providerProfile !== "string") {
            throw new Error(
                `Invalid config ${configRef}: providerProfile must be a string`,
            );
        }

        const profile = await this.loadProviderProfile(
            deployment.providerProfile,
        );
        return {
            ...deployment,
            provider: {
                ...profile,
                ...(deployment.provider ?? {}),
            },
        };
    }

    private resolveYamlPath(filePath: string): string {
        const mappedPath = this.mapYamlGroupPath(filePath);
        return mappedPath ?? this.resolveProjectPath(filePath);
    }

    resolveProjectPath(filePath: string): string {
        const relativePath = toProjectRelativePath(filePath);
        if (relativePath && !path.isAbsolute(relativePath)) {
            return path.resolve(this.rootDir, relativePath);
        }
        return filePath;
    }

    private mapYamlGroupPath(filePath: string): string | null {
        const normalized = filePath.split(path.sep).join("/");
        const basename = path.basename(filePath);

        if (
            inYamlGroup(normalized, "database/deployments") ||
            inYamlGroup(normalized, "deployments")
        ) {
            return path.join(this.rootDir, "database", "deployments", basename);
        }
        if (
            inYamlGroup(normalized, "database/provider-profiles") ||
            inYamlGroup(normalized, "profiles/providers")
        ) {
            return path.join(
                this.rootDir,
                "database",
                "provider-profiles",
                basename,
            );
        }
        if (
            inYamlGroup(normalized, "database/resource-profiles") ||
            inYamlGroup(normalized, "profiles/resources")
        ) {
            return path.join(
                this.rootDir,
                "database",
                "resource-profiles",
                basename,
            );
        }

        return null;
    }

    async up(
        configPath: string,
        log: LogFn,
        hostname?: string,
        options: ResourceBrokerRunOptions = {},
    ): Promise<ResourceRecord> {
        const configRef = toProjectRelativePath(configPath) ?? configPath;
        const deployment = await this.loadDeploymentConfig(
            configRef,
            options.params,
        );
        if (!options.skipReferenceCheck)
            await validateDeploymentReferences(deployment, this.config);
        const resource = findResource(deployment, hostname);
        if (!options.skipActiveJobCheck) await this.ensureNoActiveJob();

        const provider = getProviderAdapter(deployment.provider.type);
        const adapter = this.resourceAdapters.resolve(resource.kind);
        const initialState =
            adapter.initialState?.(deployment, resource, provider, configRef) ??
            {};
        const record = await this.stateRepository.upsertResource({
            id: "",
            deploymentId: deployment.name,
            name: resource.name,
            hostname: resource.hostname,
            lifecycleStatus: "idle",
            configPath: configRef,
            provider: provider.type,
            kind: resource.kind,
            updatedAt: nowIso(),
            ...initialState,
        });

        log(
            `Starting ${resource.kind} provisioning for ${resource.hostname} with provider ${provider.type}`,
        );
        await this.stateRepository.patchResource(record.id, {
            lifecycleStatus: "terraform_applying",
        });
        const upResult = await adapter.up(
            this.resourceAdapterContext(
                configRef,
                deployment,
                resource,
                provider,
                options.params,
            ),
            record,
            log,
        );

        const next = await this.stateRepository.patchResource(record.id, {
            lifecycleStatus: "ready",
            ...upResult.resourcePatch,
        });
        log(`${resource.hostname} ${resource.kind} resource is created.`);
        return next;
    }

    async down(
        target: string,
        log: LogFn,
        options: ResourceBrokerRunOptions = {},
    ): Promise<ResourceRecord> {
        if (!options.skipActiveJobCheck) await this.ensureNoActiveJob();
        const record = await this.requireExistingResource(target);

        const deployment = await this.loadDeploymentConfig(record.configPath);
        const selected = findResource(deployment, record.hostname);
        const provider = getProviderAdapter(
            record.provider ?? deployment.provider.type,
        );
        const adapter = this.resourceAdapters.resolve(selected.kind);
        await this.stateRepository.patchResource(record.id, {
            lifecycleStatus: "destroy_requested",
        });
        log(`Starting teardown for ${record.hostname}`);

        await this.stateRepository.patchResource(record.id, {
            lifecycleStatus: "terraform_destroying",
        });
        await adapter.down(
            this.resourceAdapterContext(
                record.configPath,
                deployment,
                selected,
                provider,
                options.params,
            ),
            record,
            log,
        );
        const next = await this.stateRepository.patchResource(record.id, {
            lifecycleStatus: "destroyed",
        });
        log(`${record.hostname} destroyed`);
        return next;
    }

    async runAction(
        configPath: string,
        target: string,
        action: string,
        log: LogFn,
        options: ResourceBrokerRunOptions = {},
    ): Promise<ResourceRecord> {
        if (!options.skipActiveJobCheck) await this.ensureNoActiveJob();
        const configRef = toProjectRelativePath(configPath) ?? configPath;
        const deployment = await this.loadDeploymentConfig(
            configRef,
            options.params,
        );
        if (!options.skipReferenceCheck)
            await validateDeploymentReferences(deployment, this.config);
        const targetRecord = await this.stateRepository.getResource(target);
        const configScopedTargetRecord =
            targetRecord &&
            targetRecord.deploymentId === deployment.name &&
            this.resolveYamlPath(targetRecord.configPath) ===
                this.resolveYamlPath(configRef)
                ? targetRecord
                : null;
        const resourceTarget = configScopedTargetRecord?.hostname ?? target;
        const resource = findResource(deployment, resourceTarget);
        const record = await this.findDeploymentResourceRecord(
            configRef,
            deployment,
            resource,
        );
        if (!record) {
            throw new Error(
                `No resource named ${resource.hostname} exists in broker state for deployment ${deployment.name}`,
            );
        }

        const provider = getProviderAdapter(
            record.provider ?? deployment.provider.type,
        );
        const adapter = this.resourceAdapters.resolve(resource.kind);
        if (!adapter.runAction) {
            throw new Error(
                `Resource kind ${resource.kind} does not support resource actions`,
            );
        }

        const request: ResourceActionRequest = {
            action,
            targets: [target],
            params: options.params,
        };
        log(`Starting ${action} for ${resource.hostname}`);
        const patch = await adapter.runAction(
            this.resourceAdapterContext(
                configRef,
                deployment,
                resource,
                provider,
                options.params,
            ),
            record,
            request,
            log,
        );

        const next = await this.stateRepository.patchResource(record.id, {
            lifecycleStatus: "ready",
            ...patch,
        });
        log(`${resource.hostname} ${action} completed`);
        return next;
    }

    async deploy(
        configPath: string,
        log: LogFn,
        options: ResourceBrokerRunOptions = {},
    ): Promise<void> {
        if (!options.skipActiveJobCheck) await this.ensureNoActiveJob();
        const configRef = toProjectRelativePath(configPath) ?? configPath;
        const deployment = await this.loadDeploymentConfig(
            configRef,
            options.params,
        );

        await validateDeploymentReferences(deployment, this.config);
        if (!deployment.steps?.length) {
            const targets = deployment.resources.map(
                (resource) => resource.hostname,
            );
            if (!targets.length)
                throw new Error(
                    `Deployment ${deployment.name} has no resources to deploy`,
                );
            log(
                `Deployment ${deployment.name} has no workflow steps; deploying ${targets.length} resource${targets.length === 1 ? "" : "s"}.`,
            );
            for (const target of targets) {
                await this.up(configRef, log, target, {
                    skipActiveJobCheck: true,
                    skipReferenceCheck: true,
                    params: options.params,
                });
            }
            return;
        }

        for (const step of deployment.steps) {
            const stepParams =
                options.params || step.params
                    ? { ...(options.params ?? {}), ...(step.params ?? {}) }
                    : undefined;
            const expected = step.when?.equals ?? true;
            const shouldRunStep =
                step.enabled !== false &&
                (!step.when || stepParams?.[step.when.param] === expected);
            if (!shouldRunStep) {
                log(`Skipping step ${step.name}: condition not met`);
                continue;
            }

            log(
                `Starting step ${step.name}: ${step.description ?? step.action}`,
            );
            const targets = step.targets ?? [];
            if (!targets.length)
                throw new Error(`Step ${step.name} needs at least one target`);

            if (step.action === "up" || step.action === "apply-resource") {
                for (const target of targets) {
                    await this.up(configRef, log, target, {
                        skipActiveJobCheck: true,
                        skipReferenceCheck: true,
                        params: stepParams,
                    });
                }
            } else {
                const resourceAction = step.resourceAction ?? step.action;
                for (const target of targets) {
                    await this.runAction(
                        configRef,
                        target,
                        resourceAction,
                        log,
                        {
                            skipActiveJobCheck: true,
                            skipReferenceCheck: true,
                            params: stepParams,
                        },
                    );
                }
            }
            log(`Completed step ${step.name}`);
        }
    }

    async deprovision(
        configPath: string,
        log: LogFn,
        options: ResourceBrokerRunOptions = {},
    ): Promise<void> {
        if (!options.skipActiveJobCheck) await this.ensureNoActiveJob();
        const configRef = toProjectRelativePath(configPath) ?? configPath;
        const deployment = await this.loadDeploymentConfig(
            configRef,
            options.params,
        );

        if (!deployment.steps?.length) {
            await this.deprovisionResources(
                configRef,
                deployment,
                log,
                options.params,
            );
            return;
        }

        let provisionStepCount = 0;
        for (const step of [...(deployment.steps ?? [])].reverse()) {
            if (!isProvisionStepAction(step.action)) {
                log(
                    `Skipping step ${step.name}: ${step.action} has no automatic teardown`,
                );
                continue;
            }

            const stepParams =
                options.params || step.params
                    ? { ...(options.params ?? {}), ...(step.params ?? {}) }
                    : undefined;
            const expected = step.when?.equals ?? true;
            const shouldRunStep =
                step.enabled !== false &&
                (!step.when || stepParams?.[step.when.param] === expected);
            provisionStepCount += 1;
            log(
                `Starting teardown for step ${step.name}: ${step.description ?? step.action}` +
                    (shouldRunStep
                        ? ""
                        : " (condition not met; checking for existing resources only)"),
            );
            const targets = step.targets ?? [];
            if (!targets.length)
                throw new Error(`Step ${step.name} needs at least one target`);

            for (const target of [...targets].reverse()) {
                const resource = findResource(deployment, target);
                const record = await this.findDeploymentResourceRecord(
                    configRef,
                    deployment,
                    resource,
                );
                if (!record) {
                    log(
                        `Skipping ${resource.hostname}: ` +
                            (shouldRunStep
                                ? "no broker state record exists"
                                : "condition not met and no broker state record exists"),
                    );
                    continue;
                }
                if (record.lifecycleStatus === "destroyed") {
                    log(`Skipping ${record.hostname}: already destroyed`);
                    continue;
                }

                await this.down(record.id, log, {
                    skipActiveJobCheck: true,
                    params: stepParams,
                });
            }

            log(`Completed teardown for step ${step.name}`);
        }

        if (provisionStepCount === 0) {
            throw new Error(
                `Deployment ${deployment.name} has no provision steps to deprovision`,
            );
        }
    }

    // Tear down every configured resource of a step-less deployment, reverse config
    // order, skipping ones with no record or already destroyed.
    private async deprovisionResources(
        configRef: string,
        deployment: DeploymentConfig,
        log: LogFn,
        params: Record<string, unknown> | undefined,
    ): Promise<void> {
        if (!deployment.resources.length) {
            throw new Error(
                `Deployment ${deployment.name} has no resources to deprovision`,
            );
        }
        let downed = 0;
        for (const resource of [...deployment.resources].reverse()) {
            const record = await this.findDeploymentResourceRecord(
                configRef,
                deployment,
                resource,
            );
            if (!record) {
                log(
                    `Skipping ${resource.hostname}: no broker state record exists`,
                );
                continue;
            }
            if (record.lifecycleStatus === "destroyed") {
                log(`Skipping ${record.hostname}: already destroyed`);
                continue;
            }
            await this.down(record.id, log, {
                skipActiveJobCheck: true,
                params,
            });
            downed += 1;
        }
        if (downed === 0)
            log(
                `Nothing to tear down for ${deployment.name}: all resources already destroyed`,
            );
    }

    async listResources(): Promise<ResourceRecord[]> {
        return await this.stateRepository.listResources();
    }

    async getResource(target: string): Promise<ResourceRecord | null> {
        return await this.stateRepository.getResource(target);
    }

    async refreshResourcePowerState(
        target: string,
        log: LogFn = () => undefined,
        options: ResourceBrokerRunOptions = {},
    ): Promise<ResourceRecord> {
        if (!options.skipActiveJobCheck) await this.ensureNoActiveJob();
        const record = await this.requireResource(target);
        const { context, provider } =
            await this.resolveResourcePowerContext(record);
        if (!provider.getResourcePowerState) {
            throw new Error(
                `Provider ${provider.type} does not support resource power state checks`,
            );
        }
        if (
            provider.supportsPowerControl &&
            !provider.supportsPowerControl(context, record)
        ) {
            throw new Error(
                `${record.hostname} is not power-controllable by provider ${provider.type}`,
            );
        }

        const powerState = await provider.getResourcePowerState(
            context,
            record,
            log,
        );
        if (
            options.patchUnchangedPowerState === false &&
            powerState === record.powerState
        ) {
            return record;
        }
        return await this.stateRepository.patchResource(record.id, {
            powerState,
            powerStateCheckedAt: nowIso(),
        });
    }

    // Open a provider-managed TCP port-forward from a resource to a local loopback
    // port. The provider-specific transport (e.g. AWS SSM) lives entirely in the
    // provider adapter; the tunnel manager owns the public proxy, port pool and TTL.
    // Providers without openPortForward yield a clean 400.
    async openResourcePortForward(
        record: ResourceRecord,
        request: ProviderPortForwardRequest,
        log: LogFn = () => undefined,
    ): Promise<ProviderPortForward> {
        const { context, provider } =
            await this.resolveResourcePowerContext(record);
        if (!provider.openPortForward) {
            throw httpError(
                400,
                `${record.hostname}: provider ${provider.type} does not support port forwarding`,
            );
        }
        return provider.openPortForward(context, record, request, log);
    }

    subscribeEvents(listener: BrokerEventListener): () => void {
        return this.stateRepository.events.subscribe(listener);
    }

    async startResource(
        target: string,
        log: LogFn,
        options: ResourceBrokerRunOptions = {},
    ): Promise<ResourceRecord> {
        if (!options.skipActiveJobCheck) await this.ensureNoActiveJob();
        const record = await this.requireResource(target);
        return await this.runResourcePowerAction("start", record, log);
    }

    async stopResource(
        target: string,
        log: LogFn,
        options: ResourceBrokerRunOptions = {},
    ): Promise<ResourceRecord> {
        if (!options.skipActiveJobCheck) await this.ensureNoActiveJob();
        const record = await this.requireResource(target);
        return await this.runResourcePowerAction("stop", record, log);
    }

    async powerResources(
        action: ResourcePowerAction,
        selector: ResourcePowerSelector,
        log: LogFn,
        options: ResourceBrokerRunOptions = {},
    ): Promise<ResourcePowerActionResult[]> {
        if (!options.skipActiveJobCheck) await this.ensureNoActiveJob();
        const resources = selectResources(
            await this.stateRepository.listResources(),
            selector,
        );
        if (!resources.length) {
            throw new Error(
                "No resources matched the requested power action selector",
            );
        }

        const results: ResourcePowerActionResult[] = [];
        for (const record of resources) {
            try {
                const support = await this.getPowerSupport(action, record);
                if (!support.supported) {
                    const message =
                        support.reason ??
                        `${record.hostname} is not power-controllable`;
                    log(`Skipping ${record.hostname}: ${message}`);
                    results.push({
                        action,
                        resource: record,
                        status: "skipped",
                        powerState: record.powerState,
                        message,
                    });
                    continue;
                }

                const resource = await this.runResourcePowerAction(
                    action,
                    record,
                    log,
                );
                results.push({
                    action,
                    resource,
                    status: "succeeded",
                    powerState: resource.powerState,
                });
            } catch (error) {
                const message =
                    error instanceof Error ? error.message : String(error);
                log(`Failed to ${action} ${record.hostname}: ${message}`);
                results.push({
                    action,
                    resource: record,
                    status: "failed",
                    powerState: record.powerState,
                    message,
                });
            }
        }

        return results;
    }

    async status(hostname?: string): Promise<unknown> {
        const state = await this.stateRepository.getState();
        if (!hostname) return state;
        return await this.stateRepository.getResource(hostname);
    }

    async runJob(
        action: JobRecord["action"],
        target: string,
        runner: (log: LogFn) => Promise<void>,
    ): Promise<JobRecord> {
        await this.ensureNoActiveJob();
        const job: JobRecord = {
            id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
            action,
            hostname: target,
            status: "running",
            startedAt: nowIso(),
            logs: [],
        };

        await this.stateRepository.setActiveJob(job.id);
        await this.stateRepository.saveJob(job);

        const log: LogFn = (line) => {
            job.logs.push(`[${new Date().toLocaleTimeString()}] ${line}`);
            void this.stateRepository.saveJob(job);
        };

        const releaseSecrets = await this.primeSecretOverlay();

        void runner(log)
            .then(async () => {
                job.status = "succeeded";
                job.finishedAt = nowIso();
                await this.stateRepository.saveJob(job);
            })
            .catch(async (error: unknown) => {
                job.status = "failed";
                job.finishedAt = nowIso();
                job.error =
                    error instanceof Error ? error.message : String(error);
                job.logs.push(
                    `[${new Date().toLocaleTimeString()}] ERROR: ${job.error}`,
                );
                await this.stateRepository.saveJob(job);
            })
            .finally(async () => {
                releaseSecrets();
                await this.stateRepository.setActiveJob(null);
            });

        return job;
    }

    // Loads the user's encrypted secrets into the *Env overlay for the duration of a
    // job (no-op in file mode, where secrets stay in process.env). Returns a release.
    private async primeSecretOverlay(): Promise<() => void> {
        if (!this.secretResolver) return () => {};
        installSecretOverlay(await this.secretResolver.hydrateAll());
        return () => clearSecretOverlay();
    }

    async getJob(jobId: string): Promise<JobRecord | null> {
        const jobs = await this.stateRepository.getJobs();
        return jobs.find((job) => job.id === jobId) ?? null;
    }

    private async requireExistingResource(
        target: string,
    ): Promise<ResourceRecord> {
        const record = await this.stateRepository.getResource(target);
        if (!record)
            throw new Error(
                `No resource named ${target} exists in broker state`,
            );
        return record;
    }

    private async requireResource(target: string): Promise<ResourceRecord> {
        const record = await this.stateRepository.getResource(target);
        if (!record)
            throw new Error(
                `No resource named ${target} exists in broker state`,
            );
        if (record.lifecycleStatus === "destroyed") {
            throw new Error(
                `${record.hostname} has been destroyed and cannot be power-controlled`,
            );
        }
        return record;
    }

    private async findDeploymentResourceRecord(
        configRef: string,
        deployment: DeploymentConfig,
        resource: ResourceConfig,
    ): Promise<ResourceRecord | null> {
        const configPath = this.resolveYamlPath(configRef);
        const resources = await this.stateRepository.listResources();
        return (
            resources.find(
                (record) =>
                    record.deploymentId === deployment.name &&
                    this.resolveYamlPath(record.configPath) === configPath &&
                    (record.hostname === resource.hostname ||
                        Boolean(
                            resource.name && record.name === resource.name,
                        )),
            ) ?? null
        );
    }

    private async runResourcePowerAction(
        action: ResourcePowerAction,
        record: ResourceRecord,
        log: LogFn,
    ): Promise<ResourceRecord> {
        const { context, provider } =
            await this.resolveResourcePowerContext(record);
        const method =
            action === "start" ? provider.startResource : provider.stopResource;
        if (!method) {
            throw new Error(
                `Provider ${provider.type} does not support resource ${action}`,
            );
        }
        if (
            provider.supportsPowerControl &&
            !provider.supportsPowerControl(context, record)
        ) {
            throw new Error(
                `${record.hostname} is not power-controllable by provider ${provider.type}`,
            );
        }

        const pendingState: ResourcePowerState =
            action === "start" ? "pending" : "stopping";
        const pending = await this.stateRepository.patchResource(record.id, {
            powerState: pendingState,
            powerStateCheckedAt: nowIso(),
        });

        const result = await method.call(provider, context, pending, log);

        return await this.stateRepository.patchResource(record.id, {
            powerState: result.powerState,
            powerStateCheckedAt: nowIso(),
        });
    }

    private async getPowerSupport(
        action: ResourcePowerAction,
        record: ResourceRecord,
    ): Promise<{ supported: boolean; reason?: string }> {
        if (record.lifecycleStatus === "destroyed") {
            return { supported: false, reason: "resource is destroyed" };
        }

        const { context, provider } =
            await this.resolveResourcePowerContext(record);
        const method =
            action === "start" ? provider.startResource : provider.stopResource;
        if (!method) {
            return {
                supported: false,
                reason: `provider ${provider.type} does not implement ${action}`,
            };
        }
        if (
            provider.supportsPowerControl &&
            !provider.supportsPowerControl(context, record)
        ) {
            return {
                supported: false,
                reason: `provider ${provider.type} does not support power control for ${record.kind ?? "unknown"}`,
            };
        }
        if (!record.providerResourceId) {
            return {
                supported: false,
                reason: "no provider resource id is recorded",
            };
        }
        return { supported: true };
    }

    private async resolveResourcePowerContext(record: ResourceRecord) {
        const deployment = await this.loadDeploymentConfig(record.configPath);
        const resource = findResource(deployment, record.hostname);
        const provider = getProviderAdapter(
            record.provider ?? deployment.provider.type,
        );
        return {
            deployment,
            resource,
            provider,
            context: {
                configPath: record.configPath,
                configLoader: this,
                stateRepository: this.stateRepository,
                deployment,
                resource,
            },
        };
    }

    private resourceAdapterContext<TResource extends ResourceConfig>(
        configPath: string,
        deployment: DeploymentConfig,
        resource: TResource,
        provider: ReturnType<typeof getProviderAdapter>,
        params?: Record<string, unknown>,
    ): ResourceAdapterContext<TResource> {
        return {
            configPath,
            configLoader: this,
            stateRepository: this.stateRepository,
            deployment,
            resource,
            provider,
            terraform: this.terraform,
            params,
        };
    }

    private async ensureNoActiveJob(): Promise<void> {
        const state = await this.stateRepository.getState();
        if (state.activeJobId) {
            throw new Error(
                `Another job is already running: ${state.activeJobId}`,
            );
        }
    }
}

function selectResources(
    resources: ResourceRecord[],
    selector: ResourcePowerSelector,
): ResourceRecord[] {
    const targets = new Set((selector.targets ?? []).filter(Boolean));
    const includeKinds = new Set((selector.includeKinds ?? []).filter(Boolean));
    const excludeKinds = new Set((selector.excludeKinds ?? []).filter(Boolean));
    const configPath = selector.configPath
        ? resolveProjectFilePath(selector.configPath)
        : null;

    return resources.filter((resource) => {
        if (targets.size > 0 && !resourceMatchesTarget(resource, targets))
            return false;
        if (
            selector.deploymentId &&
            resource.deploymentId !== selector.deploymentId
        )
            return false;
        if (
            configPath &&
            resolveProjectFilePath(resource.configPath) !== configPath
        )
            return false;
        if (
            includeKinds.size > 0 &&
            (!resource.kind || !includeKinds.has(resource.kind))
        )
            return false;
        if (resource.kind && excludeKinds.has(resource.kind)) return false;
        return true;
    });
}

function resourceMatchesTarget(
    resource: ResourceRecord,
    targets: Set<string>,
): boolean {
    return (
        targets.has(resource.id) ||
        targets.has(resource.hostname) ||
        Boolean(resource.name && targets.has(resource.name))
    );
}

function isProvisionStepAction(action: string): boolean {
    return action === "up" || action === "apply-resource";
}

function findResource(
    deployment: DeploymentConfig,
    target?: string,
): ResourceConfig {
    const resource = target
        ? deployment.resources.find(
              (candidate) =>
                  candidate.hostname === target || candidate.name === target,
          )
        : deployment.resources[0];
    if (!resource) {
        const suffix = target ? ` named ${target}` : "";
        throw new Error(
            `Deployment ${deployment.name} has no resource${suffix}`,
        );
    }
    return resource;
}

function validateDeploymentConfig(
    deployment: DeploymentConfig,
    configRef: string,
): void {
    const prefix = `Invalid config ${configRef}:`;
    if (!deployment.name) throw new Error(`${prefix} name is required`);
    if (!deployment.provider?.type)
        throw new Error(`${prefix} provider.type is required`);
    if (!deployment.resources?.length)
        throw new Error(`${prefix} resources must not be empty`);

    for (const step of deployment.steps ?? []) {
        const stepPrefix = `${prefix} step ${step.name ?? step.action ?? "(unnamed)"}:`;
        if (!step.name) throw new Error(`${stepPrefix} name is required`);
        if (!step.action) throw new Error(`${stepPrefix} action is required`);
        if (step.enabled !== undefined && typeof step.enabled !== "boolean") {
            throw new Error(`${stepPrefix} enabled must be a boolean`);
        }
        if (step.when !== undefined) {
            if (!isRecord(step.when))
                throw new Error(`${stepPrefix} when must be an object`);
            if (typeof step.when.param !== "string" || !step.when.param) {
                throw new Error(`${stepPrefix} when.param is required`);
            }
            const equalsType = typeof step.when.equals;
            if (
                step.when.equals !== undefined &&
                step.when.equals !== null &&
                equalsType !== "string" &&
                equalsType !== "number" &&
                equalsType !== "boolean"
            ) {
                throw new Error(
                    `${stepPrefix} when.equals must be a string, number, boolean, or null`,
                );
            }
        }
    }

    for (const resource of deployment.resources) {
        const resourcePrefix = `${prefix} resource ${resource.hostname ?? resource.name ?? resource.kind}:`;
        if (!resource.kind)
            throw new Error(`${resourcePrefix} kind is required`);
        if (!resource.hostname)
            throw new Error(`${resourcePrefix} hostname is required`);
        validateResourcePlacement(
            deployment,
            resource.placement,
            resourcePrefix,
        );
    }
}

function validateResourcePlacement(
    deployment: DeploymentConfig,
    placement: ResourcePlacementConfig | undefined,
    prefix: string,
): void {
    if (!placement) throw new Error(`${prefix} placement is required`);
    if (placement.provider && placement.provider !== deployment.provider.type) {
        throw new Error(
            `${prefix} placement.provider ${placement.provider} does not match deployment provider ${deployment.provider.type}`,
        );
    }
    validateNetworkPlacement(placement.network, prefix);
}

function validateNetworkPlacement(
    network: ResourcePlacementConfig["network"] | undefined,
    prefix: string,
): void {
    if (network === undefined || network === null) return;
    if (!isRecord(network))
        throw new Error(`${prefix} placement.network must be an object`);

    if (
        network.mode !== undefined &&
        network.mode !== null &&
        network.mode !== "managed" &&
        network.mode !== "existing"
    ) {
        throw new Error(
            `${prefix} placement.network.mode must be managed or existing`,
        );
    }

    if (network.interfaces !== undefined && network.interfaces !== null) {
        if (!isRecord(network.interfaces)) {
            throw new Error(
                `${prefix} placement.network.interfaces must be an object`,
            );
        }
        for (const [name, value] of Object.entries(network.interfaces)) {
            if (!isRecord(value)) {
                throw new Error(
                    `${prefix} placement.network.interfaces.${name} must be an object`,
                );
            }
        }
    }

    if (network.nextHop !== undefined && network.nextHop !== null) {
        if (!isRecord(network.nextHop))
            throw new Error(
                `${prefix} placement.network.nextHop must be an object`,
            );
        if (
            network.nextHop.type !== undefined &&
            network.nextHop.type !== null &&
            typeof network.nextHop.type !== "string"
        ) {
            throw new Error(
                `${prefix} placement.network.nextHop.type must be a string`,
            );
        }
    }

    if (network.mode === "existing" && !hasExistingNetworkReference(network)) {
        throw new Error(
            `${prefix} placement.network.mode existing requires vpcId, subnetId, routeTableId, or interfaces`,
        );
    }
}

function hasExistingNetworkReference(
    network: NonNullable<ResourcePlacementConfig["network"]>,
): boolean {
    return (
        hasPlacementValue(network.vpcId) ||
        hasPlacementValue(network.subnetId) ||
        hasPlacementValue(network.routeTableId) ||
        Boolean(
            network.interfaces && Object.keys(network.interfaces).length > 0,
        )
    );
}

function hasPlacementValue(value: unknown): boolean {
    return value !== undefined && value !== null && value !== "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function inYamlGroup(normalizedPath: string, group: string): boolean {
    return (
        normalizedPath === group ||
        normalizedPath.startsWith(`${group}/`) ||
        normalizedPath.includes(`/${group}/`)
    );
}
