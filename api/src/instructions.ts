/**
 * Shared agent instructions used by /api/agent (HTTP) and sent to MCP clients
 * in the initialize handshake (InitializeResult.instructions). Renders the same
 * workflow/decision guidance in either endpoint syntax or tool-call syntax
 * based on `mode`.
 *
 * Every API change should be reflected here. The REFS map below is the single
 * place to update endpoint↔tool mappings.
 */

type McpRef = { tool: string; action?: string; note?: string };
type OpRef = { http: string; mcp: McpRef | null };

const REFS: Record<string, OpRef> = {
  // accounts
  'accounts.list':         { http: 'GET /api/accounts/slugs',                   mcp: { tool: 'accounts', action: 'list' } },
  'accounts.list_full':    { http: 'GET /api/accounts',                         mcp: { tool: 'accounts', action: 'list_full' } },
  'accounts.search':       { http: 'GET /api/accounts/search?q=',               mcp: { tool: 'search', note: "type: 'accounts'" } },
  'accounts.get_by_slug':  { http: 'GET /api/accounts/by-slug/:slug',           mcp: { tool: 'accounts', action: 'get', note: 'with slug' } },
  'accounts.get_by_domain': { http: 'GET /api/accounts/by-domain/:domain',      mcp: { tool: 'accounts', action: 'get', note: 'with domain' } },
  'accounts.get':          { http: 'GET /api/accounts/:id',                     mcp: { tool: 'accounts', action: 'get' } },
  'accounts.find_existing': { http: 'POST /api/accounts/find-existing',          mcp: { tool: 'accounts', action: 'find_existing' } },
  'accounts.find_or_create': { http: 'POST /api/accounts/find-or-create',         mcp: { tool: 'accounts', action: 'find_or_create' } },
  'accounts.create':       { http: 'POST /api/accounts',                        mcp: { tool: 'accounts', action: 'create' } },
  'accounts.update':       { http: 'PATCH /api/accounts/:id',                   mcp: { tool: 'accounts', action: 'update' } },
  'accounts.put':          { http: 'PUT /api/accounts/:id',                     mcp: null },
  'accounts.delete':       { http: 'DELETE /api/accounts/:id',                  mcp: { tool: 'accounts', action: 'delete' } },
  'accounts.list_partners':  { http: 'GET /api/accounts/:id/partners',                       mcp: { tool: 'accounts', action: 'list_partners' } },
  'accounts.add_partner':    { http: 'POST /api/accounts/:id/partners/:partnerId',           mcp: { tool: 'accounts', action: 'add_partner' } },
  'accounts.remove_partner': { http: 'DELETE /api/accounts/:id/partners/:partnerId',         mcp: { tool: 'accounts', action: 'remove_partner' } },

  // contacts
  'contacts.list':                 { http: 'GET /api/contacts',                                 mcp: { tool: 'contacts', action: 'list' } },
  'contacts.companies':            { http: 'GET /api/contacts/companies',                       mcp: null },
  'contacts.attendee_options':     { http: 'GET /api/contacts/attendee-options?mode=&account_id=', mcp: { tool: 'contacts', action: 'attendee_options' } },
  'contacts.get':                  { http: 'GET /api/contacts/:id',                             mcp: { tool: 'contacts', action: 'get' } },
  'contacts.get_by_email':         { http: 'GET /api/contacts/by-email/:email',                 mcp: { tool: 'contacts', action: 'get_by_email' } },
  'contacts.find_existing':        { http: 'POST /api/contacts/find-existing',                  mcp: { tool: 'contacts', action: 'find_existing' } },
  'contacts.by_account':           { http: 'GET /api/accounts/:accountId/contacts',             mcp: { tool: 'contacts', action: 'list', note: 'with company filter' } },
  'contacts.create_for_account':   { http: 'POST /api/accounts/:accountId/contacts',            mcp: { tool: 'contacts', action: 'create', note: 'with account_id' } },
  'contacts.create_standalone':    { http: 'POST /api/contacts',                                mcp: { tool: 'contacts', action: 'create' } },
  'contacts.find_or_create':       { http: 'POST /api/contacts/find-or-create',                 mcp: { tool: 'contacts', action: 'find_or_create' } },
  'contacts.link':                 { http: 'POST /api/contacts/:id/accounts/:accountId',        mcp: { tool: 'contacts', action: 'link_account' } },
  'contacts.unlink':               { http: 'DELETE /api/contacts/:id/accounts/:accountId',      mcp: { tool: 'contacts', action: 'unlink_account' } },
  'contacts.reassign':             { http: 'POST /api/contacts/:id/reassign-account',           mcp: { tool: 'contacts', action: 'reassign_account' } },
  'contacts.patch':                { http: 'PATCH /api/contacts/:id',                           mcp: { tool: 'contacts', action: 'update' } },
  'contacts.put':                  { http: 'PUT /api/contacts/:id',                             mcp: null },
  'contacts.delete':               { http: 'DELETE /api/contacts/:id',                          mcp: { tool: 'contacts', action: 'delete' } },
  'contacts.research':             { http: 'POST /api/contacts/:id/research',                   mcp: { tool: 'contacts', action: 'research' } },
  'contacts.get_enrichment_job':   { http: 'GET /api/contacts/enrichment-jobs/:jobId',          mcp: { tool: 'contacts', action: 'get_enrichment_job' } },
  'contacts.list_enrichment_jobs': { http: 'GET /api/contacts/:id/enrichment-jobs',             mcp: { tool: 'contacts', action: 'list_enrichment_jobs' } },
  'contacts.resolve_emails':       { http: 'POST /api/contacts/resolve-emails',                 mcp: { tool: 'contacts', action: 'resolve_emails' } },
  'contacts.import_from_emails':   { http: 'POST /api/contacts/from-emails',                    mcp: { tool: 'contacts', action: 'import_from_emails' } },

  // meetings (external + internal — internal=true means no account)
  'meetings.list':        { http: 'GET /api/meetings',                           mcp: { tool: 'meetings', action: 'list' } },
  'meetings.by_account':  { http: 'GET /api/accounts/:accountId/meetings',       mcp: { tool: 'meetings', action: 'list', note: 'with account_id' } },
  'meetings.get':         { http: 'GET /api/meetings/:id',                       mcp: { tool: 'meetings', action: 'get' } },
  'meetings.create':      { http: 'POST /api/meetings',                          mcp: { tool: 'meetings', action: 'create' } },
  'meetings.update':      { http: 'PUT /api/meetings/:id',                       mcp: { tool: 'meetings', action: 'update' } },
  'meetings.assign_account': { http: 'POST /api/meetings/:id/assign-account',                mcp: { tool: 'meetings', action: 'assign_account' } },
  'meetings.reassign_account': { http: 'POST /api/meetings/:id/reassign-account',            mcp: { tool: 'meetings', action: 'reassign_account' } },
  'meetings.link_attendee':  { http: 'POST /api/meetings/:id/attendees/:attendeeId/link',   mcp: { tool: 'meetings', action: 'link_attendee' } },
  'meetings.delete':      { http: 'DELETE /api/meetings/:id',                    mcp: { tool: 'meetings', action: 'delete' } },
  'meetings.create_from_emails':   { http: 'POST /api/meetings/from-emails',               mcp: { tool: 'meetings', action: 'create_from_emails' } },
  'meetings.get_enrichment_job':   { http: 'GET /api/meetings/enrichment-jobs/:jobId',     mcp: { tool: 'meetings', action: 'get_enrichment_job' } },
  'meetings.list_enrichment_jobs': { http: 'GET /api/meetings/:id/enrichment-jobs',        mcp: { tool: 'meetings', action: 'list_enrichment_jobs' } },
  'merge.preview':        { http: 'POST /api/merge/:entity/preview',             mcp: { tool: 'merge', action: 'preview' } },
  'merge.apply':          { http: 'POST /api/merge/:entity',                     mcp: { tool: 'merge', action: 'apply' } },

  // search
  'search.all': { http: 'GET /api/search?q=&type=', mcp: { tool: 'search', note: "type: 'all' | 'accounts' (customers + partners) | 'contacts' | 'meetings' | 'opportunities'" } },

  // todoist
  'todoist.create':        { http: 'POST /api/todoist/tasks',             mcp: { tool: 'todoist_tasks', action: 'create' } },
  'todoist.create_batch':  { http: 'POST /api/todoist/tasks/batch',       mcp: { tool: 'todoist_tasks', action: 'create_batch' } },
  'todoist.list':          { http: 'GET /api/todoist/tasks',              mcp: { tool: 'todoist_tasks', action: 'list' } },
  'todoist.close':         { http: 'POST /api/todoist/tasks/:id/close',   mcp: { tool: 'todoist_tasks', action: 'close' } },

  // export
  'export.account':  { http: 'GET /api/export/accounts/:slug',  mcp: { tool: 'export_markdown' } },
  'export.all':      { http: 'GET /api/export/all',             mcp: null },

  // import / export — portable JSON for cross-tenant moves
  'import_export.export':         { http: 'POST /api/import-export/export',          mcp: { tool: 'import_export', action: 'export' } },
  'import_export.export_account': { http: 'GET /api/import-export/accounts/:slug',   mcp: { tool: 'import_export', action: 'export', note: 'with single slug' } },
  'import_export.import':         { http: 'POST /api/import-export/import',          mcp: { tool: 'import_export', action: 'import' } },

  // notes import — bulk-ingest a directory/zip of notes via per-file local-LLM extraction
  'notes_import.enqueue':    { http: 'POST /api/notes-import',                  mcp: { tool: 'notes_import', action: 'enqueue' } },
  'notes_import.upload_zip': { http: 'POST /api/notes-import/upload-zip',       mcp: null },
  'notes_import.get_job':    { http: 'GET /api/notes-import/jobs/:jobId',       mcp: { tool: 'notes_import', action: 'get_job' } },
  'notes_import.list_jobs':  { http: 'GET /api/notes-import/jobs',              mcp: { tool: 'notes_import', action: 'list_jobs' } },

  // outreach (async enrichment)
  'outreach.enqueue':    { http: 'POST /api/outreach/enrich',              mcp: { tool: 'outreach', action: 'enqueue' } },
  'outreach.get_job':    { http: 'GET /api/outreach/enrich/:jobId',        mcp: { tool: 'outreach', action: 'get_job' } },
  'outreach.list_jobs':  { http: 'GET /api/outreach/enrich',               mcp: { tool: 'outreach', action: 'list_jobs' } },
  'outreach.stats':      { http: 'GET /api/outreach/stats',                mcp: { tool: 'outreach', action: 'stats' } },

  // events (public scraped calendar + per-user contact matching)
  'events.list':                       { http: 'GET /api/events',                              mcp: { tool: 'events', action: 'list' } },
  'events.facets':                     { http: 'GET /api/events/facets',                       mcp: { tool: 'events', action: 'facets' } },
  'events.get':                        { http: 'GET /api/events/:id',                          mcp: { tool: 'events', action: 'get' } },
  'events.upcoming_with_contacts':     { http: 'GET /api/events/upcoming/with-contacts',       mcp: { tool: 'events', action: 'upcoming_with_contacts' } },
  'events.upsert':                     { http: 'POST /api/events',                             mcp: { tool: 'events', action: 'upsert' } },
  'events.delete':                     { http: 'DELETE /api/events/:id',                       mcp: { tool: 'events', action: 'delete' } },

  // opportunities (sales deals tied to non-partner accounts)
  'opportunities.list':           { http: 'GET /api/opportunities',                              mcp: { tool: 'opportunities', action: 'list' } },
  'opportunities.by_account':     { http: 'GET /api/accounts/:accountId/opportunities',          mcp: { tool: 'opportunities', action: 'list', note: 'with account_id' } },
  'opportunities.get':            { http: 'GET /api/opportunities/:id',                          mcp: { tool: 'opportunities', action: 'get' } },
  'opportunities.create':         { http: 'POST /api/opportunities',                             mcp: { tool: 'opportunities', action: 'create' } },
  'opportunities.update':         { http: 'PATCH /api/opportunities/:id',                        mcp: { tool: 'opportunities', action: 'update' } },
  'opportunities.delete':         { http: 'DELETE /api/opportunities/:id',                       mcp: { tool: 'opportunities', action: 'delete' } },
  'opportunities.link_product':   { http: 'POST /api/opportunities/:id/products/:productId',     mcp: { tool: 'opportunities', action: 'link_product' } },
  'opportunities.unlink_product': { http: 'DELETE /api/opportunities/:id/products/:productId',   mcp: { tool: 'opportunities', action: 'unlink_product' } },

  // products (per-user product catalog)
  'products.list':   { http: 'GET /api/products',          mcp: { tool: 'products', action: 'list' } },
  'products.get':    { http: 'GET /api/products/:id',      mcp: { tool: 'products', action: 'get' } },
  'products.create': { http: 'POST /api/products',         mcp: { tool: 'products', action: 'create' } },
  'products.update': { http: 'PATCH /api/products/:id',    mcp: { tool: 'products', action: 'update' } },
  'products.delete': { http: 'DELETE /api/products/:id',   mcp: { tool: 'products', action: 'delete' } },

  // product_categories (user-managed groupings for products)
  'product_categories.list':   { http: 'GET /api/product-categories',          mcp: { tool: 'product_categories', action: 'list' } },
  'product_categories.get':    { http: 'GET /api/product-categories/:id',      mcp: { tool: 'product_categories', action: 'get' } },
  'product_categories.create': { http: 'POST /api/product-categories',         mcp: { tool: 'product_categories', action: 'create' } },
  'product_categories.update': { http: 'PATCH /api/product-categories/:id',    mcp: { tool: 'product_categories', action: 'update' } },
  'product_categories.delete': { http: 'DELETE /api/product-categories/:id',   mcp: { tool: 'product_categories', action: 'delete' } },

  // vendors (global catalog of vendor companies)
  'vendors.list':            { http: 'GET /api/vendors',                          mcp: { tool: 'vendors', action: 'list' } },
  'vendors.get':             { http: 'GET /api/vendors/:id',                      mcp: { tool: 'vendors', action: 'get' } },
  'vendors.find_or_create':  { http: 'POST /api/vendors/find-or-create',          mcp: { tool: 'vendors', action: 'find_or_create' } },
  'vendors.update':          { http: 'PATCH /api/vendors/:id',                    mcp: { tool: 'vendors', action: 'update' } },
  'vendors.delete':          { http: 'DELETE /api/vendors/:id',                   mcp: { tool: 'vendors', action: 'delete' } },
  'vendors.restore':         { http: 'POST /api/vendors/:id/restore',             mcp: { tool: 'vendors', action: 'restore' } },

  // vendor_products (global catalog of products under vendors — referenced by account_details *_ids arrays)
  'vendor_products.list':           { http: 'GET /api/vendor-products',                          mcp: { tool: 'vendor_products', action: 'list' } },
  'vendor_products.get':            { http: 'GET /api/vendor-products/:id',                      mcp: { tool: 'vendor_products', action: 'get' } },
  'vendor_products.find_or_create': { http: 'POST /api/vendor-products/find-or-create',          mcp: { tool: 'vendor_products', action: 'find_or_create' } },
  'vendor_products.update':         { http: 'PATCH /api/vendor-products/:id',                    mcp: { tool: 'vendor_products', action: 'update' } },
  'vendor_products.delete':         { http: 'DELETE /api/vendor-products/:id',                   mcp: { tool: 'vendor_products', action: 'delete' } },
  'vendor_products.restore':        { http: 'POST /api/vendor-products/:id/restore',             mcp: { tool: 'vendor_products', action: 'restore' } },
  'vendor_products.merge':          { http: 'POST /api/vendor-products/merge',                   mcp: { tool: 'vendor_products', action: 'merge' } },

  // account_details (typed technical profile per account — replaces the old environment JSONB)
  'account_details.get':    { http: 'GET /api/accounts/:accountId/details',     mcp: { tool: 'account_details', action: 'get' } },
  'account_details.update': { http: 'PATCH /api/accounts/:accountId/details',   mcp: { tool: 'account_details', action: 'update' } },
  'account_details.delete': { http: 'DELETE /api/accounts/:accountId/details',  mcp: { tool: 'account_details', action: 'delete' } },
  'account_details.vendor_heatmap': { http: 'GET /api/accounts/:accountId/vendor-heatmap', mcp: { tool: 'account_details', action: 'vendor_heatmap' } },

  // notes (timestamped markdown blurbs attached to an account, contact, or opportunity)
  'notes.list':   { http: 'GET /api/notes?account_id=|contact_id=|opportunity_id=', mcp: { tool: 'notes', action: 'list' } },
  'notes.get':    { http: 'GET /api/notes/:id',                                     mcp: { tool: 'notes', action: 'get' } },
  'notes.create': { http: 'POST /api/notes',                                        mcp: { tool: 'notes', action: 'create' } },
  'notes.update': { http: 'PATCH /api/notes/:id',                                   mcp: { tool: 'notes', action: 'update' } },
  'notes.delete': { http: 'DELETE /api/notes/:id',                                  mcp: { tool: 'notes', action: 'delete' } },

  // threads + tasks (open workstreams per account, each with steps and an involved-people pool)
  'threads.list':           { http: 'GET /api/threads?account_id=',                 mcp: { tool: 'threads', action: 'list' } },
  'threads.get':            { http: 'GET /api/threads/:id',                         mcp: { tool: 'threads', action: 'get' } },
  'threads.create':         { http: 'POST /api/threads',                            mcp: { tool: 'threads', action: 'create' } },
  'threads.update':         { http: 'PATCH /api/threads/:id',                       mcp: { tool: 'threads', action: 'update' } },
  'threads.delete':         { http: 'DELETE /api/threads/:id',                      mcp: { tool: 'threads', action: 'delete' } },
  'threads.add_task':       { http: 'POST /api/threads/:id/tasks',                  mcp: { tool: 'threads', action: 'add_task' } },
  'threads.update_task':    { http: 'PATCH /api/threads/:id/tasks/:taskId',         mcp: { tool: 'threads', action: 'update_task' } },
  'threads.delete_task':    { http: 'DELETE /api/threads/:id/tasks/:taskId',        mcp: { tool: 'threads', action: 'delete_task' } },
  'threads.link_contact':   { http: 'POST /api/threads/:id/contacts',               mcp: { tool: 'threads', action: 'link_contact' } },
  'threads.unlink_contact': { http: 'DELETE /api/threads/:id/contacts/:contactId',  mcp: { tool: 'threads', action: 'unlink_contact' } },

  // backup (instance-wide pg_dump backups and admin)
  'backup.get_settings':    { http: 'GET /api/backup/settings',           mcp: { tool: 'backup', action: 'get_settings' } },
  'backup.update_settings': { http: 'PUT /api/backup/settings',           mcp: { tool: 'backup', action: 'update_settings' } },
  'backup.list':            { http: 'GET /api/backup',                    mcp: { tool: 'backup', action: 'list' } },
  'backup.run':             { http: 'POST /api/backup/run',               mcp: { tool: 'backup', action: 'run' } },
  'backup.import':          { http: 'POST /api/backup/import',            mcp: null },
  'backup.import_from_path':{ http: 'POST /api/backup/import-from-path',  mcp: { tool: 'backup', action: 'import_from_path' } },
  'backup.restore':         { http: 'POST /api/backup/restore',           mcp: { tool: 'backup', action: 'restore' } },
  'backup.download':        { http: 'GET /api/backup/download/:filename', mcp: null },
  'backup.delete':          { http: 'DELETE /api/backup/:filename',       mcp: { tool: 'backup', action: 'delete' } },

  // agent settings (per-user — provider, model, local LLM URL; replaces browser localStorage)
  'agent_settings.get':    { http: 'GET /api/agent/settings',    mcp: { tool: 'agent_settings', action: 'get' } },
  'agent_settings.update': { http: 'PATCH /api/agent/settings',  mcp: { tool: 'agent_settings', action: 'update' } },

  // internal domains (per-user — domains the user's own company owns)
  'internal_domains.list':   { http: 'GET /api/internal-domains',              mcp: { tool: 'internal_domains', action: 'list' } },
  'internal_domains.add':    { http: 'POST /api/internal-domains',             mcp: { tool: 'internal_domains', action: 'add' } },
  'internal_domains.remove': { http: 'DELETE /api/internal-domains/:domain',   mcp: { tool: 'internal_domains', action: 'remove' } },

  // memories (per-user — long-lived preferences/rules/facts injected into the agent's system prompt)
  'memories.list':   { http: 'GET /api/memories',          mcp: { tool: 'memories', action: 'list' } },
  'memories.get':    { http: 'GET /api/memories/:id',      mcp: { tool: 'memories', action: 'get' } },
  'memories.create': { http: 'POST /api/memories',         mcp: { tool: 'memories', action: 'create' } },
  'memories.update': { http: 'PATCH /api/memories/:id',    mcp: { tool: 'memories', action: 'update' } },
  'memories.delete': { http: 'DELETE /api/memories/:id',   mcp: { tool: 'memories', action: 'delete' } },

  // provisioning (homelab infrastructure broker — async lifecycle jobs)
  'provisioning.list_deployments': { http: 'GET /api/provisioning/deployments',                                   mcp: { tool: 'provisioning', action: 'list_deployments' } },
  'provisioning.get_deployment':   { http: 'GET /api/provisioning/deployments/:id',                               mcp: { tool: 'provisioning', action: 'get_deployment' } },
  'provisioning.list_resources':   { http: 'GET /api/provisioning/resources',                                     mcp: { tool: 'provisioning', action: 'list_resources' } },
  'provisioning.get_resource':     { http: 'GET /api/provisioning/resources/:id',                                 mcp: { tool: 'provisioning', action: 'get_resource' } },
  'provisioning.discover_proxmox': { http: 'GET /api/provisioning/providers/proxmox/discovery',                   mcp: { tool: 'provisioning', action: 'discover_proxmox' } },
  'provisioning.event_snapshot':   { http: 'GET /api/provisioning/events (SSE; first event is snapshot)',          mcp: { tool: 'provisioning', action: 'event_snapshot' } },
  'provisioning.power_state':      { http: 'GET /api/provisioning/resources/:id/power-state',                     mcp: { tool: 'provisioning', action: 'power_state' } },
  'provisioning.start':            { http: 'POST /api/provisioning/resources/:id/start',                          mcp: { tool: 'provisioning', action: 'start' } },
  'provisioning.stop':             { http: 'POST /api/provisioning/resources/:id/stop',                           mcp: { tool: 'provisioning', action: 'stop' } },
  'provisioning.list_tunnels':     { http: 'GET /api/provisioning/tunnels',                                       mcp: { tool: 'provisioning', action: 'list_tunnels' } },
  'provisioning.open_rdp_tunnel':  { http: 'POST /api/provisioning/resources/:id/rdp-tunnel',                    mcp: { tool: 'provisioning', action: 'open_rdp_tunnel' } },
  'provisioning.open_ssh_tunnel':  { http: 'POST /api/provisioning/resources/:id/ssh-tunnel',                    mcp: { tool: 'provisioning', action: 'open_ssh_tunnel' } },
  'provisioning.close_tunnel':     { http: 'DELETE /api/provisioning/tunnels/:id',                               mcp: { tool: 'provisioning', action: 'close_tunnel' } },
  'provisioning.deploy':           { http: 'POST /api/provisioning/deployments/:id/deploy',                       mcp: { tool: 'provisioning', action: 'deploy' } },
  'provisioning.deprovision':      { http: 'POST /api/provisioning/deployments/:id/deprovision',                  mcp: { tool: 'provisioning', action: 'deprovision' } },
  'provisioning.create_instance':  { http: 'POST /api/provisioning/deployments/:id/instances',                   mcp: { tool: 'provisioning', action: 'create_instance' } },
  'provisioning.delete_instance':  { http: 'DELETE /api/provisioning/deployments/:id',                            mcp: { tool: 'provisioning', action: 'delete_instance' } },
  'provisioning.up':               { http: 'POST /api/provisioning/deployments/:id/resources/:target/up',        mcp: { tool: 'provisioning', action: 'up' } },
  'provisioning.down':             { http: 'POST /api/provisioning/resources/:id/down',                           mcp: { tool: 'provisioning', action: 'down' } },
  'provisioning.run_action':       { http: 'POST /api/provisioning/deployments/:id/resources/:target/actions/:action', mcp: { tool: 'provisioning', action: 'run_action' } },
  'provisioning.list_jobs':        { http: 'GET /api/provisioning/jobs',                                          mcp: { tool: 'provisioning', action: 'list_jobs' } },
  'provisioning.get_job':          { http: 'GET /api/provisioning/jobs/:id',                                      mcp: { tool: 'provisioning', action: 'get_job' } },
  'provisioning.cancel_job':       { http: 'POST /api/provisioning/jobs/:id/cancel',                              mcp: { tool: 'provisioning', action: 'cancel_job' } },
  'provisioning.list_secrets':     { http: 'GET /api/provisioning/secrets',                                       mcp: { tool: 'provisioning', action: 'list_secrets' } },
  'provisioning.set_secret':       { http: 'PUT /api/provisioning/secrets/:name',                                 mcp: { tool: 'provisioning', action: 'set_secret' } },
  'provisioning.delete_secret':    { http: 'DELETE /api/provisioning/secrets/:name',                              mcp: { tool: 'provisioning', action: 'delete_secret' } },
  'provisioning.seed':             { http: 'POST /api/provisioning/seed',                                         mcp: { tool: 'provisioning', action: 'seed' } },

  // health
  'health':  { http: 'GET /api/health',  mcp: null },
};

