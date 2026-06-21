import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { callService, errorResponse } from './helpers.js';

import type { AccountsService } from '../services/accounts/accounts.js';
import type { ContactsService } from '../services/contacts/contacts.js';
import type { MeetingsService } from '../services/meetings/meetings.js';
import type { SearchService } from '../services/search/search.js';
import type { TodoistService } from '../services/todoist/todoist.js';
import type { ExportService } from '../services/export/export.js';
import type { OutreachService } from '../services/outreach/outreach.js';
import type { EventsService } from '../services/events/events.js';
import type { OpportunitiesService } from '../services/opportunities/opportunities.js';
import type { ProductsService } from '../services/products/products.js';
import type { ProductCategoriesService } from '../services/products/product-categories.js';
import type { VendorsService } from '../services/vendors/vendors.js';
import type { VendorProductsService } from '../services/vendors/vendor-products.js';
import type { AccountDetailsService } from '../services/accounts/account-details.js';
import type { VendorHeatmapService } from '../services/accounts/vendor-heatmap.js';
import type { ImportExportService } from '../services/import-export/import-export.js';
import type { NotesImportService } from '../services/notes/notes-import.js';
import type { NotesService } from '../services/notes/notes.js';
import type { BackupService } from '../services/backup/backup.js';
import type { ContactEnrichmentService } from '../services/contacts/contact-enrichment.js';
import type { InternalDomainsService } from '../services/internal-domains/internal-domains.js';
import type { AgentSettingsService } from '../services/agent/agent-settings.js';
import type { MemoriesService } from '../services/memories/memories.js';
import type { ThreadsService } from '../services/threads/threads.js';
import type { ProvisioningService } from '../services/provisioning/index.js';

/**
 * The service bag handed to `registerTools` — built identically in
 * api/src/index.ts, api/src/mcp/server.ts, and api/src/agent/mcp-client.ts.
 * Typing it here means a change to any service method signature breaks the MCP
 * tool that consumes it: compiler-enforced HTTP↔MCP parity.
 */
export interface Services {
  accountsService: AccountsService;
  contactsService: ContactsService;
  meetingsService: MeetingsService;
  searchService: SearchService;
  todoistService: TodoistService | null;
  exportService: ExportService;
  outreachService: OutreachService;
  eventsService: EventsService;
  opportunitiesService: OpportunitiesService;
  productsService: ProductsService;
  productCategoriesService: ProductCategoriesService;
  vendorsService: VendorsService;
  vendorProductsService: VendorProductsService;
  accountDetailsService: AccountDetailsService;
  vendorHeatmapService: VendorHeatmapService;
  importExportService: ImportExportService;
  notesImportService: NotesImportService;
  notesService: NotesService;
  backupService: BackupService;
  contactEnrichmentService: ContactEnrichmentService;
  internalDomainsService: InternalDomainsService;
  agentSettingsService: AgentSettingsService;
  memoriesService: MemoriesService;
  threadsService: ThreadsService;
  provisioningService: ProvisioningService;
}

/** Resolves the current user id for a tool call (constant until auth lands). */
export type ResolveUserId = () => number | Promise<number>;

/**
 * Register all MCP tools on the server instance.
 * `resolveUserId` is a function that returns the current user ID for a call.
 * Until per-session auth lands it's a constant (the default user).
 */
