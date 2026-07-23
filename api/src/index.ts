// TODO: Add authentication for production/remote access

import Fastify from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import path from 'path';
import { getConfig } from './config.js';
import { initDb, closeDb, getPool } from './db/connection.js';
import { getCurrentUserId, getDefaultUserId } from './auth.js';
import { logger } from './lib/logger.js';

// Services
import { AccountsService } from './services/accounts/accounts.js';
import { ContactsService } from './services/contacts/contacts.js';
import { MeetingsService } from './services/meetings/meetings.js';
import { SearchService } from './services/search/search.js';
import { TodoistService } from './services/todoist/todoist.js';
import { ExportService } from './services/export/export.js';
import { OutreachService } from './services/outreach/outreach.js';
import { EventsService } from './services/events/events.js';
import { OpportunitiesService } from './services/opportunities/opportunities.js';
import { ProductsService } from './services/products/products.js';
import { ProductCategoriesService } from './services/products/product-categories.js';
import { VendorsService } from './services/vendors/vendors.js';
import { VendorProductsService } from './services/vendors/vendor-products.js';
import { AccountDetailsService } from './services/accounts/account-details.js';
import { VendorHeatmapService } from './services/accounts/vendor-heatmap.js';
import { OrgChartService } from './services/accounts/org-chart.js';
import { ImportExportService } from './services/import-export/import-export.js';
import { NotesImportService } from './services/notes/notes-import.js';
import { CalendarImportService } from './services/calendar-import/calendar-import.js';
import { KrispWebhookService } from './services/krisp-webhook/krisp-webhook.js';
import { MergeService } from './services/merge/merge.js';
import { MeetingMergeHandler } from './services/merge/handlers/meetings.js';
import { NotesService } from './services/notes/notes.js';
import { BackupService } from './services/backup/backup.js';
import { ContactEnrichmentService } from './services/contacts/contact-enrichment.js';
import { InternalDomainsService } from './services/internal-domains/internal-domains.js';
import { AgentSettingsService } from './services/agent/agent-settings.js';
import { ThemesService } from './services/themes/themes.js';
import { MemoriesService } from './services/memories/memories.js';
import { ThreadsService } from './services/threads/threads.js';
import { NewsService } from './services/news/news.js';
import { Scheduler } from './services/scheduler/scheduler.js';
import { createProvisioningRuntime, createProvisioningWorker } from './services/provisioning/index.js';

// Routes
import accountRoutes from './routes/accounts/accounts.js';
import contactRoutes from './routes/contacts/contacts.js';
import meetingRoutes from './routes/meetings/meetings.js';
import searchRoutes from './routes/search/search.js';
import todoistRoutes from './routes/todoist/todoist.js';
import healthRoutes from './routes/health/health.js';
import exportRoutes from './routes/export/export.js';
import agentRoutes from './routes/agent/agent.js';
import outreachRoutes from './routes/outreach/outreach.js';
import eventRoutes from './routes/events/events.js';
import opportunityRoutes from './routes/opportunities/opportunities.js';
import productRoutes from './routes/products/products.js';
import productCategoryRoutes from './routes/products/product-categories.js';
import vendorRoutes from './routes/vendors/vendors.js';
import vendorProductRoutes from './routes/vendors/vendor-products.js';
import accountDetailsRoutes from './routes/accounts/account-details.js';
import orgChartRoutes from './routes/accounts/org-chart.js';
import importExportRoutes from './routes/import-export/import-export.js';
import notesImportRoutes from './routes/notes/notes-import.js';
import calendarImportRoutes from './routes/calendar-import/calendar-import.js';
import krispWebhookRoutes from './routes/krisp-webhook/krisp-webhook.js';
import mergeRoutes from './routes/merge/merge.js';
import noteRoutes from './routes/notes/notes.js';
import backupRoutes from './routes/backup/backup.js';
import internalDomainRoutes from './routes/internal-domains/internal-domains.js';
import themeRoutes from './routes/themes/themes.js';
import memoryRoutes from './routes/memories/memories.js';
import threadRoutes from './routes/threads/threads.js';
import newsRoutes from './routes/news/news.js';
import provisioningRoutes from './routes/provisioning/provisioning.js';

