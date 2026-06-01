// In-process MCP client paired to a fresh McpServer via in-memory transport.
// Same protocol surface as the external (network) MCP server in api/src/mcp/,
// just with zero serialization/network overhead.
//
// Built fresh per agent turn — services are stateless, the transport is
// in-memory (cheap), and rebuilding lets the rendered `instructions` string
// pick up newly saved user memories without a process restart. The previous
// module-level cache froze instructions at first call.

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

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
import { NotesImportService } from '../services/notes-import.js';
import { NotesService } from '../services/notes.js';
import { BackupService } from '../services/backup.js';
import { ContactEnrichmentService } from '../services/contact-enrichment.js';
import { InternalDomainsService } from '../services/internal-domains.js';
import { AgentSettingsService } from '../services/agent-settings.js';
import { MemoriesService } from '../services/memories.js';

import { registerTools } from '../mcp/tools.js';
import { buildAgentMarkdown } from '../instructions.js';
import { getDefaultUserId } from '../auth.js';

export async function buildMcpSession({ userId } = {}) {
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
  // Lifted out of the services literal so notesImportService can depend on it.
  const meetingsService = new MeetingsService({
    contactsService,
    accountsService,
    contactEnrichmentService,
    internalDomainsService,
  });
  // ContactsService owns the from-emails staging methods (resolveEmails,
  // importFromEmails), which need these three deps. They can't be constructor
  // args — contactEnrichmentService depends on contactsService, so passing them
  // in would be a construction-order cycle. Wire them on after the fact.
  contactsService.accountsService = accountsService;
  contactsService.internalDomainsService = internalDomainsService;
  contactsService.contactEnrichmentService = contactEnrichmentService;
  const services = {
    accountsService,
    contactsService,
    meetingsService,
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
    notesImportService: new NotesImportService({ meetingsService, accountsService, agentSettingsService }),
    notesService: new NotesService(),
    backupService: new BackupService(),
    contactEnrichmentService,
    internalDomainsService,
    agentSettingsService,
    memoriesService,
  };

  // Until per-session auth lands, every call resolves to the default user —
  // mirrors api/src/mcp/server.js. When real auth arrives, swap this for a
  // request-scoped resolver (likely via AsyncLocalStorage).
  const resolvedUserId = userId ?? await getDefaultUserId();
  const resolveUserId = () => resolvedUserId;

  // Fetch the user's enabled memories so they're baked into the instructions
  // delivered in the MCP initialize handshake. Best-effort: if the lookup
  // fails (e.g. before the migration has run), we still serve the doc without
  // memories rather than crashing the agent turn.
  let memories = [];
  try {
    memories = await memoriesService.listEnabledForInjection(resolvedUserId);
  } catch {
    memories = [];
  }

  const instructions = buildAgentMarkdown({
    baseUrl: process.env.API_BASE_URL || 'http://localhost',
    mode: 'mcp',
    memories,
  });

  const server = new McpServer(
    { name: 'crm-internal', version: '2.0.0' },
    { instructions }
  );
  registerTools(server, services, resolveUserId);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const client = new Client({ name: 'crm-agent', version: '2.0.0' });
  await client.connect(clientTransport);

  return { client, server, instructions };
}
