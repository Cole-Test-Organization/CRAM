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

import { AccountsService } from '../services/accounts/accounts.js';
import { ContactsService } from '../services/contacts/contacts.js';
import { MeetingsService } from '../services/meetings/meetings.js';
import { SearchService } from '../services/search/search.js';
import { TodoistService } from '../services/todoist/todoist.js';
import { ExportService } from '../services/export/export.js';
import { OutreachService } from '../services/outreach/outreach.js';
import { EventsService } from '../services/events/events.js';
import { OpportunitiesService } from '../services/opportunities/opportunities.js';
import { ProductsService } from '../services/products/products.js';
import { ProductCategoriesService } from '../services/products/product-categories.js';
import { VendorsService } from '../services/vendors/vendors.js';
import { VendorProductsService } from '../services/vendors/vendor-products.js';
import { AccountDetailsService } from '../services/accounts/account-details.js';
import { VendorHeatmapService } from '../services/accounts/vendor-heatmap.js';
import { ImportExportService } from '../services/import-export/import-export.js';
import { NotesImportService } from '../services/notes/notes-import.js';
import { NotesService } from '../services/notes/notes.js';
import { BackupService } from '../services/backup/backup.js';
import { ContactEnrichmentService } from '../services/contacts/contact-enrichment.js';
import { InternalDomainsService } from '../services/internal-domains/internal-domains.js';
import { AgentSettingsService } from '../services/agent/agent-settings.js';
import { MemoriesService } from '../services/memories/memories.js';
import { ThreadsService } from '../services/threads/threads.js';
import { ProvisioningService } from '../services/provisioning/index.js';

import { registerTools } from '../mcp/tools.js';
import type { Services } from '../mcp/tools.js';
import { buildAgentMarkdown } from '../instructions.js';
import { getDefaultUserId } from '../auth.js';

export async function buildMcpSession({ userId }: { userId?: number } = {}) {
  const todoistEnabled = process.env.TODOIST_ENABLED !== 'false';
  // Resolve the pinned user up front — ProvisioningService needs it at construction
  // (its repos are user-scoped). Until per-session auth lands every call resolves to
  // the default user; mirrors api/src/mcp/server.ts.
  const resolvedUserId = userId ?? await getDefaultUserId();
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
  const services: Services = {
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
    threadsService: new ThreadsService(),
    // Enqueues/reads only — the api process (src/index.ts) runs the single job worker.
    provisioningService: new ProvisioningService({ userId: resolvedUserId }),
  };

  // Every call resolves to the default user (resolved above) — mirrors
  // api/src/mcp/server.ts. When real auth arrives, swap this for a request-scoped
  // resolver (likely via AsyncLocalStorage).
  const resolveUserId = () => resolvedUserId;

  // Fetch the user's enabled memories so they're baked into the instructions
  // delivered in the MCP initialize handshake. Best-effort: if the lookup
  // fails (e.g. before the migration has run), we still serve the doc without
  // memories rather than crashing the agent turn.
  let memories: any[] = [];
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

  // `services` is returned so callers (the agent loop's @-mention resolver) can
  // reuse these exact, dependency-wired instances instead of re-instantiating —
  // same RLS, same construction order.
  return { client, server, instructions, services };
}