const config = getConfig();
const todoistEnabled = process.env.TODOIST_ENABLED !== 'false';
const fastify = Fastify({ loggerInstance: logger });

// Verify DB connection
await initDb();
logger.info('Database connection verified');

// Warm the default-user cache so the first request doesn't pay for the lookup.
const defaultUserId = await getDefaultUserId();

// Initialize services
const accountsService = new AccountsService();
const contactsService = new ContactsService();
const searchService = new SearchService();
const todoistService = todoistEnabled ? new TodoistService() : null;
const exportService = new ExportService();
const outreachService = new OutreachService();
const agentSettingsService = new AgentSettingsService();
const contactEnrichmentService = new ContactEnrichmentService({
  outreachService,
  contactsService,
  agentSettingsService,
});
const internalDomainsService = new InternalDomainsService();
// Wire ContactsService's post-construction deps (same as the MCP service bags in
// mcp/server.js and agent/mcp-client.js). They can't be constructor args because
// contactEnrichmentService itself depends on contactsService — a construction
// cycle — so they're attached after the fact. Without this the from-emails
// staging methods (resolveEmails / importFromEmails, used by the GUI's
// from-emails flow and POST /api/{contacts,meetings}/from-emails) throw
// "requires accountsService".
contactsService.accountsService = accountsService;
contactsService.internalDomainsService = internalDomainsService;
contactsService.contactEnrichmentService = contactEnrichmentService;
const meetingsService = new MeetingsService({
  contactsService,
  accountsService,
  contactEnrichmentService,
  internalDomainsService,
});
const eventsService = new EventsService();
const opportunitiesService = new OpportunitiesService();
const productsService = new ProductsService();
const productCategoriesService = new ProductCategoriesService();
const vendorsService = new VendorsService();
const vendorProductsService = new VendorProductsService({ vendorsService });
const accountDetailsService = new AccountDetailsService();
const vendorHeatmapService = new VendorHeatmapService();
const orgChartService = new OrgChartService();
const importExportService = new ImportExportService({ contactsService, accountsService });
const notesImportService = new NotesImportService({ meetingsService, accountsService, agentSettingsService });
const calendarImportService = new CalendarImportService({ meetingsService, accountsService, contactsService, internalDomainsService });
const krispWebhookService = new KrispWebhookService({ meetingsService });
const mergeService = new MergeService({ meetings: new MeetingMergeHandler({ meetingsService }) });
const notesService = new NotesService();
const backupService = new BackupService();
const themesService = new ThemesService();
const memoriesService = new MemoriesService();
const threadsService = new ThreadsService();
const newsService = new NewsService({ accountsService, agentSettingsService });
// Provisioning (homelab broker). The runtime factory makes the shared broker,
// Postgres repos, and secrets resolver explicit. This API process also owns the
// single DB-claim worker; MCP processes build a runtime for reads/enqueue only.
const provisioningRuntime = createProvisioningRuntime({ userId: defaultUserId });
const provisioningService = provisioningRuntime.service;
const provisioningWorker = createProvisioningWorker(provisioningRuntime);

// Recurring background tasks (starred-account news refresh, etc.). Durable and
// multi-replica-safe via a Postgres claim table; only the API process runs it,
// mirroring the provisioning worker. Register additional tasks here as needed.
const scheduler = new Scheduler();
scheduler.register({
  name: 'account-news-refresh',
  schedule: {
    kind: 'daily',
    hour: Number(process.env.NEWS_REFRESH_HOUR ?? 9),
    minute: Number(process.env.NEWS_REFRESH_MINUTE ?? 0),
    tz: process.env.NEWS_REFRESH_TZ || 'America/New_York',
  },
  handler: async () => {
    await newsService.refreshAllFavorites();
  },
});

fastify.decorate('searchService', searchService);

await fastify.register(cors);

