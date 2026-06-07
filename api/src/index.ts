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
import { ImportExportService } from './services/import-export/import-export.js';
import { NotesImportService } from './services/notes/notes-import.js';
import { CalendarImportService } from './services/calendar-import/calendar-import.js';
import { NotesService } from './services/notes/notes.js';
import { BackupService } from './services/backup/backup.js';
import { ContactEnrichmentService } from './services/contacts/contact-enrichment.js';
import { InternalDomainsService } from './services/internal-domains/internal-domains.js';
import { AgentSettingsService } from './services/agent/agent-settings.js';
import { ThemesService } from './services/themes/themes.js';
import { MemoriesService } from './services/memories/memories.js';
import { ThreadsService } from './services/threads/threads.js';

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
import importExportRoutes from './routes/import-export/import-export.js';
import notesImportRoutes from './routes/notes/notes-import.js';
import calendarImportRoutes from './routes/calendar-import/calendar-import.js';
import noteRoutes from './routes/notes/notes.js';
import backupRoutes from './routes/backup/backup.js';
import internalDomainRoutes from './routes/internal-domains/internal-domains.js';
import themeRoutes from './routes/themes/themes.js';
import memoryRoutes from './routes/memories/memories.js';
import threadRoutes from './routes/threads/threads.js';

const config = getConfig();
const todoistEnabled = process.env.TODOIST_ENABLED !== 'false';
const fastify = Fastify({ loggerInstance: logger });

// Verify DB connection
await initDb();
logger.info('Database connection verified');

// Warm the default-user cache so the first request doesn't pay for the lookup.
await getDefaultUserId();

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
const importExportService = new ImportExportService({ contactsService, accountsService });
const notesImportService = new NotesImportService({ meetingsService, accountsService, agentSettingsService });
const calendarImportService = new CalendarImportService({ meetingsService, accountsService, contactsService, internalDomainsService });
const notesService = new NotesService();
const backupService = new BackupService();
const themesService = new ThemesService();
const memoriesService = new MemoriesService();
const threadsService = new ThreadsService();

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
      { name: 'notes', description: 'Timestamped markdown notes attached to an account, contact, or opportunity' },
      { name: 'threads', description: 'Open workstreams per account, each with tasks (assignee + due date) and a contact pool' },
      { name: 'export', description: 'Markdown export' },
      { name: 'import-export', description: 'Portable JSON bundles for moving accounts between tenants' },
      { name: 'notes-import', description: 'Bulk-import a notes directory (or .zip): per-file local-LLM extraction → account resolution → meetings, with parked/triage fallback' },
      { name: 'calendar-import', description: 'Ingest a day of Google Calendar events (forwarded via tunnel): domain-classify attendees → contacts + account, one meeting per non-declined event' },
      { name: 'backup', description: 'Database backup configuration, pg_dump scheduling, list/restore/download' },
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
  await api.register(importExportRoutes, { importExportService });
  await api.register(notesImportRoutes, { notesImportService });
  await api.register(calendarImportRoutes, { calendarImportService });
  await api.register(noteRoutes, { notesService });
  await api.register(backupRoutes, { backupService });
  await api.register(internalDomainRoutes, { internalDomainsService });
  await api.register(themeRoutes, { themesService });
  await api.register(memoryRoutes, { memoriesService });
  await api.register(threadRoutes, { threadsService });
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
  await closeDb().catch(() => {});
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Startup stats
const pool = getPool();
const stats = await pool.query('SELECT COUNT(*)::int AS c FROM accounts');
logger.info({ accountCount: stats.rows[0].c }, 'Loaded accounts from database');

await fastify.listen({ port: config.port, host: config.host });