function makeRef(mode: 'http' | 'mcp') {
  return (key: string) => {
    const r = REFS[key];
    if (!r) throw new Error(`Unknown instruction reference: ${key}`);
    if (mode === 'mcp' && r.mcp) {
      const { tool, action, note } = r.mcp;
      let str = `\`${tool}\` tool`;
      if (action) str += `, action \`${action}\``;
      if (note) str += ` (${note})`;
      return str;
    }
    return `\`${r.http}\``;
  };
}

export function buildAgentMarkdown({
  baseUrl = 'http://localhost',
  mode = 'http',
  todoistEnabled = process.env.TODOIST_ENABLED !== 'false',
  todoistProject = process.env.TODOIST_DEFAULT_PROJECT || 'Inbox',
  todoistSection = process.env.TODOIST_DEFAULT_SECTION || '',
  memories = [],
}: {
  baseUrl?: string;
  mode?: 'http' | 'mcp';
  todoistEnabled?: boolean;
  todoistProject?: string;
  todoistSection?: string;
  memories?: { title?: string | null; content?: string | null }[];
} = {}) {
  const todoistDest = todoistSection
    ? `the "${todoistProject} > ${todoistSection}" section`
    : `the "${todoistProject}" project`;
  const isMcp = mode === 'mcp';
  const ref = makeRef(mode);

  const intro = isMcp
    ? `# CRM MCP Server — Agent Reference

This document covers **what to call and when** for the CRM MCP server. It's delivered automatically in the MCP initialize handshake (\`InitializeResult.instructions\`) and mirrors \`${baseUrl}/api/agent\` (the HTTP version).

## Overview

This server manages sales account data: accounts (split into "account" — companies you sell to — and "partner" — channel partners you sell with), contacts, meetings (including internal-only notes flagged on the same record), opportunities (deals tied to non-partner accounts), a per-user product catalog (products + categories) for what the user sells, a global vendor catalog (vendors + vendor_products) for what accounts run, an account_details record per account capturing the typed technical profile (firmographics + vendor product references + notes), and tasks. It's the source of truth for all CRM-adjacent data. Most rows live behind per-user row-level security (you only see your own); the vendor catalog (vendors + vendor_products) is shared globally so analytics and dedupe work across users.

Tool argument schemas (fields, enums, defaults) are available via the standard MCP \`tools/list\` method — this doc doesn't duplicate them. Use it for tool-selection guidance, semantics that aren't visible in the schemas (merge behavior, soft-delete, rate limits, cross-resource constraints), and decision-making. Plan your own steps from the per-resource sections; this doc deliberately doesn't hand you scripted workflows.`
    : `# CRAM API — Agent Reference

Base URL: \`${baseUrl}\`

All API routes are mounted under the \`/api\` prefix (e.g. \`${baseUrl}/api/accounts\`). The bare host serves the GUI; refreshing on \`/accounts/:slug\` returns the SPA, not JSON.

## Overview

This API manages sales account data: accounts (split into "account" — companies you sell to — and "partner" — channel partners you sell with), contacts, meetings, internal notes, opportunities (deals tied to non-partner accounts), a per-user product catalog (products + categories) for what the user sells, a global vendor catalog (vendors + vendor_products) for what accounts run, an account_details record per account capturing the typed technical profile (firmographics + vendor product references + notes), and tasks. It's the source of truth for all CRM-adjacent data. Most rows live behind per-user row-level security (you only see your own); the vendor catalog is shared globally so analytics and dedupe work across users.

This document covers **what to call and when**. For request/response schemas, query parameter types, and validation rules, fetch the OpenAPI spec:

- \`GET ${baseUrl}/docs\` — interactive Swagger UI (HTML).
- \`GET ${baseUrl}/docs/json\` — raw OpenAPI JSON, the LLM-friendly version of the same spec.

If your client speaks MCP, prefer \`${baseUrl}:3100/mcp\` over the raw HTTP API — see the bottom of this doc.`;

  const paramsLine = (httpText: string, mcpText: string) => isMcp ? mcpText : httpText;

  const endpointSection = `## Data Model & Cross-Resource Guidance

Per-tool argument schemas, action enums, and field-level semantics live in ${isMcp ? '`tools/list`' : 'the OpenAPI spec at `/docs/json`'} — not duplicated here. This section covers **only** what tool descriptions can't carry: how entities relate, cross-tool workflows, and constraints that span multiple resources.

### Entity Model
- **Accounts** split by status: \`account\` (companies you sell *to*, default) vs \`partner\` (channel partners you sell *with*). Opportunities can only target non-partner accounts. Partners link to non-partner accounts via the partnership endpoints; the partner's contacts then appear as attendee options on the linked account's meetings.
- **Contacts** carry a \`kind\`: \`account\` (works at a non-partner account — link them), \`partner\` (channel/reseller rep — link to a partner account), or \`internal\` (teammate at your own company — link them to the accounts they support to record the supporting team). Default is \`account\`. Account links are many-to-many: ${ref('contacts.link')} / ${ref('contacts.unlink')} manage the set, and ${ref('contacts.reassign')} atomically moves a contact from one account to another (links the destination, then unlinks the source — fixing a contact imported onto the wrong account without a window where it's orphaned). It only moves the one link you name; any other account links are preserved.
- **Supporting team.** Linking a \`kind=internal\` contact to an account does NOT make them a contact *at* that account — it records them as one of *your* teammates supporting it. Reads keep the two apart by the contact's kind: an account's read shape exposes external people under \`contacts\` and the internal supporters under a separate \`team\` array, and \`contact_count\` counts only the external \`contacts\`. Same \`account_contacts\` join table, same ${ref('contacts.link')} / ${ref('contacts.unlink')} — the kind is the discriminator. (An internal contact can support many accounts; the links are independent.)
- **Meetings** are either account-bound or \`internal=true\` with NULL \`account_id\`. Both live in the same \`meetings\` table. Account meetings require \`contact_ids\` (≥1). \`internal\` and \`account_id\` are immutable through \`update\` — the one exception is the triage path below. Each meeting has a \`date\` (the calendar day, always present) plus optional \`starts_at\`/\`ends_at\` ISO timestamps for time-of-day: the calendar import populates them from the event's start/end, and \`create\`/\`update\` accept them for hand-entered times. They drive time-of-day ordering and the GUI's "today" view; \`date\` remains the grouping/display key. A \`location\` field holds where the meeting is — for virtual meetings the conferencing URL (the calendar import captures it; the GUI surfaces it as a "Join" link), for in-person a room/address.
- **Meeting attendees** come in two forms. **Linked** attendees are \`contact_ids\` → existing CRM contacts. **Unlinked** attendees are a name (and optional email) with no contact yet — passed via \`attendees\` (free text, split on \`,\`/\`;\`) or \`unlinked_attendees: [{display_name, email?}]\`, recorded for visibility so you can capture who was in the room without spawning a contact per head. On \`update\`, \`contact_ids\` replaces the linked set and \`attendees\`/\`unlinked_attendees\` replaces the unlinked set, independently. The read shape exposes \`contacts\` (linked), \`unlinked_attendees[]\` (each with an \`attendee_id\`), and \`attendees\` (a display string of everyone).
- **Parked notes & triage.** A note you can't confidently place gets parked: create it \`internal:true, needs_review:true\` (no account), and it shows up in ${ref('meetings.list')} with \`needs_review=true\`. Resolve later: ${ref('meetings.assign_account')} attaches it to an account (sets \`account_id\`, flips \`internal=false\`, clears \`needs_review\`; 409 if already assigned), and ${ref('meetings.link_attendee')} converts an \`unlinked_attendee\` into a link to an existing contact (dedupes if that contact is already linked). This is the "separate creation from assignment" path — capture the note now, place it deterministically later, rather than dropping data or guessing. **Fixing a bad import is a different operation:** to move a meeting that is *already* on the wrong account to a different account — or to strip its account and turn it back into an internal note — use ${ref('meetings.reassign_account')}. Unlike \`assign_account\` it works on an already-assigned meeting (no 409 guard), clears \`needs_review\`, and leaves the attendee list untouched (who attended is independent of which account owns the note). **Combining duplicate meetings:** when two meeting rows are the same real meeting — e.g. a Krisp note that parked because it couldn't be time-matched to the calendar meeting it belongs to — merge them: ${ref('merge.preview')} returns a field/relation plan and ${ref('merge.apply')} folds the *source* into the *base* (you choose what to keep per field; notes append by default, attendees you select are brought over), then soft-deletes the source. The base survives and any Krisp link is carried onto it, so a later transcript event still lands on the right meeting.
- **Notes** are short markdown blurbs attached to **exactly one** of account / contact / opportunity (DB-enforced). Target is immutable — wrong target means delete and recreate.
- **Threads & tasks** are per-account workstreams: a thread is an open line of work on one account (e.g. "Firewall refresh POV") that holds **tasks** (concrete steps, each with an optional contact assignee and \`due_date\`) and a **contact pool** (who's involved). Open-by-default with a \`closed_at\` lifecycle; completion is tracked in the CRM with no Todoist sync. Lighter than an opportunity — workstream state, not a forecastable deal. See **Threads & Tasks** below.
- **Opportunities** are sales deals tied to one non-partner account. Stages run a fixed pipeline: \`opp_identification\` → \`tech_discovery\` → \`non_pov_tech_validation\` → \`pov_planning\` → \`pov_tech_validation\` → \`tech_decision_pending\` → terminal \`tech_loss_closed\` / \`tech_win_closed\` / \`no_tech_validation_closed\`.
- **Vendor catalog** (\`vendors\` + \`vendor_products\`) is **global** — no per-user RLS, shared across tenants so dedup and stack analytics work org-wide. The per-user **product catalog** (\`products\` + \`product_categories\`) is what *you sell*. The two namespaces do not link.
- **Account Details** is the typed technical profile (one row per account), replacing the old \`accounts.environment\` JSONB blob. Tech-environment data (firewalls, EDRs, employee/site/endpoint counts, …) lives ONLY here — never stuff it back onto the account row.

### Slugs
Account slugs are lowercase-hyphenated company names (\`bank-of-america\`, not \`Bank Of America\` or \`BoA\`). Slug lookups are exact — if you only have a display name, search first.

### Search Before Create
Avoid duplicate people and companies before creating.
- **Contacts — prefer ${ref('contacts.find_or_create')}** over plain create. It's the single creation path, running full dedupe + enrich: matches by exact email (case-insensitive) → exact \`full_name\`+\`kind\` → fuzzy \`full_name\` within the same kind (pg_trgm), returns the match (\`matched_by\`, plus \`match_score\` when fuzzy), (re)links it to \`account_id\` when given, and — when you supply a value for a field that's currently BLANK on the stored contact — fills it in (reported via \`enriched\`/\`enriched_fields\`), never overwriting existing data. Send at least an email OR a name: an **email-only contact is valid** (you see \`jsmith@acme.com\` with no display name — store it now, and the name gets filled the next time you see them with one). This keeps you from piling up near-duplicate contacts, especially \`kind=internal\` teammates. ${ref('contacts.find_existing')} is the read-only probe (returns null, no write); ${ref('contacts.create_standalone')} runs the same dedupe but still refuses with 409 + an \`existing\` payload on a match.
- **Accounts:** search (or ${ref('accounts.find_existing')}) first — match order slug → any domain → case-insensitive name. \`create\` refuses with 409 + an \`existing\` payload. **When ingesting companies from notes/email, prefer ${ref('accounts.find_or_create')}** — it's the idempotent classifier: exact tiers + a near-exact fuzzy name (≥ 0.85) return \`status:"matched"\`; a mid-confidence fuzzy name (0.4–0.85) returns \`status:"ambiguous"\` with ranked \`candidates\` and writes nothing (surface them for one-click triage rather than guessing); no match returns \`status:"none"\`. Pass \`create_if_missing:true\` only when you're willing to spawn a fresh account on "none"; pass \`fuzzy:false\` to match on exact slug/domain/name alone.

### From-Emails Flow (add people; a meeting only if there are notes)
When the user pastes an attendee list / calendar-invite emails, **default to adding the account + contacts only — do NOT create a meeting unless the user actually has meeting notes to record.** A pasted To/CC line is not a meeting.
1. ${ref('contacts.resolve_emails')} — pure read. Returns attendees tagged \`kind: account|internal\` plus account candidates grouped by domain. Internal-flagged domains (managed via \`internal_domains\`) don't appear as account candidates — but the internal attendees are still part of the batch and get mapped to the chosen account as its supporting team in step 2. \`SELF_DOMAINS\` / \`INTERNAL_DOMAINS\` env vars act as a bootstrap default until the user curates the list.
2. ${ref('contacts.import_from_emails')} — atomic write, **no meeting**. Creates the account (if new), then creates/links every chosen contact to it — external attendees as the account's contacts, \`kind=internal\` teammates as its supporting team (still flagged internal, just linked). Fires background enrichment for any new contact flagged \`research: true\` (opt-in per contact — it burns LinkedIn quota). This is the right call for "add this account and these contacts".
3. **Only if the user also has meeting notes**, use ${ref('meetings.create_from_emails')} *instead of* step 2 — it runs the same account + contact import and then attaches the meeting body. Never invent a meeting just to capture people.
4. Poll enrichment via ${ref('contacts.get_enrichment_job')} (or ${ref('meetings.get_enrichment_job')} for the meeting flow) until \`completed\`. Successful jobs **fill-only** the typed contact fields (\`title\`, \`linkedin\`, \`location_raw\`, normalized city/state/country, \`notes\`) — research is machine data, so it only populates columns that are currently blank and never overwrites a value you've already curated.

Auto-proceed only when there's exactly one external account candidate and most attendees already exist as contacts. Otherwise surface choices to the user — especially the per-contact research toggle.

### Notes Import (bulk directory)
For ingesting a whole directory of existing notes (Obsidian, Apple/Google Notes, a folder of call summaries), use the bulk importer — not one-by-one meeting creates. Send text files as \`[{path, content}]\` to ${ref('notes_import.enqueue')} (read or convert the directory client-side); a \`.zip\` can be posted to ${ref('notes_import.upload_zip')} (HTTP-only — binary doesn't travel over MCP). The zip endpoint extracts text files and converts \`.docx\` plus text-based \`.pdf\` entries — including zipped Google Drive folder downloads — into the same \`files[]\` shape before enqueueing the normal pipeline. It returns a \`jobId\`; poll ${ref('notes_import.get_job')} until \`completed\`.

The job processes one file at a time (the local model has a small context window — it never sees the whole directory) and resolves each note to an account deterministically:
- **Confident account match** → linked cleanly.
- **Unknown company** → a new account is **auto-created with \`needs_review=true\`** and the note linked to it. Review the queue via ${ref('accounts.list_full')} with \`needs_review=true\`; clear the flag with ${ref('accounts.update')} once verified.
- **Ambiguous** (a similar account already exists) → the note is **parked** (\`internal=true, needs_review=true\`, no account) rather than risk a duplicate account. Find parked notes via ${ref('meetings.list')} with \`needs_review=true\` and place them with ${ref('meetings.assign_account')}.
- **Internal / no company** → parked the same way.

Attendees named in a note become **unlinked attendees** (recorded, not turned into contacts) — link them later with ${ref('meetings.link_attendee')}. Re-importing the same files is idempotent (skipped on a filename match), so running it twice is safe.

### Vendor Catalog Rules
- **Use \`find_or_create\`, never \`create\`.** ${ref('vendors.find_or_create')} and ${ref('vendor_products.find_or_create')} are idempotent and fuzzy-match (pg_trgm, threshold ~0.4) against existing rows. Auto-created rows get \`needs_review=true\` for later human cleanup. Don't pre-check existence — send what you have and let the server decide.
- **Send canonical full names.** Vendor = full corporate name (\`"Palo Alto Networks"\` not \`"PANW"\`, \`"Aruba Networks"\` not \`"Aruba"\`, \`"Cisco"\` not \`"Cisco Meraki"\`). Product = the actual brand (\`"AnyConnect"\` not \`"VPN"\`, \`"Firepower NGFW"\` not \`"Firewall"\`, \`"Entra ID"\` not \`"Identity"\`, \`"Purview DLP"\` not \`"DLP"\`, \`"Amazon Web Services"\` not \`"AWS"\`). The fuzzy matcher saves you from variants — it can't invent the canonical name from nothing, and it CANNOT bridge an abbreviation to its expansion (\`"AWS"\` shares almost no trigrams with \`"Amazon Web Services"\`), so spell names out the same way every time.
- **Known rebrands — translate before calling:** Cisco FTD / Firepower Threat Defense → \`Firepower NGFW\`; Aruba Silver Peak SD-WAN → \`EdgeConnect SD-WAN\`; Microsoft Azure AD / AAD → \`Entra ID\`; VMware NSX SD-WAN by VeloCloud → \`VeloCloud SD-WAN\`.
- **Soft-delete only.** \`delete\` sets \`deleted_at\`; rows stay in the DB so \`account_details *_ids\` references don't dangle. Use \`restore\` to unmark.
- **De-dupe with ${ref('vendor_products.merge')}.** When two rows are the same product — an abbreviation/rebrand the fuzzy matcher missed ("AWS" vs "Amazon Web Services"), or a generic placeholder vs the real brand ("DLP" vs "Digital Guardian") — merge them instead of deleting. \`winner_id\` survives as canonical; \`loser_id\` is repointed across every \`account_details *_ids\` array (de-duplicated) and soft-deleted, so no account loses the fact. Same-category only. Pick the spelled-out name as the winner; if the better name is on the loser, rename the winner first (\`update\`) or merge the other direction.

### Account Details (Technical Profile)
- Typed firmographics + numeric counts + one \`bigint[]\` column per security category (\`firewall_ids\`, \`edr_ids\`, \`siem_ids\`, \`idp_ids\`, etc.) referencing \`vendor_products.id\`. Multi-vendor reality (e.g. Cisco FTD *and* Meraki firewalls) is modeled by multiple IDs in one array.
- \`technical_notes\` is the prose lane for nuance that doesn't compress into a column ("Cisco FTD used as VPN only", "SSL decryption sized but rollout deferred").
- **No generic analytics endpoint.** For ad-hoc queries ("accounts >$10M running CrowdStrike Falcon"), resolve product IDs via ${ref('vendor_products.list')} and surface them with the user's thresholds — they run the actual query in psql.

### Threads & Tasks
A **thread** is an open workstream with one account — the relationship-level "where do we stand" record ("Firewall refresh POV", "MSA redlines"). A **task** is one concrete step inside a thread, with an optional assignee (any of the user's contacts; omit/null = "no one") and an optional \`due_date\`. Use threads to track what's in flight on an account; tasks for the individual steps and who owes them.
- **Read:** ${ref('threads.list')} returns an account's threads, each enriched with its \`tasks\` and its \`contacts\` pool. **Open threads only by default** — pass \`include_closed=true\` to include closed ones.
- **Lifecycle:** finish a thread by closing it (${ref('threads.update')} with \`closed=true\`), not deleting — closing keeps the history and just hides it from the default view; reopen with \`closed=false\`. ${ref('threads.delete')} is a hard cascade (drops the thread's tasks + pool links), so reserve it for mistakes. Mark a step done with \`completed=true\` on ${ref('threads.update_task')} (\`false\` reopens); no need to delete it.
- **Completion lives in the CRM.** Tasks are tracked here with **no Todoist sync** — don't mirror them into Todoist or assume completing one here closes one there.
- **Contact pool vs assignee:** the pool (${ref('threads.link_contact')} / ${ref('threads.unlink_contact')}) is simply *who's involved* in the thread — the shortlist you pick task assignees from. Assigning a task doesn't require pool membership, and unlinking someone from the pool does **not** unassign their tasks.

### Prose Lanes (Don't Mix)
Different long-form fields capture different things:
- \`meetings.body\` — chronological summary of one conversation, tied to attendees
- \`notes.body\` — one short dated observation attached to one entity (running journal)
- \`accounts.relationship_summary\` — rolling people/politics overview of an account
- \`account_details.technical_notes\` — tech-stack nuance that doesn't fit a column

**Don't dump raw enrichment payloads into \`notes\`** — summarize the relevant bits into prose. The full payload belongs in the job result, not the contact record.

### Outreach Queue Isolation
Each surface (HTTP, MCP) has its **own in-memory queue** — they don't share state. Enqueue and poll on the same surface. If a job fails with a LinkedIn session/cookie/auth error, **stop the batch and surface to the user** — cookies need an interactive \`node outreach/src/index.js login\`. Every queued job will fail the same way until that happens.

### Memories
Long-lived user preferences/rules/facts injected into the agent's system prompt at session start (see the **User Memories** section above when populated). **Only ${isMcp ? 'call \`memories\` action \`create\`' : 'POST `/api/memories`'} when the user explicitly asks** ("remember that…", "save a memory about…", "from now on…"). Do not save on your own judgment — that's how the store fills with noise. The user curates; you're the saver.

### System Prompt
Distinct from memories: the **system prompt** is your single base block of instructions/persona, not a list of discrete facts. It's user-configured and applied to you automatically each turn — you never fetch it to use it. If the user explicitly asks to change it ("change your system prompt to…", "reset your instructions"), use ${ref('agent_settings.update')} with \`system_prompt\` (null or empty reverts to the built-in default). ${ref('agent_settings.get')} returns \`default_system_prompt\` — the built-in default rendered live — if you need to show or restore it. **Never rewrite your own base instructions on your own initiative**, and don't write the current date into it — that's injected for you every turn.

### Events
The events table is the public event calendar (currently scraped from \`paloaltonetworks.com/resources/event-calendar\`) — **global**, no per-user scoping. When the user asks about an event ("when is X", "where is the Cortex Partner Day"), query this table — don't ask them for a link. For travel planning, prefer ${ref('events.upcoming_with_contacts')} which filters to events with at least one of the caller's contacts in that city.
${todoistEnabled ? `
### Todoist
Tasks default to ${todoistDest}. Use labels = account slug (\`["bank-of-america"]\`) so per-account views can filter.
` : ''}
### Provisioning (Homelab Infrastructure)
An in-process broker that stands up homelab/cloud infrastructure (Terraform + PAN-OS/AWS lifecycle), ported from panw-broker. This is the single user's lab — not per-tenant CRM data. Terraform state lives in Postgres (native \`pg\` backend), runtime state + jobs in the \`provisioning_*\` tables.
- **Discover, then act.** ${ref('provisioning.list_deployments')} lists available deployments; ${ref('provisioning.get_deployment')} returns a deployment's resources, ordered steps, launch inputs, and **\`requiredEnv\`** — the secret names it needs.
- **Proxmox: discover the cluster first.** For Proxmox deployments, ${ref('provisioning.discover_proxmox')} returns the live node / template / datastore / bridge inventory (and the VMIDs already in use) so you can fill in a deployment's placement. It reads the \`PROXMOX_VE_ENDPOINT\` / \`PROXMOX_VE_API_TOKEN\` secrets.
- **Secrets resolve by name.** Deployment config references a secret by env-var name (e.g. \`PANW_PANORAMA_AUTH_CODE\`); store the value once with ${ref('provisioning.set_secret')} (AES-256-GCM at rest, **write-only** — ${ref('provisioning.list_secrets')} returns names/descriptions, never values). Satisfy a deployment's \`requiredEnv\` before deploying.
- **Lifecycle is asynchronous.** ${ref('provisioning.deploy')} / ${ref('provisioning.deprovision')} (whole deployment), ${ref('provisioning.up')} / ${ref('provisioning.down')} (one specific resource), and ${ref('provisioning.run_action')} (a resource-specific step like verify-connected-resources) **enqueue a durable job and return it immediately** — they do NOT wait for terraform. \`deploy\` runs workflow steps when present; deployments without steps deploy their configured resources. Poll ${ref('provisioning.get_job')} until \`status\` is \`succeeded\` / \`failed\` / \`canceled\`; log lines stream into the job. Jobs run **one at a time**. GUI clients can subscribe to ${ref('provisioning.event_snapshot')} for snapshot-first SSE updates; MCP callers use the \`event_snapshot\` action for the same baseline and poll \`get_job\` for follow-up. ${ref('provisioning.cancel_job')} requests cancellation — a queued job cancels at once, a running one has its terraform child terminated.
- **Run multiple copies of one blueprint with instances.** A seeded deployment is a *template* (\`list_deployments\` shows it with \`isTemplate:true\`). To stand up several isolated copies of the same blueprint **without editing config files**, call ${ref('provisioning.create_instance')} with an operator \`name\` — it clones the template into a new uniquely-slugged deployment (its own Terraform workspaces and cloud resource names, so nothing collides) and enqueues that clone's deploy, returning the job whose \`deployment\` is the new instance slug. Instances carry a \`templateName\` and survive the boot reseed. Manage an instance with the normal \`deploy\`/\`deprovision\`/\`down\` verbs against its slug; once its resources are destroyed, ${ref('provisioning.delete_instance')} removes the row.
- **Seed before you deploy.** ${ref('provisioning.seed')} idempotently seeds the typed config modules (\`config/modules/**\`) (also runs on API boot). deploy/up against an unseeded deployment is rejected with a clear error.
- **Reads + power are immediate.** ${ref('provisioning.list_resources')} / ${ref('provisioning.get_resource')} show runtime state; ${ref('provisioning.power_state')} refreshes from the cloud provider; ${ref('provisioning.start')} / ${ref('provisioning.stop')} toggle power (refused with 409 while a lifecycle job is active).
- **Runtime tunnels are broker-managed sessions.** For private AWS Windows endpoints, use ${ref('provisioning.open_rdp_tunnel')} to start an SSM-backed RDP tunnel on a Docker-published LAN port. For private AWS Linux endpoints, use ${ref('provisioning.open_ssh_tunnel')} to start an SSM-backed SSH tunnel; the returned view includes an \`sshCommand\`. Use ${ref('provisioning.list_tunnels')} to see active endpoints and ${ref('provisioning.close_tunnel')} to close one. These are process-local sessions, not Terraform resources; reopen after an API/container restart.

### Backups
Backups are **instance-wide** (one dump captures every tenant's data), not per-user — these endpoints intentionally don't scope by the calling user. A dump is a full \`pg_dump -Fc\` of the database, which means **every settings table is included** (\`app_settings\`, \`user_agent_settings\`, \`user_internal_domains\`, \`user_memories\`, \`user_theme_settings\`, \`themes\`) alongside the operational tables. Host-side operator config (\`.env\`, \`outreach/cookies.json\`) lives outside the DB and is **not** captured. Use ${ref('backup.import_from_path')} to register an externally-produced dump that already sits on the API container's filesystem (e.g. an operator scp'd it onto the host bind mount); files uploaded from a browser go through \`POST /api/backup/import\` (octet-stream body, not exposed via MCP). ${ref('backup.restore')} is destructive: \`pg_restore --clean --if-exists\` drops and recreates every object. Only call when intentionally rolling back.${isMcp ? '' : `

### Health
- ${ref('health')} returns DB record counts and uptime. Use it to verify the API is running.`}`;

  const memoriesSection = (() => {
    if (!Array.isArray(memories) || memories.length === 0) return '';
    const bullets = memories.map((m) => {
      const body = (m.content || '').trim();
      return m.title
        ? `- **${m.title}** — ${body}`
        : `- ${body}`;
    }).join('\n');
    const saveHint = isMcp
      ? 'To save a new memory, use the `memories` tool with action `create` — but **only when the user explicitly asks** ("remember that…", "save a memory about…"). Do not save memories on your own initiative.'
      : 'New memories are saved via `POST /api/memories` — only on explicit user request, never on your own initiative.';
    return `## User Memories

The user has saved the following preferences, rules, and facts. **Apply them as if the user gave the same instruction in the current conversation** — they outrank your defaults unless they directly conflict with what the user just asked.

${bullets}

${saveHint}`;
  })();

  // Prescriptive workflows used to live here. Most were linear recipes that
  // mirrored the per-resource sections, and steering the agent through scripted
  // step lists masked root-cause tool misuse — e.g. running domain lookups on
  // bare company names instead of falling back to search. Tool descriptions
  // and per-resource sections are now the source of truth; the agent composes
  // its own plan from them.

  const mergeSection = `## ${isMcp ? 'Accounts `update` Merge Behavior' : 'PATCH Merge Behavior for Accounts'}

| Field | Strategy |
|---|---|
| Scalars (\`status\`, \`last_contact\`, \`relationship_summary\`, \`active_deals\`, \`favorite\`, \`needs_review\`) | Replace |
| \`domains\` | Full replace (send the complete list) |

Partners are managed via the dedicated partner endpoints (\`list_partners\`, \`add_partner\`, \`remove_partner\`) — not through the account body. The supporting team is managed the same way contacts always are: link \`kind=internal\` contacts to the account (${ref('contacts.link')} / ${ref('contacts.unlink')}); they come back in the account's \`team\` array, not as an account field. **Technical environment data does not live on the account record** — it's on \`account_details\`, see that section's update semantics (scalars replaced when present; array fields fully replaced when present).`;

  const footer = isMcp
    ? `## HTTP API

This server also exposes the same operations as an HTTP REST API at \`${baseUrl}/api\`. Use that if you need to integrate from a non-MCP client. Interactive docs at \`${baseUrl}/docs\`; raw OpenAPI at \`${baseUrl}/docs/json\`.`
    : `## MCP

If your client supports the Model Context Protocol, use it instead of the raw HTTP API:

- Endpoint: \`${baseUrl}:3100/mcp\`
- Tool list, descriptions, and JSON schemas come from \`tools/list\`. This doc is delivered separately in \`InitializeResult.instructions\` and covers entity model / cross-resource workflows only — per-tool action mechanics are in the schemas, not here.`;

  const sections = [intro];
  if (memoriesSection) sections.push(memoriesSection);
  sections.push(endpointSection, mergeSection, footer);
  return sections.join('\n\n');
}