await fastify.register(swagger, {
  openapi: {
    openapi: '3.0.3',
    info: {
      title: 'Account Notes API',
      description: 'API for managing sales account notes, contacts, meetings, and tasks. Used by LLM agents and the web GUI.',
      version: '2.0.0',
    },
    servers: [{ url: '/' }],
    tags: [
      { name: 'accounts', description: 'Account CRUD and search' },
      { name: 'contacts', description: 'Contact management' },
      { name: 'meetings', description: 'Meeting notes (set internal=true for internal-only notes)' },
      { name: 'search', description: 'Full-text search' },
      { name: 'todoist', description: 'Todoist task management' },
      { name: 'outreach', description: 'LinkedIn + web enrichment (async, queued)' },
      { name: 'events', description: 'Public event calendar (scraped) + per-user contact matching' },
      { name: 'opportunities', description: 'Sales opportunities tied to non-partner accounts' },
      { name: 'products', description: 'Sales product catalog and categories (what you sell)' },
      { name: 'vendors', description: 'Global catalog of vendors (Cisco, Palo Alto, …)' },
      { name: 'vendor-products', description: 'Global catalog of vendor products (firewalls, EDRs, SIEMs, …) used by account_details' },
      { name: 'account-details', description: 'Technical profile per account (firmographics + vendor products + notes)' },
      { name: 'org-chart', description: 'Account-scoped reporting relationships between linked contacts' },
      { name: 'notes', description: 'Timestamped markdown notes attached to an account, contact, or opportunity' },
      { name: 'news', description: 'Per-account news headlines (Google News RSS, ranked by the configured local LLM); manual refresh + a daily auto-refresh for starred (favorite) accounts' },
      { name: 'threads', description: 'Open workstreams per account, each with tasks (assignee + due date) and a contact pool' },
      { name: 'export', description: 'Human-readable account exports (Drive-ready DOCX folders over HTTP; markdown over MCP)' },
      { name: 'import-export', description: 'Portable JSON bundles for moving accounts between tenants' },
      { name: 'notes-import', description: 'Bulk-import a notes directory (or .zip with text/.docx/text-PDF conversion): per-file local-LLM extraction → account resolution → meetings, with parked/triage fallback' },
      { name: 'calendar-import', description: 'Ingest a day of Google Calendar events (forwarded via tunnel): domain-classify attendees → contacts + account, one meeting per non-declined event' },
      { name: 'krisp-webhook', description: 'Receive Krisp webhook deliveries (notes / transcript / outline) and import the notes: time-match the existing meeting and append, or park a new meeting for review' },
      { name: 'merge', description: 'Generic merge of two same-type records (currently meetings): preview a plan, then apply selected fields/relations; the source is tombstoned (soft-deleted)' },
      { name: 'backup', description: 'Database backup configuration, pg_dump scheduling, list/restore/download' },
      { name: 'provisioning', description: 'Homelab/cloud infrastructure broker — deployments, resources, async lifecycle jobs, and encrypted secrets (Terraform + PAN-OS/AWS)' },
      { name: 'themes', description: 'GUI themes — built-in palettes plus per-user custom themes and the active-theme pointer' },
      { name: 'memories', description: 'Per-user long-lived preferences/rules/facts injected into the agent\'s system prompt at session start' },
      { name: 'health', description: 'Health check' },
    ],
  },
});

await fastify.register(swaggerUi, { routePrefix: '/docs' });

// Attach the current user's id to each request. Stubbed to the default user until
// real auth (magic link → session cookie) lands.
fastify.addHook('preHandler', async (request) => {
  request.userId = await getCurrentUserId(request);
});

