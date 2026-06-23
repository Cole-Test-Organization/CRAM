// Provisioning (homelab) HTTP surface. Wraps the in-process ProvisioningService:
// discovery + resource reads + quick power toggles run inline; lifecycle verbs
// (deploy/deprovision/up/down/run-action) enqueue a durable job the DB-claim
// worker executes, so a slow terraform apply never holds a request open. The
// service is pinned to the single default user (auth is out of scope), so these
// routes don't scope by request.userId.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ProvisioningService } from '../../services/provisioning/index.js';
import type { BrokerEvent } from '../../services/provisioning/events.js';
import type { JobRecord } from '../../services/provisioning/types/index.js';

const TAG = 'provisioning';
const paramsBody = {
  type: 'object',
  properties: { params: { type: 'object', additionalProperties: true, description: 'Deploy-time inputs, including declared launch inputs and step toggles (`when` params).' } },
  additionalProperties: false,
} as const;
const rdpTunnelBody = {
  type: 'object',
  properties: {
    port: { type: 'integer', minimum: 1, maximum: 65535, description: 'Optional LAN-facing port from PROVISIONING_RDP_TUNNEL_PORTS.' },
    remotePort: { type: 'integer', minimum: 1, maximum: 65535, description: 'Remote Windows port. Defaults to 3389.' },
    ttlSeconds: { type: 'integer', minimum: 0, description: 'Seconds before the broker closes the tunnel. 0 disables TTL.' },
  },
  additionalProperties: false,
} as const;

function fail(reply: FastifyReply, err: unknown) {
  const e = err as { statusCode?: number; message?: string };
  reply.code(e.statusCode ?? 500);
  return { error: e.message ?? 'Internal error' };
}

function streamEnvelope(type: string, data: unknown) {
  return {
    type,
    ts: new Date().toISOString(),
    data,
  };
}

function writeSse(reply: FastifyReply, type: string, data: unknown): void {
  if (reply.raw.writableEnded || reply.raw.destroyed) return;
  reply.raw.write(`data: ${JSON.stringify(streamEnvelope(type, data))}\n\n`);
}

