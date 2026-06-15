// Provisioning (homelab) HTTP surface. Wraps the in-process ProvisioningService:
// discovery + resource reads + quick power toggles run inline; lifecycle verbs
// (deploy/deprovision/up/down/run-action) enqueue a durable job the DB-claim
// worker executes, so a slow terraform apply never holds a request open. The
// service is pinned to the single default user (auth is out of scope), so these
// routes don't scope by request.userId.
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ProvisioningService } from '../../services/provisioning/index.js';

const TAG = 'provisioning';
const paramsBody = {
  type: 'object',
  properties: { params: { type: 'object', additionalProperties: true, description: 'Deploy-time step toggles (the deployment\'s `when` inputs).' } },
  additionalProperties: false,
} as const;

function fail(reply: FastifyReply, err: unknown) {
  const e = err as { statusCode?: number; message?: string };
  reply.code(e.statusCode ?? 500);
  return { error: e.message ?? 'Internal error' };
}

export default async function provisioningRoutes(
  fastify: FastifyInstance,
  { provisioningService }: { provisioningService: ProvisioningService },
) {
  // ── discovery ───────────────────────────────────────────────────────────────
  fastify.get('/provisioning/deployments', {
    schema: { description: 'List every available deployment (summary): provider, resource kinds, whether it is `deployable` (has steps) vs resource-only.', tags: [TAG] },
  }, async () => provisioningService.listDeployments());

  fastify.get<{ Params: { id: string } }>('/provisioning/deployments/:id', {
    schema: {
      description: 'Full descriptor for one deployment: resources, ordered steps, inferred inputs, and the required secret env names (`requiredEnv`).',
      tags: [TAG],
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string', description: 'Deployment slug (e.g. aws-gp-lab-trusted-users)' } } },
    },
  }, async (request, reply) => {
    const descriptor = await provisioningService.getDeployment(request.params.id);
    if (!descriptor) { reply.code(404); return { error: `No deployment "${request.params.id}"` }; }
    return descriptor;
  });

  // ── resources (reads + power) ────────────────────────────────────────────────
  fastify.get('/provisioning/resources', {
    schema: { description: 'List every provisioned resource (broker runtime state): lifecycle status, provider ids, power state.', tags: [TAG] },
  }, async () => provisioningService.listResources());

  fastify.get<{ Params: { id: string } }>('/provisioning/resources/:id', {
    schema: { description: 'Get one provisioned resource by id, hostname, or name.', tags: [TAG], params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } },
  }, async (request, reply) => {
    const record = await provisioningService.getResource(request.params.id);
    if (!record) { reply.code(404); return { error: `No resource "${request.params.id}"` }; }
    return record;
  });

  fastify.get<{ Params: { id: string } }>('/provisioning/resources/:id/power-state', {
    schema: { description: 'Refresh a resource\'s power state from the cloud provider (read-only against infra; patches broker state). Works during an active lifecycle job.', tags: [TAG], params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } },
  }, async (request, reply) => {
    try { return await provisioningService.refreshPowerState(request.params.id); }
    catch (err) { return fail(reply, err); }
  });

  fastify.post<{ Params: { id: string } }>('/provisioning/resources/:id/start', {
    schema: { description: 'Power on a resource (provider start). 409 while a lifecycle job is active.', tags: [TAG], params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } },
  }, async (request, reply) => {
    try { return await provisioningService.startResource(request.params.id); }
    catch (err) { return fail(reply, err); }
  });

  fastify.post<{ Params: { id: string } }>('/provisioning/resources/:id/stop', {
    schema: { description: 'Power off a resource (provider stop). 409 while a lifecycle job is active.', tags: [TAG], params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } },
  }, async (request, reply) => {
    try { return await provisioningService.stopResource(request.params.id); }
    catch (err) { return fail(reply, err); }
  });

  // ── lifecycle (enqueue a durable job → 202) ──────────────────────────────────
  fastify.post<{ Params: { id: string }; Body: { params?: Record<string, unknown> } }>('/provisioning/deployments/:id/deploy', {
    schema: { description: 'Enqueue a full `deploy` (run the deployment\'s steps). Returns the queued job; poll GET /provisioning/jobs/:id.', tags: [TAG], params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } }, body: paramsBody },
  }, async (request, reply) => {
    try { reply.code(202); return await provisioningService.enqueueJob({ kind: 'deploy', deployment: request.params.id, params: request.body?.params }); }
    catch (err) { return fail(reply, err); }
  });

  fastify.post<{ Params: { id: string }; Body: { params?: Record<string, unknown> } }>('/provisioning/deployments/:id/deprovision', {
    schema: { description: 'Enqueue a `deprovision` (tear down the deployment\'s provisioned resources in reverse). Returns the queued job.', tags: [TAG], params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } }, body: paramsBody },
  }, async (request, reply) => {
    try { reply.code(202); return await provisioningService.enqueueJob({ kind: 'deprovision', deployment: request.params.id, params: request.body?.params }); }
    catch (err) { return fail(reply, err); }
  });

  fastify.post<{ Params: { id: string; target: string }; Body: { params?: Record<string, unknown> } }>('/provisioning/deployments/:id/resources/:target/up', {
    schema: { description: 'Enqueue an `up` for a single resource in a deployment. Returns the queued job.', tags: [TAG], params: { type: 'object', required: ['id', 'target'], properties: { id: { type: 'string' }, target: { type: 'string', description: 'Resource hostname or name' } } }, body: paramsBody },
  }, async (request, reply) => {
    try { reply.code(202); return await provisioningService.enqueueJob({ kind: 'up', deployment: request.params.id, target: request.params.target, params: request.body?.params }); }
    catch (err) { return fail(reply, err); }
  });

  fastify.post<{ Params: { id: string }; Body: { params?: Record<string, unknown> } }>('/provisioning/resources/:id/down', {
    schema: { description: 'Enqueue a `down` (destroy) for one provisioned resource by id/hostname/name. Returns the queued job.', tags: [TAG], params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } }, body: paramsBody },
  }, async (request, reply) => {
    try { reply.code(202); return await provisioningService.enqueueJob({ kind: 'down', target: request.params.id, params: request.body?.params }); }
    catch (err) { return fail(reply, err); }
  });

  fastify.post<{ Params: { id: string; target: string; action: string }; Body: { params?: Record<string, unknown> } }>('/provisioning/deployments/:id/resources/:target/actions/:action', {
    schema: { description: 'Enqueue a resource-specific action (e.g. verify-connected-resources on a Panorama). Returns the queued job.', tags: [TAG], params: { type: 'object', required: ['id', 'target', 'action'], properties: { id: { type: 'string' }, target: { type: 'string' }, action: { type: 'string' } } }, body: paramsBody },
  }, async (request, reply) => {
    try { reply.code(202); return await provisioningService.enqueueJob({ kind: 'run-action', deployment: request.params.id, target: request.params.target, resourceAction: request.params.action, params: request.body?.params }); }
    catch (err) { return fail(reply, err); }
  });

  // ── jobs (poll + cancel) ─────────────────────────────────────────────────────
  fastify.get<{ Querystring: { status?: string; limit?: number } }>('/provisioning/jobs', {
    schema: {
      description: 'List recent provisioning jobs (newest first), optionally filtered by status.',
      tags: [TAG],
      querystring: { type: 'object', properties: { status: { type: 'string', enum: ['queued', 'running', 'succeeded', 'failed', 'canceled'] }, limit: { type: 'integer', minimum: 1, maximum: 200 } } },
    },
  }, async (request) => provisioningService.listJobs({ status: request.query.status, limit: request.query.limit }));

  fastify.get<{ Params: { id: string } }>('/provisioning/jobs/:id', {
    schema: { description: 'Get one job with its streamed log lines. Poll this to follow a deploy.', tags: [TAG], params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } },
  }, async (request, reply) => {
    const job = await provisioningService.getJob(request.params.id);
    if (!job) { reply.code(404); return { error: `No job "${request.params.id}"` }; }
    return job;
  });

  fastify.post<{ Params: { id: string } }>('/provisioning/jobs/:id/cancel', {
    schema: { description: 'Request cancellation. A queued job is canceled immediately; a running job gets a flag the worker polls — it terminates the spawned terraform child and transitions the job to `canceled`.', tags: [TAG], params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } },
  }, async (request, reply) => {
    const job = await provisioningService.requestCancel(request.params.id);
    if (!job) { reply.code(404); return { error: `No job "${request.params.id}"` }; }
    return job;
  });

  // ── secrets (encrypted at rest; values never returned) ───────────────────────
  fastify.get('/provisioning/secrets', {
    schema: { description: 'List secret names + descriptions (no values). These satisfy a deployment\'s `requiredEnv`.', tags: [TAG] },
  }, async () => provisioningService.listSecrets());

  fastify.put<{ Params: { name: string }; Body: { value: string; description?: string } }>('/provisioning/secrets/:name', {
    schema: {
      description: 'Create or replace a secret (UPPER_SNAKE name, e.g. PANW_PANORAMA_AUTH_CODE). Encrypted at rest with AES-256-GCM; the value is write-only.',
      tags: [TAG],
      params: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } },
      body: { type: 'object', required: ['value'], properties: { value: { type: 'string' }, description: { type: 'string' } }, additionalProperties: false },
    },
  }, async (request, reply) => {
    try { return await provisioningService.setSecret(request.params.name, request.body.value, request.body.description); }
    catch (err) { return fail(reply, err); }
  });

  fastify.delete<{ Params: { name: string } }>('/provisioning/secrets/:name', {
    schema: { description: 'Delete a secret by name.', tags: [TAG], params: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } } },
  }, async (request, reply) => {
    const deleted = await provisioningService.deleteSecret(request.params.name);
    if (!deleted) { reply.code(404); return { error: `No secret "${request.params.name}"` }; }
    return { name: request.params.name, deleted: true };
  });

  // ── config seed (idempotent import of shipped database/*.yaml) ────────────────
  fastify.post('/provisioning/seed', {
    schema: { description: 'Seed/refresh the config tables (deployments, provider/resource profiles) from the shipped database/*.yaml. Idempotent.', tags: [TAG] },
  }, async () => provisioningService.seed());
}