// All API routes live under /api so the SPA can own bare paths like
// /accounts/:slug without colliding with /accounts/:id (integer-validated).
await fastify.register(async (api) => {
  await api.register(accountRoutes, { accountsService });
  await api.register(contactRoutes, { contactsService, accountsService, contactEnrichmentService });
  await api.register(meetingRoutes, { meetingsService, accountsService, contactEnrichmentService });
  await api.register(searchRoutes, { searchService });
  if (todoistEnabled) await api.register(todoistRoutes, { todoistService: todoistService! });
  await api.register(exportRoutes, { exportService });
  await api.register(outreachRoutes, { outreachService });
  await api.register(eventRoutes, { eventsService });
  await api.register(opportunityRoutes, { opportunitiesService, accountsService });
  await api.register(productRoutes, { productsService });
  await api.register(productCategoryRoutes, { productCategoriesService });
  await api.register(vendorRoutes, { vendorsService });
  await api.register(vendorProductRoutes, { vendorProductsService });
  await api.register(accountDetailsRoutes, { accountDetailsService, vendorHeatmapService });
  await api.register(orgChartRoutes, { orgChartService });
  await api.register(importExportRoutes, { importExportService });
  await api.register(notesImportRoutes, { notesImportService });
  await api.register(calendarImportRoutes, { calendarImportService });
  await api.register(krispWebhookRoutes, { krispWebhookService });
  await api.register(mergeRoutes, { mergeService });
  await api.register(noteRoutes, { notesService });
  await api.register(backupRoutes, { backupService });
  await api.register(provisioningRoutes, { provisioningService });
  await api.register(internalDomainRoutes, { internalDomainsService });
  await api.register(themeRoutes, { themesService });
  await api.register(memoryRoutes, { memoriesService });
  await api.register(threadRoutes, { threadsService });
  await api.register(newsRoutes, { newsService });
  await api.register(healthRoutes);
  await api.register(agentRoutes, { agentSettingsService, memoriesService });
}, { prefix: '/api' });

// Serve SolidJS GUI from public/ directory
const publicDir = path.resolve(import.meta.dirname, '..', 'public');
try {
  await fastify.register(fastifyStatic, {
    root: publicDir,
    prefix: '/',
    wildcard: false,
  });

  fastify.setNotFoundHandler(async (request, reply) => {
    if (request.url.startsWith('/api') || request.url.startsWith('/docs')) {
      reply.code(404);
      return { error: 'Not found' };
    }
    return reply.sendFile('index.html');
  });
} catch {
  logger.warn('No public/ directory found — GUI not served. Run "cd gui && npm run build" to build it.');
}

// Graceful shutdown
async function shutdown() {
  await scheduler.stop().catch(() => {});
  await provisioningWorker.stop().catch(() => {});
  await closeDb().catch(() => {});
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Startup stats
const pool = getPool();
const stats = await pool.query('SELECT COUNT(*)::int AS c FROM accounts');
logger.info({ accountCount: stats.rows[0].c }, 'Loaded accounts from database');

// Seed the shipped deployment config (idempotent) and start the provisioning job
// worker. Seeding is best-effort so a config issue never blocks API startup; set
// PROVISIONING_SEED_ON_BOOT=false to skip (e.g. once deployments are GUI-managed).
if (process.env.PROVISIONING_SEED_ON_BOOT !== 'false') {
  try {
    const seeded = await provisioningService.seed();
    logger.info(seeded, 'Seeded provisioning config from code modules');
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'Provisioning config seed failed (continuing)');
  }
}

// Local-dev bootstrap: copy the broker's deployment secrets from .env into the
// encrypted provisioning_secrets table (seed-if-absent). Production manages these as
// encrypted rows via the GUI/API — set PROVISIONING_SEED_SECRETS_ON_BOOT=false there.
// No-op without PROVISIONING_SECRETS_KEY; best-effort so it never blocks startup.
if (process.env.PROVISIONING_SEED_SECRETS_ON_BOOT !== 'false') {
  try {
    const secretSeed = await provisioningService.seedSecretsFromEnv({
      overwrite: process.env.PROVISIONING_SECRETS_SEED_OVERWRITE === 'true',
    });
    if (!secretSeed.keyConfigured) {
      logger.info('Skipped provisioning secret seed — PROVISIONING_SECRETS_KEY not set');
    } else {
      logger.info(
        { seeded: secretSeed.seeded, present: secretSeed.skipped.length, absent: secretSeed.absent.length },
        'Seeded provisioning secrets from .env',
      );
    }
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'Provisioning secret seed failed (continuing)');
  }
}

await provisioningWorker.start();

// Start the recurring-task scheduler (set SCHEDULER_ENABLED=false to disable,
// e.g. in the API test harness so it never fires network/LLM work under test).
if (process.env.SCHEDULER_ENABLED !== 'false') {
  await scheduler.start();
}

await fastify.listen({ port: config.port, host: config.host });