function firstHeader(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function hostFromAuthority(value: string | null): string | null {
  const raw = value?.split(',')[0]?.trim();
  if (!raw) return null;
  const withoutProtocol = raw.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  const authority = withoutProtocol.split('/')[0]?.trim();
  if (!authority) return null;
  if (authority.startsWith('[')) {
    const end = authority.indexOf(']');
    return end > 0 ? authority.slice(1, end) : authority;
  }
  const hasSingleColon = authority.indexOf(':') === authority.lastIndexOf(':');
  return hasSingleColon && authority.includes(':')
    ? authority.slice(0, authority.lastIndexOf(':'))
    : authority;
}

function advertisedTunnelHost(request: FastifyRequest): string | null {
  return hostFromAuthority(firstHeader(request.headers['x-forwarded-host'])) ??
    hostFromAuthority(firstHeader(request.headers.host)) ??
    hostFromAuthority(request.hostname);
}

function eventPayload(event: BrokerEvent): unknown {
  switch (event.type) {
    case 'active-job':
      return { activeJobId: event.activeJobId };
    case 'job':
      return jobRecordPayload(event.job);
    case 'resource':
      return event.resource;
    case 'state':
      return {
        activeJobId: event.state.activeJobId ?? null,
        resources: Object.values(event.state.resources ?? {}),
      };
  }
}

function jobRecordPayload(job: JobRecord) {
  return {
    id: job.id,
    action: job.action,
    target: job.hostname ?? null,
    deployment: null,
    resourceAction: null,
    status: job.status,
    cancelRequested: false,
    params: null,
    error: job.error ?? null,
    createdAt: null,
    startedAt: job.startedAt ?? null,
    finishedAt: job.finishedAt ?? null,
    logs: job.logs ?? [],
  };
}

export default async function provisioningRoutes(
  fastify: FastifyInstance,
  { provisioningService }: { provisioningService: ProvisioningService },
) {
  // ── discovery ───────────────────────────────────────────────────────────────
  fastify.get('/provisioning/deployments', {
    schema: { description: 'List every available deployment summary: provider, project, resource kinds, resource count, step count, and launch capability metadata.', tags: [TAG] },
  }, async () => provisioningService.listDeployments());

  fastify.get('/provisioning/providers/proxmox/discovery', {
    schema: { description: 'Discover the configured Proxmox cluster (nodes, templates, datastores, bridges, used VMIDs) to help fill in a Proxmox deployment. Reads PROXMOX_VE_ENDPOINT / PROXMOX_VE_API_TOKEN from stored secrets (or env).', tags: [TAG] },
  }, async (_request, reply) => {
    try {
      return await provisioningService.discoverProxmox();
    } catch (err) {
      return fail(reply, err);
    }
  });

  fastify.get('/provisioning/events', {
    schema: {
      description: 'Server-Sent Events stream for broker progress. Sends an initial snapshot, then job/resource/active-job updates as deployment state changes.',
      tags: [TAG],
      produces: ['text/event-stream'],
    },
  }, async (request, reply) => {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    let snapshotSent = false;
    let closed = false;
    const pending: BrokerEvent[] = [];
    const heartbeat = setInterval(() => {
      if (!reply.raw.writableEnded && !reply.raw.destroyed) {
        reply.raw.write(`: heartbeat ${new Date().toISOString()}\n\n`);
      }
    }, 25000);
    const unsubscribe = provisioningService.subscribeEvents((event) => {
      if (!snapshotSent) {
        pending.push(event);
        return;
      }
      writeSse(reply, event.type, eventPayload(event));
    });
    const closedPromise = new Promise<void>((resolve) => {
      request.raw.on('close', () => {
        closed = true;
        resolve();
      });
    });
    const cleanup = () => {
      clearInterval(heartbeat);
      unsubscribe();
    };

    try {
      writeSse(reply, 'snapshot', await provisioningService.getEventSnapshot());
      snapshotSent = true;
      for (const event of pending.splice(0)) {
        writeSse(reply, event.type, eventPayload(event));
      }
    } catch (err) {
      snapshotSent = true;
      writeSse(reply, 'error', { message: err instanceof Error ? err.message : String(err) });
    }
    if (!closed) await closedPromise;
    cleanup();
  });

  fastify.get<{ Params: { id: string } }>('/provisioning/deployments/:id', {
    schema: {
      description: 'Full descriptor for one deployment: resources, ordered steps, launch inputs, and the required secret env names (`requiredEnv`).',
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

  // ── runtime tunnels ────────────────────────────────────────────────────────
  fastify.get('/provisioning/tunnels', {
    schema: { description: 'List broker-managed runtime tunnels, including SSM-backed RDP tunnels. These are process-local sessions, not Terraform resources.', tags: [TAG] },
  }, async () => provisioningService.listRdpTunnels());

  fastify.post<{ Params: { id: string }; Body: { port?: number; remotePort?: number; ttlSeconds?: number } }>('/provisioning/resources/:id/rdp-tunnel', {
    schema: {
      description: 'Open an SSM-backed RDP tunnel for a Windows endpoint. The broker listens on a Docker-published LAN port and proxies to the private instance over SSM.',
      tags: [TAG],
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      body: rdpTunnelBody,
    },
  }, async (request, reply) => {
    try {
      return await provisioningService.openRdpTunnel(request.params.id, {
        port: request.body?.port,
        remotePort: request.body?.remotePort,
        ttlSeconds: request.body?.ttlSeconds,
        advertisedHost: advertisedTunnelHost(request),
      });
    } catch (err) { return fail(reply, err); }
  });

  fastify.delete<{ Params: { id: string } }>('/provisioning/tunnels/:id', {
    schema: { description: 'Close a broker-managed runtime tunnel by tunnel id.', tags: [TAG], params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } },
  }, async (request, reply) => {
    const closed = await provisioningService.closeRdpTunnel(request.params.id);
    if (!closed) { reply.code(404); return { error: `No tunnel "${request.params.id}"` }; }
    return closed;
  });

  fastify.delete<{ Params: { id: string } }>('/provisioning/resources/:id/rdp-tunnel', {
    schema: { description: 'Close the active RDP tunnel for a resource by resource id/hostname/name.', tags: [TAG], params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } },
  }, async (request, reply) => {
    const closed = await provisioningService.closeRdpTunnel(request.params.id);
    if (!closed) { reply.code(404); return { error: `No RDP tunnel for "${request.params.id}"` }; }
    return closed;
  });

  // ── lifecycle (enqueue a durable job → 202) ──────────────────────────────────
  fastify.post<{ Params: { id: string }; Body: { params?: Record<string, unknown> } }>('/provisioning/deployments/:id/deploy', {
    schema: { description: 'Enqueue a deployment. Deployments with steps run their workflow; deployments without steps create their configured resources. Returns the queued job; poll GET /provisioning/jobs/:id.', tags: [TAG], params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } }, body: paramsBody },
  }, async (request, reply) => {
    try { reply.code(202); return await provisioningService.enqueueJob({ kind: 'deploy', deployment: request.params.id, params: request.body?.params }); }
    catch (err) { return fail(reply, err); }
  });

  // Launch a named *instance* of a template deployment: clone it under a unique slug
  // (isolated Terraform workspaces + cloud names), then enqueue its deploy. Returns
  // the queued job whose `deployment` is the new instance slug.
  fastify.post<{ Params: { id: string }; Body: { name: string; params?: Record<string, unknown> } }>('/provisioning/deployments/:id/instances', {
    schema: { description: 'Create and deploy a named instance of a template deployment. Body `name` is the operator label (slugified into a unique deployment id). Returns the queued deploy job; its `deployment` field is the new instance slug.', tags: [TAG], params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } }, body: { type: 'object', required: ['name'], properties: { name: { type: 'string', minLength: 1 }, params: { type: 'object', additionalProperties: true } } } },
  }, async (request, reply) => {
    try { reply.code(202); return await provisioningService.createInstance(request.params.id, { name: request.body.name, params: request.body?.params }); }
    catch (err) { return fail(reply, err); }
  });

  // Delete an instance row (and its destroyed resource records). Refuses templates and
  // instances that still have live resources — deprovision first.
  fastify.delete<{ Params: { id: string } }>('/provisioning/deployments/:id', {
    schema: { description: 'Delete a deployment instance (a clone created via /instances). Refuses catalog templates and instances with live resources.', tags: [TAG], params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } },
  }, async (request, reply) => {
    try { return await provisioningService.deleteInstance(request.params.id); }
    catch (err) { return fail(reply, err); }
  });

  fastify.post<{ Params: { id: string }; Body: { params?: Record<string, unknown> } }>('/provisioning/deployments/:id/deprovision', {
    schema: { description: 'Enqueue a `deprovision` (tear down the deployment\'s provisioned resources in reverse). Returns the queued job.', tags: [TAG], params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } }, body: paramsBody },
  }, async (request, reply) => {
    try { reply.code(202); return await provisioningService.enqueueJob({ kind: 'deprovision', deployment: request.params.id, params: request.body?.params }); }
    catch (err) { return fail(reply, err); }
  });

  fastify.post<{ Params: { id: string; target: string }; Body: { params?: Record<string, unknown> } }>('/provisioning/deployments/:id/resources/:target/up', {
    schema: { description: 'Enqueue deployment of one specific resource. Returns the queued job.', tags: [TAG], params: { type: 'object', required: ['id', 'target'], properties: { id: { type: 'string' }, target: { type: 'string', description: 'Resource hostname or name' } } }, body: paramsBody },
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

  // ── config seed (idempotent seed of the typed config modules) ─────────────────
  fastify.post('/provisioning/seed', {
    schema: { description: 'Seed/refresh the config tables (deployments, provider/resource profiles) from the typed config modules (config/modules/**). Idempotent.', tags: [TAG] },
  }, async () => provisioningService.seed());
}