export function registerTools(server: McpServer, services: Services, resolveUserId: ResolveUserId) {
  const { accountsService, contactsService, meetingsService, searchService, todoistService, exportService, outreachService, eventsService, opportunitiesService, productsService, productCategoriesService, vendorsService, vendorProductsService, accountDetailsService, vendorHeatmapService, importExportService, notesImportService, notesService, backupService, contactEnrichmentService, internalDomainsService, agentSettingsService, memoriesService, threadsService, provisioningService } = services;

  const todoistDest = () => {
    const project = process.env.TODOIST_DEFAULT_PROJECT || 'Inbox';
    const section = process.env.TODOIST_DEFAULT_SECTION || '';
    return section ? `the "${project} > ${section}" section` : `the "${project}" project`;
  };

  // ── provisioning (homelab infra broker) ───────────────────────────────

  server.tool(
    'provisioning',
    'Provision and manage homelab/cloud infrastructure (the ported panw-broker: Terraform + PAN-OS/AWS lifecycle). Discovery and reads are immediate; lifecycle verbs are **async** — they enqueue a durable job a background worker runs, so you get a job back and must poll `get_job` until status is `succeeded`/`failed`/`canceled` (logs stream into the job). Actions: list_deployments (what is deployable), get_deployment (resources, steps, inputs, and `requiredEnv` secret names), list_resources / get_resource (runtime state), event_snapshot (active job + resources + recent jobs baseline; GUI clients subscribe to HTTP SSE for live updates), power_state (refresh from the cloud), start / stop (quick power toggle — refused while a job runs), list_tunnels / open_rdp_tunnel / close_tunnel (broker-managed LAN RDP tunnel sessions for private Windows endpoints over SSM), deploy / deprovision (run/tear-down a whole deployment\'s steps), up (one resource) / down (destroy one resource), run_action (a resource-specific action like verify-connected-resources), list_jobs / get_job / cancel_job, list_secrets / set_secret / delete_secret (encrypted at rest; values are write-only and referenced by name from deployment config), seed (idempotently import the shipped database/*.yaml config). A deployment must be seeded before you can deploy/up it. Secrets needed by a deployment are its `requiredEnv`.',
    {
      action: z.enum(['list_deployments', 'get_deployment', 'list_resources', 'get_resource', 'event_snapshot', 'power_state', 'start', 'stop', 'list_tunnels', 'open_rdp_tunnel', 'close_tunnel', 'deploy', 'deprovision', 'up', 'down', 'run_action', 'list_jobs', 'get_job', 'cancel_job', 'list_secrets', 'set_secret', 'delete_secret', 'seed']),
      deployment: z.string().optional().describe('Deployment slug (e.g. aws-gp-lab-trusted-users) — for get_deployment, deploy, deprovision, up, run_action.'),
      target: z.string().optional().describe('Resource hostname/name/id — for get_resource, power_state, start, stop, up, down, run_action, open_rdp_tunnel, close_tunnel by resource.'),
      resource_action: z.string().optional().describe('Resource-specific action name — for run_action (e.g. verify-connected-resources).'),
      tunnel_id: z.string().optional().describe('Runtime tunnel id — for close_tunnel.'),
      job_id: z.string().optional().describe('Job id — for get_job, cancel_job.'),
      name: z.string().optional().describe('Secret name (UPPER_SNAKE, e.g. PANW_PANORAMA_AUTH_CODE) — for set_secret, delete_secret.'),
      value: z.string().optional().describe('Secret value — for set_secret (write-only; never returned).'),
      description: z.string().optional().describe('Optional secret description — for set_secret.'),
      status: z.enum(['queued', 'running', 'succeeded', 'failed', 'canceled']).optional().describe('Filter list_jobs by status.'),
      limit: z.number().optional().describe('Max jobs for list_jobs (default 50).'),
      port: z.number().int().positive().optional().describe('LAN-facing RDP tunnel port from PROVISIONING_RDP_TUNNEL_PORTS — for open_rdp_tunnel.'),
      remote_port: z.number().int().positive().optional().describe('Remote Windows port for open_rdp_tunnel; defaults to 3389.'),
      ttl_seconds: z.number().int().nonnegative().optional().describe('Seconds before the broker closes the RDP tunnel; 0 disables TTL.'),
      params: z.record(z.any()).optional().describe('Deploy-time step toggles (the deployment\'s `when` inputs) — for deploy/deprovision/up/down/run_action.'),
    },
    async ({ action, deployment, target, resource_action, tunnel_id, job_id, name, value, description, status, limit, port, remote_port, ttl_seconds, params }) => {
      switch (action) {
        case 'list_deployments':
          return callService(() => provisioningService.listDeployments());
        case 'get_deployment':
          if (!deployment) return errorResponse('get_deployment requires `deployment` (a deployment slug). Use action list_deployments to see slugs.');
          return callService(() => provisioningService.getDeployment(deployment), { notFoundMsg: `No deployment "${deployment}".` });
        case 'list_resources':
          return callService(() => provisioningService.listResources());
        case 'get_resource':
          if (!target) return errorResponse('get_resource requires `target` (resource id, hostname, or name).');
          return callService(() => provisioningService.getResource(target), { notFoundMsg: `No resource "${target}".` });
        case 'event_snapshot':
          return callService(() => provisioningService.getEventSnapshot());
        case 'power_state':
          if (!target) return errorResponse('power_state requires `target`.');
          return callService(() => provisioningService.refreshPowerState(target));
        case 'start':
          if (!target) return errorResponse('start requires `target`.');
          return callService(() => provisioningService.startResource(target));
        case 'stop':
          if (!target) return errorResponse('stop requires `target`.');
          return callService(() => provisioningService.stopResource(target));
        case 'list_tunnels':
          return callService(() => provisioningService.listRdpTunnels());
        case 'open_rdp_tunnel':
          if (!target) return errorResponse('open_rdp_tunnel requires `target` (Windows resource id/hostname/name).');
          return callService(() => provisioningService.openRdpTunnel(target, {
            port,
            remotePort: remote_port,
            ttlSeconds: ttl_seconds,
          }));
        case 'close_tunnel': {
          const id = tunnel_id || target;
          if (!id) return errorResponse('close_tunnel requires `tunnel_id` or `target`.');
          return callService(() => provisioningService.closeRdpTunnel(id), { notFoundMsg: `No tunnel "${id}".` });
        }
        case 'deploy':
          if (!deployment) return errorResponse('deploy requires `deployment`. Returns a queued job — poll get_job.');
          return callService(() => provisioningService.enqueueJob({ kind: 'deploy', deployment, params }));
        case 'deprovision':
          if (!deployment) return errorResponse('deprovision requires `deployment`. Returns a queued job — poll get_job.');
          return callService(() => provisioningService.enqueueJob({ kind: 'deprovision', deployment, params }));
        case 'up':
          if (!deployment || !target) return errorResponse('up requires `deployment` and `target` (the resource). Returns a queued job.');
          return callService(() => provisioningService.enqueueJob({ kind: 'up', deployment, target, params }));
        case 'down':
          if (!target) return errorResponse('down requires `target` (resource id/hostname/name). Returns a queued job.');
          return callService(() => provisioningService.enqueueJob({ kind: 'down', target, params }));
        case 'run_action':
          if (!deployment || !target || !resource_action) return errorResponse('run_action requires `deployment`, `target`, and `resource_action`. Returns a queued job.');
          return callService(() => provisioningService.enqueueJob({ kind: 'run-action', deployment, target, resourceAction: resource_action, params }));
        case 'list_jobs':
          return callService(() => provisioningService.listJobs({ status, limit }));
        case 'get_job':
          if (!job_id) return errorResponse('get_job requires `job_id`.');
          return callService(() => provisioningService.getJob(job_id), { notFoundMsg: `No job "${job_id}".` });
        case 'cancel_job':
          if (!job_id) return errorResponse('cancel_job requires `job_id`.');
          return callService(() => provisioningService.requestCancel(job_id), { notFoundMsg: `No job "${job_id}".` });
        case 'list_secrets':
          return callService(() => provisioningService.listSecrets());
        case 'set_secret':
          if (!name || !value) return errorResponse('set_secret requires `name` (UPPER_SNAKE) and `value`.');
          return callService(() => provisioningService.setSecret(name, value, description));
        case 'delete_secret':
          if (!name) return errorResponse('delete_secret requires `name`.');
          return callService(() => provisioningService.deleteSecret(name).then((deleted) => (deleted ? { name, deleted } : null)), { notFoundMsg: `No secret "${name}".` });
        case 'seed':
          return callService(() => provisioningService.seed());
        default:
          return errorResponse(`Unknown provisioning action: ${action}`);
      }
    },
  );

  // ── accounts ──────────────────────────────────────────────────────────

  server.tool(
    'accounts',
    'Manage CRM accounts (companies). **If you only have a company name (e.g. "FixtureCorp"), use the `search` tool (type="accounts") first — slug/domain/id lookups here all require structured input and will reject or 404 on a bare name.** Actions: list (returns ALL account slugs as a flat string array — no filtering, no pagination, no extra fields; drill into any specific account with `get`), list_full (full account rows with filters/sort/pagination — pass `status`/`exclude_status` to filter customers vs partners; mirrors `GET /api/accounts`), get (by id/slug/domain — returns full account with contacts, meetings, and linked partners), find_existing (pre-create dedupe probe — same match rules `create` uses: slug → domain → case-insensitive name; returns the match or null), find_or_create (idempotent classifier for ingestion/triage — exact tiers + near-exact fuzzy name return status="matched" with the enriched account; mid-confidence fuzzy names return status="ambiguous" with ranked triage candidates and write nothing; nothing over the suggest floor returns status="none"; set create_if_missing=true to insert when "none" → status="created". Never silently merges a weak match — prefer this over create when ingesting companies from notes/email), create, update (PATCH merge — domains fully replaced), delete, list_partners (channel partner accounts linked to this account), add_partner (link a partner account by id), remove_partner (unlink). Partner contacts live as contacts with kind=partner on the partner account; teammates at your own company live as contacts with kind=internal (not tied to any account). Technical environment (firewalls, EDRs, employee count, site count, …) lives in a separate `account_details` tool — do NOT shove it into this account record.',
    {
      action: z.enum(['list', 'list_full', 'get', 'find_existing', 'find_or_create', 'create', 'update', 'delete', 'list_partners', 'add_partner', 'remove_partner']),
      id: z.number().optional().describe('Account ID (for get, update, delete, list_partners, add_partner, remove_partner)'),
      partner_id: z.number().optional().describe('Partner account ID (for add_partner, remove_partner)'),
      slug: z.string().optional().describe('Account slug — lowercase-hyphenated alphanumeric (e.g. "acme-manufacturing", "fixturecorp-test"). For get by slug, or in data for create. If you only have a company name (e.g. "FixtureCorp"), call the `search` tool with `type="accounts"` instead — slug lookups require the exact slug, not the display name.'),
      domain: z.string().optional().describe('Real domain only — must contain "." (e.g. "acme.com"). Case-insensitive, www./protocol/path stripped. Matches any entry in the account\'s domains list. If you only have a company name (e.g. "FixtureCorp"), call the `search` tool with `type="accounts"` instead; if you have the URL slug, pass `slug`.'),
      status: z.string().optional().describe('Filter to accounts whose status matches, case-insensitive (for list_full). Use "account" or "partner".'),
      exclude_status: z.string().optional().describe('Filter out accounts whose status matches, case-insensitive (for list_full). Typically "partner" to list non-partner accounts.'),
      needs_review: z.boolean().optional().describe('Filter list_full by the review flag (true = only accounts flagged for review, e.g. auto-created by the notes importer; false = only verified; omit for both).'),
      create_if_missing: z.boolean().optional().describe('For find_or_create: insert a new account when the classification is "none" (off by default — usually you want to surface ambiguity for triage first). The matching tiers still run first, so this never creates a duplicate of a confident match.'),
      fuzzy: z.boolean().optional().describe('For find_or_create: run the pg_trgm fuzzy-name tier (default true). Set false to match only on exact slug/domain/name — e.g. bundle import where the slug is the identity and a fuzzy auto-merge would be wrong.'),
      sort: z.enum(['name', 'slug', 'status', 'last_contact', 'created_at', 'updated_at']).optional().describe('Sort column (for list_full, default name)'),
      order: z.enum(['asc', 'desc']).optional().describe('Sort order (for list_full, default asc)'),
      limit: z.number().optional().describe('Page size (for list_full). Omit to return all rows.'),
      offset: z.number().optional().describe('Page offset (for list_full, default 0)'),
      data: z.object({
        slug: z.string().optional(),
        name: z.string().optional(),
        status: z.string().optional(),
        last_contact: z.string().optional(),
        relationship_summary: z.string().optional(),
        active_deals: z.string().optional(),
        domains: z.array(z.string()).optional().describe('Domains associated with this account (e.g., ["acme.com", "acme-ventures.com"]). Full replace on update.'),
        favorite: z.boolean().optional().describe('Per-user favorite flag — pinned rows sort to the top of list_full.'),
        needs_review: z.boolean().optional().describe('Review flag. Set false on update to clear it after verifying an auto-created account (triage).'),
      }).optional().describe('Account data (for create/update)'),
    },
    async ({ action, id, partner_id, slug, domain, status, exclude_status, needs_review, create_if_missing, fuzzy, sort, order, limit, offset, data }) => {
      const userId = await resolveUserId();
      switch (action) {
        case 'list':
          return callService(() => accountsService.getAllSlugs(userId).then(slugs => ({ slugs })));
        case 'list_full':
          return callService(() => accountsService.getAll(userId, { status, exclude_status, needs_review, sort, order, limit, offset }));
        case 'get':
          if (slug) return callService(() => accountsService.getBySlug(userId, slug), { notFoundMsg: `No account with slug "${slug}". Try the search tool (type="accounts") to fuzzy-match by name — slugs are exact.` });
          if (domain) return callService(() => accountsService.getByDomain(userId, domain), { notFoundMsg: `No account associated with domain "${domain}". Try the search tool (type="accounts") to fuzzy-match by name.` });
          if (id) return callService(() => accountsService.getById(userId, id), { notFoundMsg: `Account not found: id=${id}. Try action="list" for all slugs, or the search tool (type="accounts") to find one by name.` });
          return errorResponse('get requires one of id, slug, or domain. If you only have a company name, use the search tool (type="accounts") instead.');
        case 'find_existing':
          if (!data || (!data.slug && !data.name && !(Array.isArray(data.domains) && data.domains.length))) {
            return errorResponse('find_existing requires data with at least one of: slug, name, or domains[]. Uses the same match rules as create (slug → domain → case-insensitive name). Returns null when nothing matches.');
          }
          return callService(() => accountsService.findExisting(userId, data));
        case 'find_or_create':
          if (!data || (!data.slug && !data.name && !(Array.isArray(data.domains) && data.domains.length))) {
            return errorResponse('find_or_create requires data with at least one of: slug, name, or domains[]. Returns a decision object: status "matched" (account + matched_by, plus match_score when fuzzy) | "ambiguous" (candidates[] for triage, nothing written) | "none". Pass create_if_missing=true to insert on "none" (status becomes "created"). Pass fuzzy=false to skip the pg_trgm tier (exact slug/domain/name only).');
          }
          return callService(() => accountsService.findOrCreate(userId, data, { createIfMissing: !!create_if_missing, fuzzy: fuzzy !== false }));
        case 'create':
          if (!data?.slug || !data?.name) return errorResponse('create requires data.slug (lowercase-hyphenated, e.g. "acme-manufacturing") and data.name (display name, e.g. "Acme Manufacturing"). Optional: data.domains, data.status ("account" default | "partner"), data.relationship_summary.');
          return callService(() => accountsService.create(userId, data));
        case 'update':
          if (!id) return errorResponse('update requires id (the numeric account id). If you only have a slug/name, call action="get" with slug or the search tool first to resolve the id.');
          if (!data) return errorResponse('update requires data (a partial account object — only fields you send are changed). The domains array is FULLY replaced when present; send the complete list.');
          return callService(() => accountsService.patch(userId, id, data), { notFoundMsg: `Account not found: id=${id}. Try action="list" or the search tool to find the right id.` });
        case 'delete':
          if (!id) return errorResponse('delete requires id (the numeric account id). If you only have a slug/name, call action="get" with slug or the search tool first.');
          return callService(() => accountsService.delete(userId, id), { notFoundMsg: `Account not found: id=${id}. Already deleted, or wrong id — try action="list" to confirm.` });
        case 'list_partners':
          if (!id) return errorResponse('list_partners requires id (the numeric account id of the NON-partner account whose channel partners you want). Resolve via action="get" with slug or the search tool first.');
          return callService(() => accountsService.listPartners(userId, id));
        case 'add_partner':
          if (!id || !partner_id) return errorResponse('add_partner requires id (the non-partner account) and partner_id (a separate account with status="partner"). Use action="list_full" with status="partner" to find partner ids.');
          return callService(() => accountsService.addPartner(userId, id, partner_id));
        case 'remove_partner':
          if (!id || !partner_id) return errorResponse('remove_partner requires id (the non-partner account) and partner_id (the partner account to unlink). Use action="list_partners" first to see what is currently linked.');
          return callService(() => accountsService.removePartner(userId, id, partner_id));
        default:
          return errorResponse(`Unknown action: ${action}`);
      }
    }
  );

  // ── contacts ──────────────────────────────────────────────────────────

  server.tool(
    'contacts',
    'Manage CRM contacts (people). Actions: list (filter by company slug, kind, city, country, search text; paginate), get (by id — includes linked accounts and `meetings`: the contact\'s meeting history, newest first, each with their per-meeting RSVP/attendance status), get_by_email (case-insensitive single-contact lookup by email — returns null if no match), find_existing (read-only dedupe probe — email-first case-insensitive, then exact full_name+kind, no fuzzy; returns the match or null), find_or_create (PREFERRED — the single creation path: idempotent dedupe + enrich. Matches by exact email, then exact full_name+kind, then fuzzy full_name within the same kind via pg_trgm; returns the existing contact with matched_by + match_score instead of throwing 409, else creates. On a match it fills any BLANK stored field from what you pass (enriched/enriched_fields) without overwriting existing data, and (re)links account_id. Pass at least an email OR a name — an email-only contact is valid. Use it so you don\'t pile up near-duplicates, especially kind=internal teammates), create (explicit insert — runs the same dedupe core but throws 409 if a duplicate is detected, instead of upserting; supply at least an email or a name; prefer find_or_create), update (partial), delete, link_account, unlink_account, reassign_account (atomically move a contact\'s account link from one account to another — fix a bad import; account_id is the destination, optional from_account_id is the account to unlink), attendee_options (returns buckets for the meeting/internal-note picker), research (enqueue a background outreach + local-LLM enrichment job for an existing contact — same ContactEnrichmentService as create_from_emails uses; when ready its fields are filled into the contact FILL-ONLY — blank columns only, curated values are never overwritten), get_enrichment_job (poll a single job), list_enrichment_jobs (jobs targeting a single contact, newest first), resolve_emails (pure read — turn a pasted attendee/email list into matched contacts + account candidates grouped by domain; internal-domain emails are flagged kind=internal and never become account candidates), import_from_emails (materialize the account + contacts from that resolved list WITHOUT creating a meeting — the "add these people" path; pass from_emails_payload. Use the meetings tool create_from_emails only when you also have meeting notes). Contact kinds: account = works at a non-partner account (a company you sell to); partner = channel/reseller rep (link them to a partner account); internal = teammate at your own company (link them to the accounts they support — they come back in the account\'s `team` array, kept separate from the customer `contacts`). Each contact carries a location (location_raw + normalized city/state/country) — populate when researching via outreach so we can match contacts to in-person events nearby.',
    {
      action: z.enum(['list', 'get', 'get_by_email', 'find_existing', 'find_or_create', 'create', 'update', 'delete', 'link_account', 'unlink_account', 'reassign_account', 'attendee_options', 'resolve_emails', 'import_from_emails', 'research', 'get_enrichment_job', 'list_enrichment_jobs']),
      id: z.number().optional().describe('Contact ID'),
      email: z.string().optional().describe('Email address (for get_by_email)'),
      account_id: z.number().optional().describe('Account ID (for create, link, unlink, attendee_options external mode, and the reassign_account DESTINATION)'),
      from_account_id: z.number().optional().describe('Source account to unlink (for reassign_account — optional; omit to only add the account_id link)'),
      company: z.string().optional().describe('Account slug to filter by (for list)'),
      kind: z.enum(['account', 'partner', 'internal']).optional().describe('Filter by kind (for list)'),
      city: z.string().optional().describe('Filter by city, case-insensitive exact match (for list)'),
      country: z.string().optional().describe('Filter by country, case-insensitive exact match (for list)'),
      mode: z.enum(['external', 'internal']).optional().describe('For attendee_options: external (requires account_id; returns account+partner+internal) or internal (returns partner+internal)'),
      search: z.string().optional().describe('Search text for name/email/company/title (for list)'),
      enrichment_job_id: z.string().optional().describe('Enrichment job ID returned by research (for get_enrichment_job)'),
      limit: z.number().optional(),
      offset: z.number().optional(),
      data: z.object({
        full_name: z.string().optional(),
        company: z.string().optional(),
        title: z.string().optional(),
        email: z.string().optional(),
        phone: z.string().optional(),
        linkedin: z.string().optional(),
        notes: z.string().optional(),
        kind: z.enum(['account', 'partner', 'internal']).optional(),
        location_raw: z.string().optional().describe('Verbatim location string from source (e.g., LinkedIn "Greater Phoenix Area")'),
        city: z.string().optional().describe('Normalized city, e.g., "Phoenix"'),
        state: z.string().optional().describe('Normalized state/region, e.g., "AZ"'),
        country: z.string().optional().describe('Normalized country, e.g., "USA"'),
      }).optional().describe('Contact data (for create/update)'),
      emails: z.union([z.array(z.string()), z.string()]).optional().describe('Attendee emails (for resolve_emails). Either an array, or a single string with comma/semicolon/newline separators. Accepts "Name <email>" form.'),
      from_emails_payload: z.object({
        account: z.object({
          mode: z.enum(['existing', 'new']),
          account_id: z.number().optional(),
          name: z.string().optional(),
          domain: z.string().optional(),
        }),
        contacts: z.array(z.object({
          mode: z.enum(['existing', 'new']),
          contact_id: z.number().optional(),
          link_to_account: z.boolean().optional(),
          full_name: z.string().optional(),
          email: z.string().optional(),
          kind: z.enum(['account', 'partner', 'internal']).optional(),
          research: z.boolean().optional(),
        })),
      }).optional().describe('Payload for import_from_emails — creates the account + contacts, NO meeting. See POST /api/contacts/from-emails for full semantics.'),
    },
    async ({ action, id, email, account_id, from_account_id, company, kind, city, country, mode, search, enrichment_job_id, emails, from_emails_payload, limit, offset, data }) => {
      const userId = await resolveUserId();
      switch (action) {
        case 'list':
          return callService(() => contactsService.getAll(userId, { company, kind, city, country, search, limit, offset }));
        case 'get':
          if (!id) return errorResponse('get requires id (the numeric contact id). If you only have an email, use action="get_by_email"; if you only have a name, use action="list" with search or the search tool (type="contacts").');
          return callService(() => contactsService.getById(userId, id), { notFoundMsg: `Contact not found: id=${id}. Try action="list" with search, or "get_by_email" if you have the address.` });
        case 'get_by_email':
          if (!email) return errorResponse('get_by_email requires email (the full address, case-insensitive). If you only have a name, use action="list" with search instead.');
          return callService(() => contactsService.getByEmail(userId, email), { notFoundMsg: `No contact with email "${email}". Try action="list" with search to fuzzy-match by name — addresses are exact.` });
        case 'find_existing':
          if (!data || (!data.email && !data.full_name)) {
            return errorResponse('find_existing requires data with at least one of: email or full_name. Uses the same match rules as create (email-first case-insensitive, then full_name+kind). Returns null when nothing matches.');
          }
          return callService(() => contactsService.findExisting(userId, data));
        case 'find_or_create':
          if (!data || (!data.email && !data.full_name)) return errorResponse('find_or_create requires data with at least one of email or full_name (an email-only contact is valid — e.g. data.email="jsmith@acme.com" with no name yet). Optionally pass data.kind ("account" default | "partner" | "internal") and account_id to (re)link. Idempotent: returns the existing contact (matched_by "email" | "full_name" | "fuzzy", with match_score for fuzzy) instead of creating when matched, filling any BLANK stored field from what you pass (enriched/enriched_fields) without overwriting existing values — never throws 409. This is the preferred way to add a contact.');
          return callService(() => contactsService.findOrCreate(userId, data, account_id));
        case 'create':
          if (!data || (!data.email && !data.full_name)) return errorResponse('create requires data with at least one of email or full_name. Also recommended: data.kind ("account" default | "partner" | "internal"), and account_id if linking to an account (kind="account" or "partner" only — internal contacts have no account link). Throws 409 with the existing row attached if a duplicate is detected (email, exact name+kind, or fuzzy name) — prefer action="find_or_create" (idempotent, enriches blanks), or call action="find_existing" first to handle that case without an exception.');
          return callService(() => contactsService.create(userId, data, account_id));
        case 'update':
          if (!id) return errorResponse('update requires id (the numeric contact id). Resolve via action="get_by_email" or action="list" with search first.');
          if (!data) return errorResponse('update requires data (a partial contact object — only fields you send are changed). To change account links, use link_account / unlink_account instead.');
          return callService(() => contactsService.patch(userId, id, data), { notFoundMsg: `Contact not found: id=${id}. Try action="list" with search to find the right id.` });
        case 'delete':
          if (!id) return errorResponse('delete requires id (the numeric contact id). Resolve via action="get_by_email" or action="list" with search first.');
          return callService(() => contactsService.delete(userId, id), { notFoundMsg: `Contact not found: id=${id}. Already deleted, or wrong id — try action="list" to confirm.` });
        case 'link_account':
          if (!id || !account_id) return errorResponse('link_account requires id (contact id) and account_id (the account to link to). Resolve contact via list/get_by_email; resolve account via the accounts tool (list / search / get).');
          return callService(() => contactsService.linkAccount(userId, id, account_id));
        case 'unlink_account':
          if (!id || !account_id) return errorResponse('unlink_account requires id (contact id) and account_id. Use the contact\'s accounts array (from get) to see current links.');
          return callService(() => contactsService.unlinkAccount(userId, id, account_id));
        case 'reassign_account':
          if (!id || !account_id) return errorResponse('reassign_account requires id (contact id) and account_id (the DESTINATION account to move the contact to). Optionally pass from_account_id (the account to unlink) to move it in one atomic step; omit from_account_id to just add the link. Contacts are many-to-many, so this moves only that one link — other account links are preserved. Use the contact\'s accounts array (from get) to see current links.');
          return callService(() => contactsService.reassignAccount(userId, id, from_account_id, account_id));
        case 'attendee_options':
          if (!mode) return errorResponse('attendee_options requires mode: "external" (for an account meeting — also pass account_id) returns {account, partner, internal} buckets; "internal" (for an internal-only meeting) returns {partner, internal}.');
          if (mode === 'external' && !account_id) return errorResponse('attendee_options mode="external" requires account_id (the account whose meeting you are picking attendees for). Resolve the account via the accounts tool first.');
          return callService(() => contactsService.getAttendeeOptions(userId, { mode, accountId: account_id }));
        case 'resolve_emails':
          if (!emails) return errorResponse('resolve_emails requires emails — an array of email strings, or a single newline/comma/semicolon-separated string (e.g. straight from a calendar invite). "Name <email>" form is accepted.');
          return callService(() => contactsService.resolveEmails(userId, emails));
        case 'import_from_emails':
          if (!from_emails_payload) return errorResponse('import_from_emails requires from_emails_payload — the resolved structure from action="resolve_emails" with your decisions filled in (account mode existing|new, each contact mode existing|new, optional research:true). Creates the account + contacts but NO meeting (the "add these people" path). Use the meetings tool action="create_from_emails" instead only when you also have meeting notes to attach.');
          return callService(() => contactsService.importFromEmails(userId, from_emails_payload));
        case 'research': {
          if (!contactEnrichmentService) return errorResponse('Contact enrichment service not available on this server. Check ops config.');
          if (!id) return errorResponse('research requires id (the numeric contact id to enrich). Resolve via action="get_by_email" or action="list" with search first.');
          const contact = await contactsService.getById(userId, id);
          if (!contact) return errorResponse(`Contact not found: id=${id}. Resolve via action="list" or "get_by_email" first.`);
          // full_name is nullable (email-only contacts) — enqueue requires a name,
          // so reject a nameless contact with a clear, actionable tool error
          // rather than a generic enqueue failure.
          if (!contact.full_name?.trim()) return errorResponse('cannot research a contact without a name — set full_name first');
          const accountName = contact.accounts?.[0]?.name || contact.company || null;
          return callService(() => {
            const jobId = contactEnrichmentService.enqueue(userId, {
              contactId: contact.id,
              name: contact.full_name,
              accountName,
            });
            return { jobId, contactId: contact.id, name: contact.full_name, accountName };
          });
        }
        case 'get_enrichment_job':
          if (!contactEnrichmentService) return errorResponse('Contact enrichment service not available on this server.');
          if (!enrichment_job_id) return errorResponse('get_enrichment_job requires enrichment_job_id (the string returned from action="research" — also visible in action="list_enrichment_jobs" with the contact id).');
          return callService(() => Promise.resolve(contactEnrichmentService.getJob(enrichment_job_id)), { notFoundMsg: `Enrichment job not found: ${enrichment_job_id}. Jobs are in-memory — they vanish on server restart. Re-enqueue via action="research".` });
        case 'list_enrichment_jobs': {
          if (!contactEnrichmentService) return errorResponse('Contact enrichment service not available on this server.');
          if (!id) return errorResponse('list_enrichment_jobs requires id (the numeric contact id whose enrichment jobs you want). Resolve via action="list" or "get_by_email" first.');
          return callService(async () => {
            const contact = await contactsService.getById(userId, id);
            if (!contact) return null;
            return { jobs: contactEnrichmentService.listJobsForContacts([contact.id]) };
          }, { notFoundMsg: `Contact not found: id=${id}. Resolve via action="list" or "get_by_email" first.` });
        }
        default:
          return errorResponse(`Unknown action: ${action}`);
      }
    }
  );

  // ── meetings ──────────────────────────────────────────────────────────

  server.tool(
    'meetings',
    'Manage meeting notes. Meetings can be tied to an account (account or partner) or internal-only (no account). Attendees come in two forms: LINKED (contact_ids → existing CRM contacts) and UNLINKED (a name/email with no contact yet — recorded for visibility, linkable later). Actions: list (all, paginated; filter by account_id, internal flag, or needs_review), get (by id — body, linked contacts, and unlinked_attendees[]), create (pass account_id + contact_ids for an account meeting; pass internal=true and omit account_id for an internal-only note; needs_review=true parks an uncertain/imported note for triage), update (partial — contact_ids replaces the LINKED set, attendees/unlinked_attendees replaces the UNLINKED set, independently; the internal flag and account_id cannot be changed after creation), delete, assign_account (triage — attach a parked account-less note to an account, flipping internal→false and clearing needs_review; 409 if already assigned), reassign_account (move a meeting that ALREADY has an account to a different account, or convert it to an internal note — the fix-a-bad-import path; unlike assign_account it is NOT blocked when the meeting already has an account, and clears needs_review), link_attendee (triage — convert an unlinked attendee row into a link to an existing contact, deduping if already linked), create_from_emails (atomic: creates the account + contacts AND a meeting from a resolved email list — use ONLY when you have meeting notes/body; to add the account + people WITHOUT a meeting, use the contacts tool actions resolve_emails + import_from_emails, which this delegates the account/people half to. Fires optional background outreach + LLM enrichment for new contacts flagged research:true), get_enrichment_job (poll a single enrichment job kicked off by create_from_emails), list_enrichment_jobs (list all enrichment jobs for the contacts on a given meeting — useful for a progress dashboard).',
    {
      action: z.enum(['list', 'get', 'create', 'update', 'delete', 'assign_account', 'reassign_account', 'link_attendee', 'create_from_emails', 'get_enrichment_job', 'list_enrichment_jobs']),
      id: z.number().optional().describe('Meeting ID (for get, update, delete, assign_account, reassign_account, link_attendee)'),
      account_id: z.number().optional().describe('Account ID — for list (filter to that account), create (omit for internal=true), assign_account (the account to attach a parked note to), or reassign_account (the destination account to move the meeting to).'),
      attendee_id: z.number().optional().describe('Unlinked attendee row id (from the meeting\'s unlinked_attendees[]) — for link_attendee.'),
      contact_id: z.number().optional().describe('Existing contact id to link an unlinked attendee to — for link_attendee.'),
      internal: z.boolean().optional().describe('For list: filter by internal flag (true=only internal, false=only account meetings, omit=both). For create: set true for an internal-only note. For reassign_account: set true (and omit account_id) to convert the meeting to an account-less internal note instead of moving it to another account.'),
      needs_review: z.boolean().optional().describe('For list: filter by the triage flag (true=only parked notes awaiting triage, false=only settled, omit=both). Set on create/update via data.needs_review.'),
      limit: z.number().optional(),
      offset: z.number().optional(),
      enrichment_job_id: z.string().optional().describe('Enrichment job ID returned by create_from_emails (for get_enrichment_job).'),
      from_emails_payload: z.object({
        date: z.string(),
        title: z.string().optional(),
        attendees_text: z.string().optional(),
        body: z.string(),
        account: z.object({
          mode: z.enum(['existing', 'new']),
          account_id: z.number().optional(),
          name: z.string().optional(),
          domain: z.string().optional(),
        }),
        contacts: z.array(z.object({
          mode: z.enum(['existing', 'new']),
          contact_id: z.number().optional(),
          link_to_account: z.boolean().optional(),
          full_name: z.string().optional(),
          email: z.string().optional(),
          kind: z.enum(['account', 'partner', 'internal']).optional(),
          research: z.boolean().optional(),
        })),
      }).optional().describe('Payload for create_from_emails. See the body schema on POST /api/meetings/from-emails for full semantics.'),
      data: z.object({
        date: z.string().optional().describe('YYYY-MM-DD'),
        starts_at: z.string().nullable().optional().describe('Optional precise start as an ISO 8601 timestamp (e.g. "2026-05-31T13:30:00Z") — powers the GUI Today timeline / time-of-day ordering. The calendar import sets this from the event start; distinct from `date` (the calendar day). On update, omit to leave unchanged or pass null to clear.'),
        ends_at: z.string().nullable().optional().describe('Optional precise end as an ISO 8601 timestamp. Companion to starts_at; used to detect the meeting happening right now. On update, omit to leave unchanged or pass null to clear.'),
        location: z.string().nullable().optional().describe('Optional location — for a virtual meeting the conferencing URL (Meet/Zoom/Teams), rendered as a "Join" button on the GUI Today timeline; for in-person, a room/address. The calendar import sets this from the event location. On update, omit to leave unchanged or pass null to clear.'),
        title: z.string().optional(),
        needs_review: z.boolean().optional().describe('Park this note for triage (create/update). Surfaced by list with needs_review=true; cleared by assign_account.'),
        attendees: z.string().optional().describe('Free-text attendees (comma/semicolon separated). Each name with no matching linked contact becomes an UNLINKED attendee row (not just display text). On update, replaces the unlinked set.'),
        unlinked_attendees: z.array(z.object({ display_name: z.string(), email: z.string().optional() })).optional().describe('Structured attendees with no CRM contact yet: [{display_name, email?}]. Recorded for visibility + later one-click linking. On update, replaces the unlinked set. Alternative to the free-text attendees string.'),
        body: z.string().optional().describe('Meeting notes markdown'),
        contact_ids: z.array(z.number()).optional().describe('Array of contact IDs to link as attendees (LINKED set). Required for non-internal meetings; for internal meetings, typically kind=internal or kind=partner. On update, replaces the linked set.'),
      }).optional().describe('Meeting data (for create/update)'),
    },
    async ({ action, id, account_id, attendee_id, contact_id, internal, needs_review, limit, offset, enrichment_job_id, from_emails_payload, data }) => {
      const userId = await resolveUserId();
      switch (action) {
        case 'list':
          if (account_id) return callService(() => meetingsService.getByAccount(userId, account_id));
          return callService(() => meetingsService.getAll(userId, { limit, offset, internal, needs_review }));
        case 'get':
          if (!id) return errorResponse('get requires id (the numeric meeting id). Use action="list" (optionally with account_id) to find meeting ids.');
          return callService(() => meetingsService.getById(userId, id), { notFoundMsg: `Meeting not found: id=${id}. Try action="list" to find the right id.` });
        case 'create':
          if (!data?.date || !data?.body) return errorResponse('create requires data.date (ISO date, e.g. "2026-05-20") and data.body (the meeting notes as markdown text). Optional: data.title, data.filename, data.attendees (free-text display).');
          if (!internal && !account_id) return errorResponse('create requires account_id for an account meeting (resolve via the accounts tool first), or set internal=true for an internal-only note (no account link).');
          if (internal && account_id) return errorResponse('Internal meetings cannot have an account_id (internal=true means no account link). If this should be tied to a customer/partner, drop internal=true and pass account_id.');
          if (!internal && (!data.contact_ids || data.contact_ids.length === 0)) {
            return errorResponse('Account meetings require data.contact_ids (an array of contact ids for the attendees, min 1). Use the contacts tool with action="attendee_options" (mode="external", account_id=<this account>) to get a pre-grouped picker, or action="list" with search to find contacts by name.');
          }
          return callService(() => meetingsService.create(userId, internal ? null : account_id!, { ...data, internal: !!internal }));
        case 'update':
          if (!id) return errorResponse('update requires id (the numeric meeting id). Use action="list" to find ids.');
          if (!data) return errorResponse('update requires data (a partial meeting object). If you pass contact_ids it FULLY replaces the attendee list. account_id and internal are immutable after creation.');
          return callService(() => meetingsService.update(userId, id, data), { notFoundMsg: `Meeting not found: id=${id}. Try action="list" to confirm the id.` });
        case 'delete':
          if (!id) return errorResponse('delete requires id (the numeric meeting id). Use action="list" to find ids.');
          return callService(() => meetingsService.delete(userId, id), { notFoundMsg: `Meeting not found: id=${id}. Already deleted, or wrong id.` });
        case 'assign_account':
          if (!id || !account_id) return errorResponse('assign_account requires id (the parked meeting id) and account_id (the account to attach it to). Find parked notes via action="list" with needs_review=true; resolve the account via the accounts tool (find_or_create / search / get). Only works on unassigned notes — returns 409 if the meeting already has an account.');
          return callService(() => meetingsService.assignAccount(userId, id, account_id), { notFoundMsg: `Meeting not found: id=${id}. Try action="list" with needs_review=true to find parked notes.` });
        case 'reassign_account':
          if (!id) return errorResponse('reassign_account requires id (the meeting id to move). Use action="list" to find ids.');
          if (!account_id && !internal) return errorResponse('reassign_account requires account_id (move the meeting to that account) or internal=true (convert it to an account-less internal note). Unlike assign_account, this works on a meeting that ALREADY has an account — use it to fix a bad import. Resolve the destination account via the accounts tool (search / get / find_or_create).');
          return callService(() => meetingsService.reassignAccount(userId, id, { accountId: account_id, internal: !!internal }), { notFoundMsg: `Meeting not found: id=${id}. Try action="list" to confirm the id.` });
        case 'link_attendee':
          if (!id || !attendee_id || !contact_id) return errorResponse('link_attendee requires id (meeting id), attendee_id (the unlinked attendee row id from the meeting\'s unlinked_attendees[]), and contact_id (the existing contact to link it to). Resolve the contact first via the contacts tool (find_or_create / get_by_email / list). If the contact is already an attendee, the unlinked row is dropped (dedupe).');
          return callService(() => meetingsService.linkAttendee(userId, id, attendee_id, contact_id), { notFoundMsg: `No unlinked attendee id=${attendee_id} on meeting id=${id}. Re-fetch the meeting with action="get" to see current unlinked_attendees[].` });
        case 'create_from_emails':
          if (!from_emails_payload) return errorResponse('create_from_emails requires from_emails_payload — the resolved structure from the contacts tool action="resolve_emails" with your decisions filled in (account mode existing|new, each contact mode existing|new, optional research:true) PLUS meeting fields date + body. Only use this when you have meeting notes; to add the account + people without a meeting, use the contacts tool action="import_from_emails". See the from-emails section of the agent instructions for the shape.');
          return callService(() => meetingsService.createFromEmails(userId, from_emails_payload));
        case 'get_enrichment_job':
          if (!contactEnrichmentService) return errorResponse('Contact enrichment service not available on this server.');
          if (!enrichment_job_id) return errorResponse('get_enrichment_job requires enrichment_job_id (the string from create_from_emails enrichment_jobs[] or from contacts.research). Use action="list_enrichment_jobs" with the meeting id if you have lost the job id.');
          return callService(() => Promise.resolve(contactEnrichmentService.getJob(enrichment_job_id)), { notFoundMsg: `Enrichment job not found: ${enrichment_job_id}. Jobs are in-memory and reset on server restart. Re-enqueue via contacts.research if needed.` });
        case 'list_enrichment_jobs': {
          if (!contactEnrichmentService) return errorResponse('Contact enrichment service not available on this server.');
          if (!id) return errorResponse('list_enrichment_jobs requires id (the numeric meeting id whose attendee enrichment jobs you want). Use action="list" to find the meeting id.');
          return callService(async () => {
            const meeting = await meetingsService.getById(userId, id);
            if (!meeting) return null;
            const contactIds = (meeting.contacts || []).map((c: any) => Number(c.id));
            return { jobs: contactEnrichmentService.listJobsForContacts(contactIds) };
          }, { notFoundMsg: `Meeting not found: id=${id}. Try action="list" to confirm the id.` });
        }
        default:
          return errorResponse(`Unknown action: ${action}`);
      }
    }
  );

  // ── notes_import ──────────────────────────────────────────────────────

  server.tool(
    'notes_import',
    'Bulk-import a directory of notes (markdown/plain text from Obsidian, Apple/Google Notes, a folder of call summaries, …). Each file is processed ONE AT A TIME by the local model to extract metadata (date, title, account, attendees), then resolved to an account and written as a meeting. Account resolution: a confident match links the note cleanly; an unknown company auto-creates a flagged account (needs_review) and links it; an ambiguous near-match parks the note (internal + needs_review) so you place it via triage instead of minting a near-duplicate; an internal/no-company note parks too. Async + serial (one local-LLM call at a time). Actions: enqueue (pass files=[{path, content}] — read the directory client-side; returns a jobId), get_job (poll by jobId — status queued→running→completed, stage shows progress, results[] has a per-file outcome, counts aggregates them), list_jobs (recent jobs). Idempotent: re-importing the same file is skipped on a filename match. (Uploading a raw .zip is HTTP-only — POST /api/notes-import/upload-zip — since MCP can\'t carry binary; from here, send the unpacked files[].)',
    {
      action: z.enum(['enqueue', 'get_job', 'list_jobs']),
      files: z.array(z.object({
        path: z.string().describe('Relative path within the dropped directory — used to derive a stable meeting filename for idempotent re-imports.'),
        content: z.string().describe('Full text of the note. Stored verbatim as the meeting body; the model sees a truncated copy for metadata extraction.'),
      })).optional().describe('Notes to import (for enqueue). Non-empty array of { path, content }.'),
      job_id: z.string().optional().describe('Job id returned by enqueue (for get_job).'),
      status: z.enum(['queued', 'running', 'completed', 'failed']).optional().describe('Filter (for list_jobs).'),
      limit: z.number().optional().describe('Max jobs to return (for list_jobs).'),
    },
    async ({ action, files, job_id, status, limit }) => {
      const userId = await resolveUserId();
      switch (action) {
        case 'enqueue':
          if (!Array.isArray(files) || files.length === 0) {
            return errorResponse('enqueue requires files — a non-empty array of { path, content }. Read the notes directory client-side and send each text file. (To import a .zip, use the HTTP endpoint POST /api/notes-import/upload-zip; MCP can\'t carry binary.)');
          }
          return callService(async () => ({ jobId: notesImportService.enqueue(userId, { files }) }));
        case 'get_job':
          if (!job_id) return errorResponse('get_job requires job_id (the string returned by action="enqueue"). Use action="list_jobs" to find recent jobs if you lost it.');
          return callService(() => Promise.resolve(notesImportService.getJob(job_id)), { notFoundMsg: `Notes-import job not found: ${job_id}. Jobs are in-memory and reset on server restart.` });
        case 'list_jobs':
          return callService(async () => ({ jobs: notesImportService.listJobs({ status, limit }) }));
        default:
          return errorResponse(`Unknown action: ${action}`);
      }
    }
  );

  // ── search ────────────────────────────────────────────────────────────

  server.tool(
    'search',
    'Full-text search across all CRM data. Searches accounts (customers and partners — each result carries a `status` field), contacts, meetings (including internal meetings), and opportunities using Postgres tsvector/tsquery. Query tokens are prefix-matched. Specify type to narrow results.',
    {
      query: z.string().describe('Search query text'),
      type: z.enum(['all', 'accounts', 'contacts', 'meetings', 'opportunities']).optional().default('all'),
      limit: z.number().optional().default(20).describe('Max results per type'),
    },
    async ({ query, type, limit }) => {
      const userId = await resolveUserId();
      return callService(() => searchService.search(userId, query, { type, limit }));
    }
  );

  // ── todoist_tasks ─────────────────────────────────────────────────────
  // Skipped entirely when the Todoist integration is disabled (services bag
  // omits todoistService). The tool simply does not appear in `tools/list`.

  if (todoistService) {
    server.tool(
      'todoist_tasks',
      `Manage Todoist tasks. Actions: create (single task — defaults to ${todoistDest()}, use label = account slug), create_batch (array of tasks), list (filter by label or Todoist filter string), close (mark complete by task_id).`,
      {
        action: z.enum(['create', 'create_batch', 'list', 'close']),
        task_id: z.string().optional().describe('Task ID (for close)'),
        label: z.string().optional().describe('Filter by label (for list)'),
        filter: z.string().optional().describe('Todoist filter string (for list)'),
        data: z.object({
          content: z.string().optional().describe('Task title'),
          description: z.string().optional(),
          labels: z.array(z.string()).optional(),
          due_string: z.string().optional().describe('Natural language due date, e.g. "next Friday"'),
          due_date: z.string().optional().describe('YYYY-MM-DD'),
          priority: z.number().min(1).max(4).optional(),
        }).optional().describe('Task data (for create)'),
        tasks: z.array(z.object({
          content: z.string(),
          description: z.string().optional(),
          labels: z.array(z.string()).optional(),
          due_string: z.string().optional(),
          due_date: z.string().optional(),
          priority: z.number().min(1).max(4).optional(),
        })).optional().describe('Array of tasks (for create_batch)'),
      },
      async ({ action, task_id, label, filter, data, tasks }) => {
        switch (action) {
          case 'create':
            if (!data?.content) return errorResponse('create requires data.content (the task title — what needs to be done). Optional: data.labels (array of strings; use the account slug as the convention), data.due_string ("next Friday"), data.due_date ("YYYY-MM-DD"), data.priority (1-4).');
            return callService(() => todoistService.createTask(data));
          case 'create_batch':
            if (!tasks?.length) return errorResponse('create_batch requires a non-empty tasks array (each task is the same shape as create\'s data: content + optional labels/due/priority). Use this for follow-ups after a call — one call instead of N.');
            return callService(async () => {
              const results = await todoistService.createTasksBatch(tasks);
              return { created: results.length, tasks: results };
            });
          case 'list':
            return callService(() => todoistService.getTasks({ label, filter }));
          case 'close':
            if (!task_id) return errorResponse('close requires task_id (the Todoist task id string from action="list" or from the create response).');
            return callService(() => todoistService.closeTask(task_id));
          default:
            return errorResponse(`Unknown action: ${action}`);
        }
      }
    );
  }

  // ── export_markdown ───────────────────────────────────────────────────

  server.tool(
    'export_markdown',
    'Export an account\'s full data as readable markdown. Returns the account summary, contacts, and all meeting notes. Useful for getting a comprehensive view of an account.',
    {
      slug: z.string().describe('Account slug to export'),
    },
    async ({ slug }) => {
      const userId = await resolveUserId();
      return callService(async () => {
        const files = await exportService.exportAccount(userId, slug);
        if (!files) return null;
        return files.map(f => `--- ${f.path} ---\n${f.content}`).join('\n\n');
      }, { notFoundMsg: `No account with slug "${slug}". Use the accounts tool (action="list" for all slugs, or search type="accounts" for fuzzy matching by name) — slugs are exact.` });
    }
  );

  // ── outreach ──────────────────────────────────────────────────────────

  server.tool(
    'outreach',
    'Async LinkedIn + web enrichment for a person, company, or industry. Jobs take 30-60s and run serially (single LinkedIn session, rate-limited to 50/day with a 10s min gap). Actions: enqueue (returns jobId), get_job (poll by jobId), list_jobs (recent, filter by status), stats (queue depth + LinkedIn rate-limit state). Enqueue and poll on the same surface — the MCP and HTTP processes have separate in-memory queues.',
    {
      action: z.enum(['enqueue', 'get_job', 'list_jobs', 'stats']),
      type: z.enum(['person', 'company', 'industry']).optional().describe('What to enrich (for enqueue)'),
      name: z.string().optional().describe('Person name, company name, or industry area (for enqueue)'),
      company: z.string().optional().describe('Filter by company (person enqueue only)'),
      title: z.string().optional().describe('Filter by title (person enqueue only)'),
      deep: z.boolean().optional().describe('Include deep profile scrape (person/company enqueue; slower)'),
      limit: z.number().int().min(1).max(50).optional().describe('Max companies (industry enqueue only)'),
      linkedin: z.boolean().optional().default(true).describe('Hit LinkedIn (requires host cookies). Set false for web-only.'),
      job_id: z.string().optional().describe('Job ID (for get_job)'),
      status: z.enum(['queued', 'running', 'completed', 'failed']).optional().describe('Filter by status (for list_jobs)'),
    },
    async ({ action, type, name, company, title, deep, limit, linkedin, job_id, status }) => {
      switch (action) {
        case 'enqueue':
          if (!type) return errorResponse('enqueue requires type: "person" (person lookup; optionally pass company/title to disambiguate, deep=true for full profile), "company" (company overview), or "industry" (top companies in a sector; pass limit).');
          if (!name) return errorResponse('enqueue requires name (the person\'s name for type=person, the company name for type=company, the industry/area string for type=industry).');
          return callService(async () => outreachService.enqueue({ type, name, company, title, deep, limit, linkedin }));
        case 'get_job':
          if (!job_id) return errorResponse('get_job requires job_id (the string returned by enqueue). Use action="list_jobs" to see recent jobs if you have lost the id.');
          return callService(() => outreachService.getJob(job_id), { notFoundMsg: `Job not found: ${job_id}. Jobs are in-memory and lost on server restart. Re-enqueue, or check action="list_jobs" for recent jobs.` });
        case 'list_jobs':
          return callService(async () => outreachService.listJobs({ status }));
        case 'stats':
          return callService(() => outreachService.getStats());
        default:
          return errorResponse(`Unknown action: ${action}`);
      }
    }
  );

  // ── events ────────────────────────────────────────────────────────────

  server.tool(
    'events',
    'Browse the public event calendar (currently scraped from paloaltonetworks.com) and match upcoming in-person events to the caller\'s contacts by city. Events are global data (every user sees the same rows); the per-user view comes from joining to contacts. Actions: list (filter by city/country/mode/source/date range/text search/tags), facets (distinct filter values + counts for frontend dropdowns), get (by id), upcoming_with_contacts (returns upcoming in-person events alongside the caller\'s contacts in the same city — the primary use case for "where should I do account visits"), upsert (idempotent insert/update keyed on source+source_id; the scraper calls this), delete.',
    {
      action: z.enum(['list', 'facets', 'get', 'upcoming_with_contacts', 'upsert', 'delete']),
      id: z.number().optional().describe('Event ID (for get, delete)'),
      city: z.string().optional().describe('Filter by city (case-insensitive exact)'),
      country: z.string().optional().describe('Filter by country (case-insensitive exact)'),
      mode: z.enum(['in_person', 'virtual', 'hybrid', 'on_demand']).optional().describe('Filter by mode'),
      source: z.string().optional().describe('Scraper source identifier (e.g., paloaltonetworks)'),
      after: z.string().optional().describe('YYYY-MM-DD lower bound on start_date'),
      before: z.string().optional().describe('YYYY-MM-DD upper bound on start_date'),
      has_location: z.boolean().optional().describe('Only events with a normalized city'),
      search: z.string().optional().describe('ILIKE match against title, summary, location_raw'),
      tags: z.array(z.string()).optional().describe('Match events containing ANY of these tags'),
      sort: z.enum(['start_date', 'end_date', 'title', 'created_at', 'updated_at']).optional(),
      order: z.enum(['asc', 'desc']).optional(),
      limit: z.number().optional(),
      offset: z.number().optional(),
      data: z.object({
        source: z.string().optional(),
        source_id: z.string().optional(),
        title: z.string().optional(),
        summary: z.string().optional(),
        start_date: z.string().optional(),
        end_date: z.string().optional(),
        mode: z.enum(['in_person', 'virtual', 'hybrid', 'on_demand']).optional(),
        location_raw: z.string().optional(),
        city: z.string().optional(),
        state: z.string().optional(),
        country: z.string().optional(),
        venue: z.string().optional(),
        url: z.string().optional(),
        tags: z.array(z.string()).optional(),
      }).optional().describe('Event payload (for upsert)'),
    },
    async ({ action, id, city, country, mode, source, after, before, has_location, search, tags, sort, order, limit, offset, data }) => {
      switch (action) {
        case 'list':
          return callService(() => eventsService.list({ city, country, mode, source, after, before, has_location, search, tags, sort, order, limit, offset }));
        case 'facets':
          return callService(() => eventsService.getFacets());
        case 'get':
          if (!id) return errorResponse('get requires id (the numeric event id). Use action="list" with search/filters to find events (or action="upcoming_with_contacts" for travel planning).');
          return callService(() => eventsService.getById(id), { notFoundMsg: `Event not found: id=${id}. Try action="list" with search/filters.` });
        case 'upcoming_with_contacts': {
          const userId = await resolveUserId();
          return callService(async () => {
            const events = await eventsService.upcomingWithMatchedContacts(userId, { mode: mode || 'in_person', after, before, limit });
            return { events };
          });
        }
        case 'upsert':
          if (!data?.source || !data?.source_id || !data?.title) {
            return errorResponse('upsert requires data.source (e.g. "paloaltonetworks"), data.source_id (stable id within that source — URL or slug), and data.title. This is mostly called by the scraper; agents rarely upsert events.');
          }
          return callService(() => eventsService.upsert(data));
        case 'delete':
          if (!id) return errorResponse('delete requires id (the numeric event id). Use action="list" to find ids.');
          return callService(() => eventsService.delete(id), { notFoundMsg: `Event not found: id=${id}. Already deleted, or wrong id.` });
        default:
          return errorResponse(`Unknown action: ${action}`);
      }
    }
  );

  // ── opportunities ─────────────────────────────────────────────────────

  server.tool(
    'opportunities',
    'Manage sales opportunities (deals) attached to an account (the non-partner kind — companies you sell to). **`product_ids` / `product_id` reference rows from the `products` tool (per-user catalog of what you sell), NOT `vendor_products` (global tech-stack catalog).** Actions: list (filter by account_id and/or stage; sort/paginate), get (by id — includes the linked account and attached products), create (account must not be a partner account; status=partner is rejected), update (PATCH — pass product_ids to fully replace the linked products), delete, link_product (idempotent attach of a single product), unlink_product. Stage is the SE tech-validation pipeline (in order): opp_identification (0, default), tech_discovery (1), non_pov_tech_validation (2), pov_planning (3), pov_tech_validation (4), tech_decision_pending (5), tech_loss_closed (6), tech_win_closed (7), no_tech_validation_closed (8). opp_link, trr_link, and tech_validation_link are free-text URLs (external deal record, TRR doc, and tech-validation artifact respectively). why_change / why_now / why_us are ordered string lists capturing the classic sales framework — on update, each list you pass fully replaces the stored one (GET, mutate, PATCH back to add/remove a single reason).',
    {
      action: z.enum(['list', 'get', 'create', 'update', 'delete', 'link_product', 'unlink_product']),
      id: z.number().optional().describe('Opportunity ID (for get, update, delete, link_product, unlink_product)'),
      account_id: z.number().optional().describe('Filter by account (for list) or required for create'),
      product_id: z.number().optional().describe('Product ID (for link_product, unlink_product)'),
      stage: z.enum(['opp_identification', 'tech_discovery', 'non_pov_tech_validation', 'pov_planning', 'pov_tech_validation', 'tech_decision_pending', 'tech_loss_closed', 'tech_win_closed', 'no_tech_validation_closed']).optional().describe('Filter by stage (for list)'),
      sort: z.enum(['name', 'stage', 'created_at', 'updated_at']).optional(),
      order: z.enum(['asc', 'desc']).optional(),
      limit: z.number().optional(),
      offset: z.number().optional(),
      data: z.object({
        account_id: z.number().optional(),
        name: z.string().optional(),
        opp_link: z.string().nullable().optional(),
        trr_link: z.string().nullable().optional(),
        tech_validation_link: z.string().nullable().optional(),
        stage: z.enum(['opp_identification', 'tech_discovery', 'non_pov_tech_validation', 'pov_planning', 'pov_tech_validation', 'tech_decision_pending', 'tech_loss_closed', 'tech_win_closed', 'no_tech_validation_closed']).optional(),
        notes: z.string().nullable().optional(),
        product_ids: z.array(z.number()).optional().describe('Products attached to this opp. On update, this fully replaces existing links; pass [] to clear.'),
        why_change: z.array(z.string()).optional().describe('Why-Change reasons (ordered, oldest first). On update, fully replaces the stored list.'),
        why_now:    z.array(z.string()).optional().describe('Why-Now reasons (ordered, oldest first). On update, fully replaces the stored list.'),
        why_us:     z.array(z.string()).optional().describe('Why-Us reasons (ordered, oldest first). On update, fully replaces the stored list.'),
      }).optional().describe('Opportunity data (for create/update)'),
    },
    async ({ action, id, account_id, product_id, stage, sort, order, limit, offset, data }) => {
      const userId = await resolveUserId();
      switch (action) {
        case 'list':
          return callService(() => opportunitiesService.getAll(userId, { account_id, stage, sort, order, limit, offset }));
        case 'get':
          if (!id) return errorResponse('get requires id (the numeric opportunity id). Use action="list" (optionally with account_id) or accounts.get (the response includes an opportunities[] array) to find ids.');
          return callService(() => opportunitiesService.getById(userId, id), { notFoundMsg: `Opportunity not found: id=${id}. Try action="list" to find the right id.` });
        case 'create': {
          const payload = { ...(data || {}) };
          if (account_id != null && payload.account_id == null) payload.account_id = account_id;
          if (!payload.account_id) return errorResponse('create requires data.account_id (the numeric account id this deal is on). Resolve via the accounts tool (search by name, get by slug/domain). The account must NOT be status="partner" — opps live on customer accounts only.');
          if (!payload.name) return errorResponse('create requires data.name (the deal name, e.g. "Q3 EDR Refresh" or the customer-facing deal title). Optional: data.product_ids (numeric ids from the `products` tool — NOT vendor_products), data.stage (defaults to opp_identification), data.opp_link / trr_link / tech_validation_link, data.why_change / why_now / why_us.');
          return callService(() => opportunitiesService.create(userId, payload));
        }
        case 'update':
          if (!id) return errorResponse('update requires id (the numeric opportunity id). Use action="list" to find ids.');
          if (!data) return errorResponse('update requires data (a partial opportunity object). Passing product_ids FULLY replaces the linked products — to attach/detach a single product, use link_product / unlink_product instead. Same full-replace for why_change / why_now / why_us (GET, mutate, PATCH back).');
          return callService(() => opportunitiesService.patch(userId, id, data), { notFoundMsg: `Opportunity not found: id=${id}. Try action="list" to confirm the id.` });
        case 'delete':
          if (!id) return errorResponse('delete requires id (the numeric opportunity id). Use action="list" to find ids.');
          return callService(() => opportunitiesService.delete(userId, id), { notFoundMsg: `Opportunity not found: id=${id}. Already deleted, or wrong id.` });
        case 'link_product':
          if (!id || !product_id) return errorResponse('link_product requires id (opportunity id) and product_id (a row from the `products` tool — NOT vendor_products; that one is for account tech-stack tracking). Use products.list with search to find product ids.');
          return callService(() => opportunitiesService.linkProduct(userId, id, product_id), { notFoundMsg: `Opportunity not found: id=${id}. Try action="list" to confirm the id.` });
        case 'unlink_product':
          if (!id || !product_id) return errorResponse('unlink_product requires id (opportunity id) and product_id. Use action="get" first to see currently attached products.');
          return callService(() => opportunitiesService.unlinkProduct(userId, id, product_id), { notFoundMsg: `Opportunity not found: id=${id}. Try action="list" to confirm the id.` });
        default:
          return errorResponse(`Unknown action: ${action}`);
      }
    }
  );

  // ── products ──────────────────────────────────────────────────────────

  server.tool(
    'products',
    'Per-user catalog of products YOU SELL — this is what attaches to opportunities. **For populating opportunity product_ids, list/create here, not in `vendor_products`** (that one is for the global catalog of what your accounts RUN — wrong namespace, FK won\'t match opp_products). Actions: list (filter by category_id; ILIKE `search` on name; paginate), get (by id — includes category name), create, update (PATCH; pass category_id=null to clear), delete (also removes the product from any opportunities it was attached to). Categories themselves are managed via the separate `product_categories` tool.',
    {
      action: z.enum(['list', 'get', 'create', 'update', 'delete']),
      id: z.number().optional().describe('Product ID'),
      category_id: z.number().optional().describe('Filter by category (for list)'),
      search: z.string().optional().describe('ILIKE match on name (for list)'),
      limit: z.number().optional(),
      offset: z.number().optional(),
      data: z.object({
        name: z.string().optional(),
        category_id: z.number().nullable().optional().describe('Optional product_categories.id (null clears it)'),
      }).optional().describe('Product data (for create/update)'),
    },
    async ({ action, id, category_id, search, limit, offset, data }) => {
      const userId = await resolveUserId();
      switch (action) {
        case 'list':
          return callService(() => productsService.getAll(userId, { category_id, search, limit, offset }));
        case 'get':
          if (!id) return errorResponse('get requires id (the numeric product id). Use action="list" with search (ILIKE on name) to find products.');
          return callService(() => productsService.getById(userId, id), { notFoundMsg: `Product not found: id=${id}. Try action="list" with search to find the right id.` });
        case 'create':
          if (!data?.name) return errorResponse('create requires data.name (the product name as you sell it, e.g. "PA-Series Firewalls"). Optional: data.category_id (from the product_categories tool — call its list action to discover categories).');
          return callService(() => productsService.create(userId, data));
        case 'update':
          if (!id) return errorResponse('update requires id (the numeric product id). Use action="list" with search to find ids.');
          if (!data) return errorResponse('update requires data (a partial product object). Pass category_id=null to clear the category.');
          return callService(() => productsService.patch(userId, id, data), { notFoundMsg: `Product not found: id=${id}. Try action="list" to confirm the id.` });
        case 'delete':
          if (!id) return errorResponse('delete requires id (the numeric product id). Note: deleting cascades to opp_products, removing the product from any opportunities it was attached to.');
          return callService(() => productsService.delete(userId, id), { notFoundMsg: `Product not found: id=${id}. Already deleted, or wrong id.` });
        default:
          return errorResponse(`Unknown action: ${action}`);
      }
    }
  );

  // ── product_categories ────────────────────────────────────────────────

  server.tool(
    'product_categories',
    "Manage the per-user product category list. Categories are optional groupings for products. Renaming a category propagates to every product in it (they reference it by FK). Deleting a category clears (NULLs) the category on its products — the products themselves stay. Actions: list, get, create, update, delete.",
    {
      action: z.enum(['list', 'get', 'create', 'update', 'delete']),
      id: z.number().optional().describe('Category ID'),
      limit: z.number().optional(),
      offset: z.number().optional(),
      data: z.object({
        name: z.string().optional(),
      }).optional().describe('Category data (for create/update)'),
    },
    async ({ action, id, limit, offset, data }) => {
      const userId = await resolveUserId();
      switch (action) {
        case 'list':
          return callService(() => productCategoriesService.getAll(userId, { limit, offset }));
        case 'get':
          if (!id) return errorResponse('get requires id (the numeric category id). Use action="list" to see all categories.');
          return callService(() => productCategoriesService.getById(userId, id), { notFoundMsg: `Product category not found: id=${id}. Try action="list" to see existing categories.` });
        case 'create':
          if (!data?.name) return errorResponse('create requires data.name (the category label, e.g. "Network", "Endpoint Security").');
          return callService(() => productCategoriesService.create(userId, data));
        case 'update':
          if (!id) return errorResponse('update requires id (the numeric category id). Use action="list" to find ids.');
          if (!data) return errorResponse('update requires data (a partial category object). Currently just data.name.');
          return callService(() => productCategoriesService.patch(userId, id, data), { notFoundMsg: `Product category not found: id=${id}. Try action="list" to confirm the id.` });
        case 'delete':
          if (!id) return errorResponse('delete requires id (the numeric category id). Deleting clears (NULLs) category_id on any products in this category — the products themselves stay.');
          return callService(() => productCategoriesService.delete(userId, id), { notFoundMsg: `Product category not found: id=${id}. Already deleted, or wrong id.` });
        default:
          return errorResponse(`Unknown action: ${action}`);
      }
    }
  );

  // ── vendors ───────────────────────────────────────────────────────────

  server.tool(
    'vendors',
    "Global vendor catalog (Cisco, Palo Alto, CrowdStrike, …) used by vendor_products and ultimately by account_details. Shared across all users — no per-user isolation. Actions: list (filter by search/needs_review; soft-deleted rows excluded by default), get (by id or slug), find_or_create (idempotent on slug AND fuzzy-matched on name via pg_trgm — returns existing row with matched_by='fuzzy' + match_score when a near-duplicate is detected; otherwise auto-creates with needs_review=true. Use this from agent workflows so you never have to pre-check), update (PATCH), delete (soft-delete; references in account_details arrays are preserved), restore (clears deleted_at).",
    {
      action: z.enum(['list', 'get', 'find_or_create', 'update', 'delete', 'restore']),
      id: z.number().optional().describe('Vendor ID'),
      slug: z.string().optional().describe('Vendor slug (for get)'),
      search: z.string().optional().describe('ILIKE match on name or slug (for list)'),
      needs_review: z.boolean().optional().describe('Filter to vendors flagged for review (for list)'),
      include_deleted: z.boolean().optional().describe('Include soft-deleted rows (for list)'),
      limit: z.number().optional(),
      offset: z.number().optional(),
      data: z.object({
        name: z.string().optional(),
        slug: z.string().optional().describe('Optional; derived from name for find_or_create if omitted'),
        website: z.string().nullable().optional(),
        notes: z.string().nullable().optional(),
        needs_review: z.boolean().optional(),
      }).optional().describe('Vendor data (for find_or_create / update)'),
    },
    async ({ action, id, slug, search, needs_review, include_deleted, limit, offset, data }) => {
      switch (action) {
        case 'list':
          return callService(() => vendorsService.getAll({ search, needs_review, include_deleted, limit, offset }));
        case 'get':
          if (slug) return callService(() => vendorsService.getBySlug(slug), { notFoundMsg: `No vendor with slug "${slug}". Try action="list" with search (matches name or slug), or action="find_or_create" to add it.` });
          if (id) return callService(() => vendorsService.getById(id), { notFoundMsg: `Vendor not found: id=${id}. Try action="list" with search to find the right id.` });
          return errorResponse('get requires id or slug. Use action="list" with search to find vendors by name.');
        case 'find_or_create':
          if (!data?.name) return errorResponse('find_or_create requires data.name (the vendor company name, e.g. "Palo Alto Networks"). data.slug is optional — derived from name if omitted.');
          return callService(() => vendorsService.findOrCreate(data));
        case 'update':
          if (!id) return errorResponse('update requires id (the numeric vendor id). Use action="list" or "get" with slug to find ids.');
          if (!data) return errorResponse('update requires data (a partial vendor object). Fields: name, slug, website, notes, needs_review.');
          return callService(() => vendorsService.patch(id, data), { notFoundMsg: `Vendor not found: id=${id}. Try action="list" to confirm the id.` });
        case 'delete':
          if (!id) return errorResponse('delete requires id. This is a SOFT delete (sets deleted_at); references in account_details arrays are preserved so they do not dangle. Use action="restore" to undo.');
          return callService(() => vendorsService.softDelete(id), { notFoundMsg: `Vendor not found or already soft-deleted: id=${id}. Use action="list" with include_deleted=true to see deleted rows.` });
        case 'restore':
          if (!id) return errorResponse('restore requires id (clears deleted_at on a soft-deleted vendor). Use action="list" with include_deleted=true to find ids of deleted vendors.');
          return callService(() => vendorsService.restore(id), { notFoundMsg: `Vendor not found: id=${id}. Use action="list" with include_deleted=true.` });
        default:
          return errorResponse(`Unknown action: ${action}`);
      }
    }
  );

  // ── vendor_products ───────────────────────────────────────────────────

  server.tool(
    'vendor_products',
    "Global catalog of vendor products (Palo Alto PA-3220, CrowdStrike Falcon, Splunk Enterprise, …) — describes what your ACCOUNTS RUN, referenced by `account_details` *_ids arrays for tech-stack tracking. **Do NOT use this for opportunity product_ids — that's the separate per-user `products` tool. Different namespace; an id from here will not link to opp_products.** Each product belongs to one vendor and has a free-text `category` (firewall, edr, siem, idp, mfa, pam, email_security, mdr, msp, sase, sdwan, vpn, dlp, casb, vuln_mgmt, ticketing, email_collab, cloud_provider). Shared catalog — no per-user isolation. Actions: list (filter by vendor_id/vendor_slug/category/search; soft-deleted excluded by default), get (by id), find_or_create (idempotent on (vendor_id, slug) AND fuzzy-matched on name within the same vendor + category via pg_trgm — returns existing row with matched_by='fuzzy' + match_score when a near-duplicate is detected. Pass either vendor_id OR vendor_name — if vendor_name is given the vendor is auto-created too; new products are created with needs_review=true). update (PATCH; cannot change vendor_id), delete (soft), restore, merge (de-duplicate two rows: repoints every account_details reference from loser_id→winner_id, then soft-deletes the loser; same-category only).",
    {
      action: z.enum(['list', 'get', 'find_or_create', 'update', 'delete', 'restore', 'merge']),
      id: z.number().optional().describe('Product ID'),
      winner_id: z.number().optional().describe('merge: the surviving canonical product id'),
      loser_id: z.number().optional().describe('merge: the duplicate product id to retire (soft-deleted; its account_details references are repointed to winner_id)'),
      vendor_id: z.number().optional().describe('Filter by vendor (list) or required for find_or_create (alt to vendor_name)'),
      vendor_slug: z.string().optional().describe('Filter by vendor slug (list)'),
      category: z.string().optional().describe('Filter by category (list)'),
      search: z.string().optional().describe('ILIKE on product or vendor name (list)'),
      needs_review: z.boolean().optional(),
      include_deleted: z.boolean().optional(),
      limit: z.number().optional(),
      offset: z.number().optional(),
      data: z.object({
        vendor_id: z.number().optional(),
        vendor_name: z.string().optional().describe('Auto-creates the vendor if it doesn\'t exist (find_or_create only)'),
        name: z.string().optional(),
        slug: z.string().optional(),
        category: z.string().optional(),
        notes: z.string().nullable().optional(),
        needs_review: z.boolean().optional(),
      }).optional().describe('Product data (for find_or_create / update)'),
    },
    async ({ action, id, winner_id, loser_id, vendor_id, vendor_slug, category, search, needs_review, include_deleted, limit, offset, data }) => {
      switch (action) {
        case 'list':
          return callService(() => vendorProductsService.getAll({ vendor_id, vendor_slug, category, search, needs_review, include_deleted, limit, offset }));
        case 'get':
          if (!id) return errorResponse('get requires id (the numeric vendor_product id). Use action="list" with vendor_slug/category/search to find ids.');
          return callService(() => vendorProductsService.getById(id), { notFoundMsg: `Vendor product not found: id=${id}. Try action="list" with search to find the right id.` });
        case 'find_or_create':
          if (!data?.name) return errorResponse('find_or_create requires data.name (the product name, e.g. "PA-3220" or "Falcon").');
          if (!data?.category) return errorResponse('find_or_create requires data.category (firewall, edr, siem, idp, mfa, pam, email_security, mdr, msp, sase, sdwan, vpn, dlp, casb, vuln_mgmt, ticketing, email_collab, cloud_provider). If you meant to add a product YOU SELL to an opportunity, use the `products` tool instead — vendor_products is the global catalog of what accounts RUN.');
          if (!data.vendor_id && !data.vendor_name) return errorResponse('find_or_create requires data.vendor_id or data.vendor_name (the maker of this product, e.g. "Palo Alto Networks"). If you meant to add a product YOU SELL to an opportunity, use the `products` tool instead.');
          return callService(() => vendorProductsService.findOrCreate(data));
        case 'update':
          if (!id) return errorResponse('update requires id (the numeric vendor_product id). Use action="list" or "find_or_create" (idempotent) to find ids.');
          if (!data) return errorResponse('update requires data (a partial product object). vendor_id is immutable — to switch vendor, create a new product instead.');
          return callService(() => vendorProductsService.patch(id, data), { notFoundMsg: `Vendor product not found: id=${id}. Try action="list" to confirm the id.` });
        case 'delete':
          if (!id) return errorResponse('delete requires id. This is a SOFT delete (sets deleted_at) so account_details *_ids references do not dangle. Use action="restore" to undo.');
          return callService(() => vendorProductsService.softDelete(id), { notFoundMsg: `Vendor product not found or already soft-deleted: id=${id}. Use action="list" with include_deleted=true to see deleted rows.` });
        case 'restore':
          if (!id) return errorResponse('restore requires id (clears deleted_at on a soft-deleted product). Use action="list" with include_deleted=true to find ids of deleted rows.');
          return callService(() => vendorProductsService.restore(id), { notFoundMsg: `Vendor product not found: id=${id}. Use action="list" with include_deleted=true.` });
        case 'merge':
          if (!winner_id || !loser_id) return errorResponse('merge requires winner_id (the canonical product that survives) and loser_id (the duplicate to retire). It repoints every account_details reference from loser→winner (same-category only, de-duplicated) and soft-deletes the loser. Find ids via action="list".');
          return callService(() => vendorProductsService.merge(winner_id, loser_id));
        default:
          return errorResponse(`Unknown action: ${action}`);
      }
    }
  );

  // ── import_export ─────────────────────────────────────────────────────

  server.tool(
    'import_export',
    'Portable JSON bundles for moving accounts (with details, contacts, meetings, opportunities, and partner shells) between tenants. Actions: export (returns a bundle JSON for one or more account slugs), import (merges a bundle into the current tenant — accounts matched by slug, contacts by email/name, meetings by filename, opportunities by name; vendor products dedupe globally by slug). Only an account\'s own profile contacts travel in the bundle — meeting attendees are exported and re-linked only when they\'re contacts on that account, so importing never spawns unrelated "filler" contacts (the meeting\'s free-text attendee line still names everyone). Different from `export_markdown`, which produces human-readable docs; this is a round-trippable data export.',
    {
      action: z.enum(['export', 'import']),
      slugs: z.array(z.string()).optional().describe('Account slugs to export (for export action). Required for export.'),
      bundle: z.any().optional().describe('Bundle object to import (for import action). Must have format=se-os/account-bundle, version=1, and an accounts array.'),
    },
    async ({ action, slugs, bundle }) => {
      const userId = await resolveUserId();
      switch (action) {
        case 'export':
          if (!Array.isArray(slugs) || slugs.length === 0) return errorResponse('export requires slugs — a non-empty array of account slugs (use the accounts tool action="list" to discover slugs). Returns a portable bundle that import can ingest on another tenant.');
          return callService(() => importExportService.exportAccounts(userId, slugs));
        case 'import':
          if (!bundle || typeof bundle !== 'object') return errorResponse('import requires bundle — the JSON object produced by action="export" on another tenant. Shape: { format: "se-os/account-bundle", version: 1, accounts: [...] }.');
          return callService(() => importExportService.importBundle(userId, bundle));
        default:
          return errorResponse(`Unknown action: ${action}`);
      }
    }
  );

  // ── account_details ───────────────────────────────────────────────────

  server.tool(
    'account_details',
    "Technical profile for an account — replaces the old accounts.environment JSONB. Typed columns for firmographics (revenue_usd, employee_count, site_count, dc_count, hq_city/state/country, it_team_size, security_team_size, industry), categorical facts (soc_model, compliance_frameworks text[], has_ot_environment, has_iot_environment), per-category vendor product arrays (firewall_ids, edr_ids, siem_ids, idp_ids, mfa_ids, pam_ids, email_security_ids, mdr_ids, msp_ids, sase_ids, sdwan_ids, vpn_ids, dlp_ids, casb_ids, vuln_mgmt_ids, ticketing_ids, productivity_suite_ids, cloud_provider_ids, cspm_ids, appsec_ids, ndr_ids, iot_ot_ids, ai_security_ids), plus a `technical_notes` text field for prose that doesn't compress into a column. Actions: get (by account_id; returns the row with each *_ids array expanded into a *_products list of resolved vendor product objects), update (PATCH — scalar fields are touched only when present; array fields are FULLY REPLACED when present, pass [] to clear), delete (removes the row entirely), vendor_heatmap (returns the account stack as a buckets→subcategories→products matrix: 5 portfolio buckets — ai_security, cloud, identity, network, soc — each with its fine-grained subcategories carrying the vendor products the account runs there; empty subcategories are included with empty product lists so callers can render no-solution cells). To set vendor products: first resolve product IDs via vendor_products find_or_create, then pass the array of resulting product IDs in the appropriate *_ids field.",
    {
      action: z.enum(['get', 'update', 'delete', 'vendor_heatmap']),
      account_id: z.number().describe('Account ID — required for all actions'),
      data: z.object({
        industry: z.string().nullable().optional(),
        revenue_usd: z.number().nullable().optional(),
        employee_count: z.number().nullable().optional(),
        user_count: z.number().nullable().optional(),
        endpoint_count: z.number().nullable().optional(),
        server_count: z.number().nullable().optional(),
        site_count: z.number().nullable().optional(),
        dc_count: z.number().nullable().optional(),
        hq_city: z.string().nullable().optional(),
        hq_state: z.string().nullable().optional(),
        hq_country: z.string().nullable().optional(),
        it_team_size: z.number().nullable().optional(),
        security_team_size: z.number().nullable().optional(),
        soc_model: z.string().nullable().optional(),
        compliance_frameworks: z.array(z.string()).optional(),
        has_ot_environment: z.boolean().nullable().optional(),
        has_iot_environment: z.boolean().nullable().optional(),
        firewall_ids:       z.array(z.number()).optional(),
        edr_ids:            z.array(z.number()).optional(),
        siem_ids:           z.array(z.number()).optional(),
        idp_ids:            z.array(z.number()).optional(),
        mfa_ids:            z.array(z.number()).optional(),
        pam_ids:            z.array(z.number()).optional(),
        email_security_ids: z.array(z.number()).optional(),
        mdr_ids:            z.array(z.number()).optional(),
        msp_ids:            z.array(z.number()).optional(),
        sase_ids:           z.array(z.number()).optional(),
        sdwan_ids:          z.array(z.number()).optional(),
        vpn_ids:            z.array(z.number()).optional(),
        dlp_ids:            z.array(z.number()).optional(),
        casb_ids:           z.array(z.number()).optional(),
        vuln_mgmt_ids:      z.array(z.number()).optional(),
        ticketing_ids:          z.array(z.number()).optional(),
        productivity_suite_ids: z.array(z.number()).optional(),
        cloud_provider_ids:     z.array(z.number()).optional(),
        cspm_ids:               z.array(z.number()).optional(),
        appsec_ids:             z.array(z.number()).optional(),
        ndr_ids:                z.array(z.number()).optional(),
        iot_ot_ids:             z.array(z.number()).optional(),
        ai_security_ids:        z.array(z.number()).optional(),
        technical_notes: z.string().nullable().optional(),
        last_verified_at: z.string().nullable().optional(),
      }).optional().describe('Tech profile fields (for update — PATCH semantics)'),
    },
    async ({ action, account_id, data }) => {
      const userId = await resolveUserId();
      switch (action) {
        case 'get':
          return callService(() => accountDetailsService.getByAccountId(userId, account_id), { notFoundMsg: `No account_details row for account_id=${account_id} (the account has no tech profile yet — populate one via action="update"). If the account itself does not exist, the accounts tool will tell you; check there first.` });
        case 'update':
          if (!data) return errorResponse('update requires data (a partial tech-profile object). Scalar fields (employee_count, revenue_usd, hq_city, etc.) only update when present. Array fields (firewall_ids, edr_ids, …) are FULLY REPLACED when present — pass [] to clear, omit to leave alone. Find vendor_product ids via the vendor_products tool (find_or_create with vendor_name+name+category if missing).');
          return callService(() => accountDetailsService.upsert(userId, account_id, data));
        case 'delete':
          return callService(() => accountDetailsService.delete(userId, account_id), { notFoundMsg: `No account_details row for account_id=${account_id} (already deleted, or never populated).` });
        case 'vendor_heatmap':
          return callService(() => vendorHeatmapService.getByAccountId(userId, account_id));
        default:
          return errorResponse(`Unknown action: ${action}`);
      }
    }
  );

  // ── notes ─────────────────────────────────────────────────────────────

  server.tool(
    'notes',
    'Timestamped markdown notes attached to exactly one of account / contact / opportunity. Use this for short, dated journal entries (each note carries its own created_at) rather than one long-running document — a contact may accumulate dozens of small observations over months, and the feed lets you scan them chronologically. Different from `meetings` (a full call summary tied to attendees) and `accounts.relationship_summary` (a single rolling overview). Actions: list (pass exactly one of account_id / contact_id / opportunity_id; newest first), get (by id), create (one target + body), update (body only — target is immutable), delete.',
    {
      action: z.enum(['list', 'get', 'create', 'update', 'delete']),
      id: z.number().optional().describe('Note ID (for get, update, delete)'),
      account_id: z.number().optional().describe('Account ID (for list, or in data for create)'),
      contact_id: z.number().optional().describe('Contact ID (for list, or in data for create)'),
      opportunity_id: z.number().optional().describe('Opportunity ID (for list, or in data for create)'),
      limit: z.number().optional().describe('Page size (for list, default 200, max 500)'),
      offset: z.number().optional().describe('Page offset (for list, default 0)'),
      data: z.object({
        account_id: z.number().optional(),
        contact_id: z.number().optional(),
        opportunity_id: z.number().optional(),
        body: z.string().optional().describe('Markdown body of the note'),
      }).optional().describe('Note data (for create/update). For create, set exactly one of account_id/contact_id/opportunity_id and the body.'),
    },
    async ({ action, id, account_id, contact_id, opportunity_id, limit, offset, data }) => {
      const userId = await resolveUserId();
      switch (action) {
        case 'list': {
          const targets = [account_id, contact_id, opportunity_id].filter((v) => v != null);
          if (targets.length !== 1) return errorResponse('list requires EXACTLY one target: account_id, contact_id, or opportunity_id (notes belong to one entity). Resolve the entity id via the accounts/contacts/opportunities tool first.');
          return callService(() => notesService.getAll(userId, { account_id, contact_id, opportunity_id, limit, offset }));
        }
        case 'get':
          if (!id) return errorResponse('get requires id (the numeric note id). Use action="list" with one of account_id/contact_id/opportunity_id to find note ids.');
          return callService(() => notesService.getById(userId, id), { notFoundMsg: `Note not found: id=${id}. Try action="list" against the parent entity to confirm.` });
        case 'create': {
          if (!data?.body) return errorResponse('create requires data.body (markdown text). Also requires exactly one of data.account_id / data.contact_id / data.opportunity_id (the entity this note belongs to).');
          const t = [data.account_id, data.contact_id, data.opportunity_id].filter((v) => v != null);
          if (t.length !== 1) return errorResponse('create requires EXACTLY one of data.account_id, data.contact_id, data.opportunity_id (notes attach to one entity). Resolve the id via the corresponding tool first.');
          return callService(() => notesService.create(userId, data));
        }
        case 'update':
          if (!id) return errorResponse('update requires id (the numeric note id). Use action="list" against the parent entity to find ids.');
          if (!data) return errorResponse('update requires data — only data.body is mutable (the target entity is immutable; if you got the target wrong, delete and re-create).');
          return callService(() => notesService.patch(userId, id, data), { notFoundMsg: `Note not found: id=${id}. Try action="list" against the parent entity to confirm.` });
        case 'delete':
          if (!id) return errorResponse('delete requires id (the numeric note id). Use action="list" against the parent entity to find ids.');
          return callService(() => notesService.delete(userId, id), { notFoundMsg: `Note not found: id=${id}. Already deleted, or wrong id.` });
        default:
          return errorResponse(`Unknown action: ${action}`);
      }
    }
  );

  // ── threads ───────────────────────────────────────────────────────────

  server.tool(
    'threads',
    'Threads + tasks: open workstreams per account and the actionable steps inside them. A thread is a relationship-level workstream tied to ONE account ("Firewall refresh POV") — the "where do we stand" record, distinct from a meeting (a dated call summary) or accounts.relationship_summary (one rolling overview). A task is a single step inside a thread, with an optional assignee (a contact; null = no one) and an optional due_date; completion is tracked in the CRM itself (completed_at — there is NO Todoist sync). A thread\'s contact pool (link_contact) is the set of people involved — the list you pick task assignees from. Lists are OPEN-ONLY by default; closed threads are kept for history and hidden unless include_closed=true. Actions: list (threads for an account, each enriched with its tasks + contact pool — requires account_id), get (one thread by id), create (on an account — account_id + data.title; optional data.contact_ids seeds the pool), update (PATCH a thread — data.title/description, or data.closed=true/false to close/reopen), delete (cascades the thread\'s tasks + pool links — prefer update closed=true to keep history), add_task (add a step to a thread — id is the thread, task.title required, optional task.assignee_contact_id / task.due_date), update_task (PATCH a task by task_id — task.assignee_contact_id=null clears the assignee, task.completed=true/false toggles done), delete_task (by task_id), link_contact (add a contact to the pool — id is the thread, contact_id), unlink_contact (remove from the pool; does not unassign their tasks).',
    {
      action: z.enum(['list', 'get', 'create', 'update', 'delete', 'add_task', 'update_task', 'delete_task', 'link_contact', 'unlink_contact']),
      id: z.number().optional().describe('Thread ID (for get, update, delete, add_task, link_contact, unlink_contact)'),
      task_id: z.number().optional().describe('Task ID (for update_task, delete_task)'),
      account_id: z.number().optional().describe('Account ID (for list and create)'),
      contact_id: z.number().optional().describe('Contact ID (for link_contact, unlink_contact)'),
      include_closed: z.boolean().optional().describe('For list: include closed threads (hidden by default).'),
      data: z.object({
        title: z.string().optional().describe('Thread title (required on create).'),
        description: z.string().nullable().optional(),
        closed: z.boolean().optional().describe('On update: true closes the thread (kept for history), false reopens it.'),
        contact_ids: z.array(z.number()).optional().describe('On create: contact ids to seed the involved-people pool.'),
      }).optional().describe('Thread fields (for create/update).'),
      task: z.object({
        title: z.string().optional().describe('Task title (required on add_task).'),
        description: z.string().nullable().optional(),
        assignee_contact_id: z.number().nullable().optional().describe('Contact id to assign, or null for "no one".'),
        due_date: z.string().nullable().optional().describe('Due date YYYY-MM-DD, or null to clear.'),
        completed: z.boolean().optional().describe('true marks the task done, false reopens it.'),
      }).optional().describe('Task fields (for add_task/update_task).'),
    },
    async ({ action, id, task_id, account_id, contact_id, include_closed, data, task }) => {
      const userId = await resolveUserId();
      switch (action) {
        case 'list':
          if (!account_id) return errorResponse('list requires account_id (the account whose threads you want). Resolve it via the accounts/search tool first. Returns open threads only unless include_closed=true.');
          return callService(() => threadsService.getAllForAccount(userId, account_id, { include_closed: !!include_closed }));
        case 'get':
          if (!id) return errorResponse('get requires id (the numeric thread id). Use action="list" with account_id to find thread ids.');
          return callService(() => threadsService.getById(userId, id), { notFoundMsg: `Thread not found: id=${id}. Try action="list" with account_id to confirm.` });
        case 'create':
          if (!account_id) return errorResponse('create requires account_id (the account the thread belongs to). Resolve it via the accounts/search tool first.');
          if (!data?.title) return errorResponse('create requires data.title (the thread name, e.g. "Firewall refresh POV"). Optional: data.description, data.contact_ids (seed the involved-people pool).');
          return callService(() => threadsService.create(userId, { account_id, title: data.title, description: data.description, contact_ids: data.contact_ids }));
        case 'update':
          if (!id) return errorResponse('update requires id (the numeric thread id).');
          if (!data) return errorResponse('update requires data — any of title, description, or closed (true to close, false to reopen). Only fields you send change.');
          return callService(() => threadsService.patch(userId, id, data), { notFoundMsg: `Thread not found: id=${id}. Try action="list" with account_id to confirm.` });
        case 'delete':
          if (!id) return errorResponse('delete requires id (the numeric thread id). This cascades the thread\'s tasks + pool links; prefer action="update" with data.closed=true to keep history.');
          return callService(() => threadsService.delete(userId, id), { notFoundMsg: `Thread not found: id=${id}. Already deleted, or wrong id.` });
        case 'add_task':
          if (!id) return errorResponse('add_task requires id (the thread the task belongs to).');
          if (!task?.title) return errorResponse('add_task requires task.title (what the step is, e.g. "Send updated SOW"). Optional: task.assignee_contact_id (a contact id; omit/null = no one), task.due_date (YYYY-MM-DD).');
          return callService(() => threadsService.createTask(userId, id, task));
        case 'update_task':
          if (!task_id) return errorResponse('update_task requires task_id (the numeric task id). Use action="get"/"list" on its thread to find task ids.');
          if (!task) return errorResponse('update_task requires task — any of title, description, assignee_contact_id (null clears), due_date (null clears), completed (true/false).');
          return callService(() => threadsService.patchTask(userId, task_id, task), { notFoundMsg: `Task not found: id=${task_id}. Use action="get" on its thread to confirm.` });
        case 'delete_task':
          if (!task_id) return errorResponse('delete_task requires task_id (the numeric task id).');
          return callService(() => threadsService.deleteTask(userId, task_id), { notFoundMsg: `Task not found: id=${task_id}. Already deleted, or wrong id.` });
        case 'link_contact':
          if (!id || !contact_id) return errorResponse('link_contact requires id (the thread) and contact_id (the person to add to the pool). Returns the enriched thread.');
          return callService(() => threadsService.linkContact(userId, id, contact_id));
        case 'unlink_contact':
          if (!id || !contact_id) return errorResponse('unlink_contact requires id (the thread) and contact_id (the person to remove from the pool).');
          return callService(() => threadsService.unlinkContact(userId, id, contact_id));
        default:
          return errorResponse(`Unknown action: ${action}`);
      }
    }
  );

  // ── internal_domains ──────────────────────────────────────────────────

  server.tool(
    'internal_domains',
    "Manage the caller's internal email domains — the domains that belong to the user's own company. Emails from these domains are auto-flagged kind=internal in the from-emails meeting flow (so they don't trigger account creation or LinkedIn enrichment). Actions: list (alpha order), add (idempotent on (user, domain); domain is normalized — lowercased, www./protocol/subpath stripped), remove. Fresh installs fall back to the env vars SELF_DOMAINS / INTERNAL_DOMAINS until the user adds their first row, after which the curated list wins.",
    {
      action: z.enum(['list', 'add', 'remove']),
      domain: z.string().optional().describe('Bare domain like "paloaltonetworks.com" — URLs and www. prefixes are accepted and normalized.'),
    },
    async ({ action, domain }) => {
      const userId = await resolveUserId();
      switch (action) {
        case 'list':
          return callService(async () => ({ domains: await internalDomainsService.list(userId) }));
        case 'add':
          if (!domain) return errorResponse('add requires domain (must contain "." — e.g. "paloaltonetworks.com"). URLs and www. prefixes are normalized before storage.');
          return callService(() => internalDomainsService.add(userId, domain));
        case 'remove':
          if (!domain) return errorResponse('remove requires domain (the bare domain to drop from the internal list). Use action="list" to see currently flagged domains.');
          return callService(() => internalDomainsService.remove(userId, domain));
        default:
          return errorResponse(`Unknown action: ${action}`);
      }
    }
  );

  // ── memories ──────────────────────────────────────────────────────────

  server.tool(
    'memories',
    'Per-user long-lived preferences, rules, and facts that should apply across agent sessions ("always summarize in bullets", "user\'s home airport is PHX", "never propose changes to opportunity stage without asking"). Enabled memories are rendered into the agent\'s system prompt at session start — they\'re already in context, so this tool exists for managing the list, not for fetching memories mid-turn. Actions: list (filter by enabled / search; newest first), get (by id), create (save a new memory — **ONLY call this when the user explicitly asks** with "remember that…", "save a memory about…", "from now on…"; never save on your own judgment), update (PATCH any of title/content/enabled — toggling enabled is the soft-mute path), delete (permanent — prefer disabling).',
    {
      action: z.enum(['list', 'get', 'create', 'update', 'delete']),
      id: z.number().optional().describe('Memory ID (for get, update, delete)'),
      enabled: z.boolean().optional().describe('Filter (for list) — true returns only active memories, false only muted, omit for both.'),
      search: z.string().optional().describe('ILIKE filter on title and content (for list).'),
      limit: z.number().optional().describe('Page size (for list, default 100, max 500)'),
      offset: z.number().optional().describe('Page offset (for list, default 0)'),
      data: z.object({
        title:   z.string().nullable().optional().describe('Short label, optional'),
        content: z.string().optional().describe('The memory text — preference, rule, or fact the agent should apply in future sessions'),
        enabled: z.boolean().optional().describe('Defaults to true on create'),
      }).optional().describe('Memory data (for create/update). Create requires content.'),
    },
    async ({ action, id, enabled, search, limit, offset, data }) => {
      const userId = await resolveUserId();
      switch (action) {
        case 'list':
          return callService(() => memoriesService.list(userId, { enabled, search, limit, offset }));
        case 'get':
          if (!id) return errorResponse('get requires id (the numeric memory id). Use action="list" to find ids.');
          return callService(() => memoriesService.getById(userId, id), { notFoundMsg: `Memory not found: id=${id}. Try action="list" to confirm.` });
        case 'create':
          if (!data?.content) return errorResponse('create requires data.content (the memory text — a preference, rule, or fact to remember). Reminder: only call this when the user explicitly asks ("remember that…", "save a memory about…"). Optional: data.title (short label), data.enabled (defaults to true).');
          return callService(() => memoriesService.create(userId, data));
        case 'update':
          if (!id) return errorResponse('update requires id (the numeric memory id). Use action="list" to find ids.');
          if (!data) return errorResponse('update requires data — any of title, content, enabled. Omitted fields are unchanged. Toggling enabled is the soft-mute path; prefer it over delete when the user might want the memory back later.');
          return callService(() => memoriesService.patch(userId, id, data), { notFoundMsg: `Memory not found: id=${id}.` });
        case 'delete':
          if (!id) return errorResponse('delete requires id (the numeric memory id). Removes the row permanently; prefer action="update" with data.enabled=false if the user might want it back.');
          return callService(() => memoriesService.delete(userId, id), { notFoundMsg: `Memory not found: id=${id}. Already deleted, or wrong id.` });
        default:
          return errorResponse(`Unknown action: ${action}`);
      }
    }
  );

  // ── agent_settings ────────────────────────────────────────────────────

  server.tool(
    'agent_settings',
    "Get or update the caller's saved agent config — the LLM fields `provider` (always `local`: an OpenAI-compatible inference server, by default Ollama running on the device itself), default `model` (e.g. gemma4:12b), `local_base_url` for that server, and the agent's base `system_prompt` (its core instructions/persona). Persisted server-side so background workers (contact enrichment formatter, etc.) call the same local LLM the user configured, and so the in-app agent runs with the user's prompt. Actions: get (returns the stored row — including `system_prompt` (null until customized) and `default_system_prompt` (the built-in default rendered live) — plus env-fallback effective values), update (PATCH — pass any subset of provider/model/local_base_url/system_prompt; null clears a field, after which the default applies). The system prompt is user-owned config: **only change it when the user explicitly asks** (\"change your system prompt to…\", \"reset your instructions\"); never rewrite your own base instructions on your own initiative. Don't bake the current date into system_prompt — the agent loop injects today's date automatically.",
    {
      action: z.enum(['get', 'update']),
      data: z.object({
        provider:       z.enum(['local']).nullable().optional(),
        model:          z.string().nullable().optional(),
        local_base_url: z.string().nullable().optional(),
        system_prompt:  z.string().nullable().optional().describe("Agent base instructions/persona. Null or empty reverts to the built-in default (see default_system_prompt from a get)."),
      }).optional(),
    },
    async ({ action, data }) => {
      const userId = await resolveUserId();
      switch (action) {
        case 'get':
          return callService(() => agentSettingsService.get(userId));
        case 'update':
          if (!data) return errorResponse('update requires data (a partial settings object). Fields: provider ("local" | null to clear), model (string | null, e.g. "gemma4:12b"), local_base_url (string | null, e.g. "http://host.docker.internal:11434" for on-device Ollama), system_prompt (string | null — the agent\'s base instructions; null/empty reverts to the built-in default). Only change system_prompt on explicit user request.');
          return callService(() => agentSettingsService.update(userId, data));
        default:
          return errorResponse(`Unknown action: ${action}`);
      }
    }
  );

  // ── backup ────────────────────────────────────────────────────────────

  server.tool(
    'backup',
    'Database backups (pg_dump custom format). Backups are instance-wide, not per-user — a single dump captures every tenant\'s data, including every settings table (app_settings, user_agent_settings, user_internal_domains, user_memories, user_theme_settings, themes). Files land in the bind-mounted target directory (default /backups; the host mount is configured via BACKUP_HOST_DIR in the operator\'s .env). Actions: get_settings, update_settings (PATCH the retention_count / target_dir fields), list (newest first, with filename / size / created_at), run (trigger a dump now), import_from_path (register an externally-produced dump that\'s already on the API container\'s filesystem — validated by PGDMP magic header and renamed to crm-imported-<timestamp>.dump), restore (DESTRUCTIVE — pg_restore --clean --if-exists drops and recreates every object; only call when intentionally rolling back), delete (remove a dump file). Binary uploads from the user\'s machine go through the HTTP route POST /api/backup/import (octet-stream body) — not exposed over MCP.',
    {
      action: z.enum(['get_settings', 'update_settings', 'list', 'run', 'import_from_path', 'restore', 'delete']),
      filename: z.string().optional().describe('Backup filename (for restore / delete)'),
      path: z.string().optional().describe('Absolute path on the API container\'s filesystem (for import_from_path)'),
      settings: z.object({
        retention_count: z.number().int().min(0).optional().describe('Number of dumps to keep (0 = keep all)'),
        target_dir: z.string().optional().describe('Absolute path inside the container where dumps are written (default /backups — must be inside the bind-mount)'),
      }).optional().describe('Settings patch (for update_settings)'),
    },
    async ({ action, filename, path, settings }) => {
      switch (action) {
        case 'get_settings':
          return callService(() => backupService.getSettings());
        case 'update_settings':
          if (!settings) return errorResponse('update_settings requires settings — a partial config object. Fields: retention_count (int, 0=keep all), target_dir (absolute path inside the container).');
          return callService(() => backupService.updateSettings(settings));
        case 'list':
          return callService(() => backupService.listBackups());
        case 'run':
          return callService(() => backupService.runBackup());
        case 'import_from_path':
          if (!path) return errorResponse('import_from_path requires path — an absolute path on the API container\'s filesystem pointing at a pg_dump custom-format file. The file is validated (PGDMP magic header) and copied into target_dir under a normalized crm-imported-<timestamp>.dump name. Useful when an operator has scp\'d a dump onto the host bind mount; for browser uploads use the HTTP route POST /api/backup/import instead.');
          return callService(() => backupService.importBackup({ sourcePath: path }));
        case 'restore':
          if (!filename) return errorResponse('restore requires filename (one of the entries from action="list"). DESTRUCTIVE — pg_restore --clean --if-exists drops and recreates every object. Only call when intentionally rolling back.');
          return callService(() => backupService.restoreBackup(filename));
        case 'delete':
          if (!filename) return errorResponse('delete requires filename (one of the entries from action="list"). Removes the file from disk.');
          return callService(() => backupService.deleteBackup(filename));
        default:
          return errorResponse(`Unknown action: ${action}`);
      }
    }
  );
}
