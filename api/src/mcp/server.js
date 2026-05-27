import { randomUUID } from 'crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';
import { initDb, closeDb } from '../db/connection.js';
import { getDefaultUserId } from '../auth.js';

import { AccountsService } from '../services/accounts.js';
import { ContactsService } from '../services/contacts.js';
import { MeetingsService } from '../services/meetings.js';
import { SearchService } from '../services/search.js';
import { TodoistService } from '../services/todoist.js';
import { ExportService } from '../services/export.js';
import { OutreachService } from '../services/outreach.js';
import { EventsService } from '../services/events.js';
import { OpportunitiesService } from '../services/opportunities.js';
import { ProductsService } from '../services/products.js';
import { ProductCategoriesService } from '../services/productCategories.js';
import { VendorsService } from '../services/vendors.js';
import { VendorProductsService } from '../services/vendor-products.js';
import { AccountDetailsService } from '../services/account-details.js';
import { VendorHeatmapService } from '../services/vendor-heatmap.js';
import { ImportExportService } from '../services/import-export.js';
import { NotesService } from '../services/notes.js';
import { BackupService } from '../services/backup.js';
import { ContactEnrichmentService } from '../services/contact-enrichment.js';
import { InternalDomainsService } from '../services/internal-domains.js';
import { AgentSettingsService } from '../services/agent-settings.js';
import { MemoriesService } from '../services/memories.js';

import { registerTools } from './tools.js';
import { buildAgentMarkdown } from '../instructions.js';
import { createLogger } from '../lib/logger.js';

const logger = createLogger({ service: 'mcp' });

// Verify DB connection
await initDb();

// Warm the default-user cache. Until per-session auth lands, every MCP tool call
// operates as this user.
const defaultUserId = await getDefaultUserId();

const todoistEnabled = process.env.TODOIST_ENABLED !== 'false';
const vendorsService = new VendorsService();
const accountsService = new AccountsService();
const contactsService = new ContactsService();
const outreachService = new OutreachService();
const agentSettingsService = new AgentSettingsService();
const contactEnrichmentService = new ContactEnrichmentService({
  outreachService,
  contactsService,
  agentSettingsService,
});
const internalDomainsService = new InternalDomainsService();
const memoriesService = new MemoriesService();
const services = {
  accountsService,
  contactsService,
  meetingsService: new MeetingsService({
    contactsService,
    accountsService,
    contactEnrichmentService,
    internalDomainsService,
  }),
  searchService: new SearchService(),
  todoistService: todoistEnabled ? new TodoistService() : null,
  exportService: new ExportService(),
  outreachService,
  eventsService: new EventsService(),
  opportunitiesService: new OpportunitiesService(),
  productsService: new ProductsService(),
  productCategoriesService: new ProductCategoriesService(),
  vendorsService,
  vendorProductsService: new VendorProductsService({ vendorsService }),
  accountDetailsService: new AccountDetailsService(),
  vendorHeatmapService: new VendorHeatmapService(),
  importExportService: new ImportExportService({ contactsService, accountsService }),
  notesService: new NotesService(),
  backupService: new BackupService(),
  contactEnrichmentService,
  internalDomainsService,
  agentSettingsService,
  memoriesService,
};

const PORT = parseInt(process.env.MCP_PORT || '3100', 10);
const HOST = process.env.MCP_HOST || '0.0.0.0';

const sessions = new Map();

const baseUrl = process.env.API_BASE_URL || 'http://localhost';

// Instructions are rendered per session so newly saved user memories surface
// on the next client reconnect without restarting the process. The memory
// lookup runs under RLS for the resolved user.
async function createSessionServer() {
  let memories = [];
  try {
    memories = await memoriesService.listEnabledForInjection(defaultUserId);
  } catch {
    memories = [];
  }
  const instructions = buildAgentMarkdown({ baseUrl, mode: 'mcp', memories });
  const server = new McpServer(
    { name: 'crm', version: '2.0.0' },
    { instructions }
  );
  registerTools(server, services, () => defaultUserId);
  return server;
}

const app = express();
app.use(express.json());

app.post('/mcp', async (req, res) => {
  const sessionId = req.headers['mcp-session-id'];

  if (sessionId && sessions.has(sessionId)) {
    const transport = sessions.get(sessionId);
    await transport.handleRequest(req, res, req.body);
    return;
  }

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    // The session ID isn't known until handleRequest processes the initialize
    // request. Register the transport in the session map from this callback so
    // subsequent requests can look it up.
    onsessioninitialized: (sessionId) => {
      sessions.set(sessionId, transport);
    },
  });

  transport.onclose = () => {
    if (transport.sessionId) sessions.delete(transport.sessionId);
  };

  const server = await createSessionServer();
  await server.connect(transport);

  await transport.handleRequest(req, res, req.body);
});

app.get('/mcp', async (req, res) => {
  const sessionId = req.headers['mcp-session-id'];
  if (sessionId && sessions.has(sessionId)) {
    await sessions.get(sessionId).handleRequest(req, res);
    return;
  }
  res.status(400).json({ error: 'Invalid or missing session ID' });
});

app.delete('/mcp', async (req, res) => {
  const sessionId = req.headers['mcp-session-id'];
  if (sessionId && sessions.has(sessionId)) {
    const transport = sessions.get(sessionId);
    await transport.close();
    sessions.delete(sessionId);
  }
  res.status(200).end();
});

app.listen(PORT, HOST, () => {
  logger.info({ host: HOST, port: PORT }, 'MCP server listening');
});

// Graceful shutdown
async function shutdown() {
  for (const transport of sessions.values()) {
    transport.close().catch(() => {});
  }
  sessions.clear();
  await closeDb().catch(() => {});
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
