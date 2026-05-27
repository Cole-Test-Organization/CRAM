const BASE = '/api';

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

async function post<T>(path: string, data: any): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

async function patch<T>(path: string, data: any): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

async function put<T>(path: string, data: any): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

async function del<T = void>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const api = {
  // Accounts
  getAccounts: (params?: { status?: string; exclude_status?: string; sort?: string; limit?: number; offset?: number }) => {
    const qs = new URLSearchParams();
    if (params?.status) qs.set('status', params.status);
    if (params?.exclude_status) qs.set('exclude_status', params.exclude_status);
    if (params?.sort) qs.set('sort', params.sort);
    if (params?.limit) qs.set('limit', String(params.limit));
    if (params?.offset) qs.set('offset', String(params.offset));
    const q = qs.toString();
    return get<{ accounts: any[]; total: number }>(`/accounts${q ? '?' + q : ''}`);
  },

  getAccount: (slug: string) =>
    get<any>(`/accounts/by-slug/${encodeURIComponent(slug)}`),

  createAccount: (data: any) =>
    post<any>('/accounts', data),

  patchAccount: (id: number, data: any) =>
    patch<any>(`/accounts/${id}`, data),

  deleteAccount: (id: number) =>
    del(`/accounts/${id}`),

  // Contacts
  getAllContacts: (params?: { company?: string; search?: string; kind?: string; limit?: number; offset?: number }) => {
    const qs = new URLSearchParams();
    if (params?.company) qs.set('company', params.company);
    if (params?.search) qs.set('search', params.search);
    if (params?.kind) qs.set('kind', params.kind);
    if (params?.limit) qs.set('limit', String(params.limit));
    if (params?.offset) qs.set('offset', String(params.offset));
    const q = qs.toString();
    return get<any[]>(`/contacts${q ? '?' + q : ''}`);
  },

  getAttendeeOptions: (params: { mode: 'external' | 'internal'; accountId?: number }) => {
    const qs = new URLSearchParams();
    qs.set('mode', params.mode);
    if (params.accountId) qs.set('account_id', String(params.accountId));
    return get<{ account?: any[]; partner: any[]; internal: any[] }>(`/contacts/attendee-options?${qs.toString()}`);
  },

  getContactCompanies: () =>
    get<any[]>('/contacts/companies'),

  getContact: (id: number) =>
    get<any>(`/contacts/${id}`),

  getContacts: (accountId: number) =>
    get<any[]>(`/accounts/${accountId}/contacts`),

  createContact: (accountId: number, data: any) =>
    post<any>(`/accounts/${accountId}/contacts`, data),

  createStandaloneContact: (data: any) =>
    post<any>('/contacts', data),

  patchContact: (id: number, data: any) =>
    patch<any>(`/contacts/${id}`, data),

  deleteContact: (id: number) =>
    del(`/contacts/${id}`),

  researchContact: (id: number) =>
    post<{ jobId: string; contactId: number; name: string; accountName: string | null }>(
      `/contacts/${id}/research`,
      {},
    ),

  listContactEnrichmentJobs: (contactId: number) =>
    get<{
      jobs: Array<{
        jobId: string;
        contactId: number;
        name: string;
        accountName: string | null;
        status: 'queued' | 'running' | 'completed' | 'failed';
        stage: string | null;
        outreachJobId: string | null;
        error: string | null;
        patched: Record<string, string> | null;
        createdAt: string;
        startedAt: string | null;
        completedAt: string | null;
      }>;
    }>(`/contacts/${contactId}/enrichment-jobs`),

  getContactEnrichmentJob: (jobId: string) =>
    get<{
      jobId: string;
      contactId: number;
      name: string;
      accountName: string | null;
      status: 'queued' | 'running' | 'completed' | 'failed';
      stage: string | null;
      outreachJobId: string | null;
      error: string | null;
      patched: Record<string, string> | null;
      createdAt: string;
      startedAt: string | null;
      completedAt: string | null;
    }>(`/contacts/enrichment-jobs/${encodeURIComponent(jobId)}`),

  // Partnerships
  listPartners: (accountId: number) =>
    get<any[]>(`/accounts/${accountId}/partners`),

  addPartner: (accountId: number, partnerId: number) =>
    post<any[]>(`/accounts/${accountId}/partners/${partnerId}`, {}),

  removePartner: (accountId: number, partnerId: number) =>
    del<any[]>(`/accounts/${accountId}/partners/${partnerId}`),

  // Meetings
  getAllMeetings: (params?: { limit?: number; offset?: number }) => {
    const qs = new URLSearchParams();
    if (params?.limit) qs.set('limit', String(params.limit));
    if (params?.offset) qs.set('offset', String(params.offset));
    const q = qs.toString();
    return get<any[]>(`/meetings${q ? '?' + q : ''}`);
  },

  getMeetings: (accountId: number) =>
    get<any[]>(`/accounts/${accountId}/meetings`),

  getMeeting: (id: number) =>
    get<any>(`/meetings/${id}`),

  createMeeting: (data: { account_id?: number; internal?: boolean; date: string; title?: string; attendees?: string; contact_ids?: number[]; body: string }) =>
    post<any>(`/meetings`, data),

  updateMeeting: (id: number, data: any) =>
    put<any>(`/meetings/${id}`, data),

  deleteMeeting: (id: number) =>
    del(`/meetings/${id}`),

  // From-emails flow: resolve a list of attendee emails into known contacts +
  // account candidates, then submit the user's choices to create the meeting
  // (and optionally fire off background contact enrichment).
  resolveMeetingEmails: (emails: string[] | string) =>
    post<{
      attendees: Array<{
        email: string;
        domain: string | null;
        name_guess: string;
        kind: 'account' | 'internal';
        contact: any | null;
        account_match: any | null;
      }>;
      accounts: Array<{
        domain: string;
        account: any | null;
        attendee_count: number;
        suggested_name: string;
      }>;
      primary_domain: string | null;
    }>('/meetings/resolve-emails', { emails }),

  createMeetingFromEmails: (payload: {
    date: string;
    title?: string;
    attendees_text?: string;
    body: string;
    account: { mode: 'existing' | 'new'; account_id?: number; name?: string; domain?: string };
    contacts: Array<
      | { mode: 'existing'; contact_id: number; link_to_account?: boolean }
      | { mode: 'new'; full_name: string; email?: string; kind?: 'account' | 'partner' | 'internal'; research?: boolean }
    >;
  }) =>
    post<{ meeting: any; account_id: number; enrichment_jobs: Array<{ contact_id: number; enrichment_job_id: string }> }>(
      '/meetings/from-emails',
      payload,
    ),

  listMeetingEnrichmentJobs: (meetingId: number) =>
    get<{
      jobs: Array<{
        jobId: string;
        contactId: number;
        name: string;
        accountName: string | null;
        status: 'queued' | 'running' | 'completed' | 'failed';
        stage: string | null;
        outreachJobId: string | null;
        error: string | null;
        patched: Record<string, string> | null;
        createdAt: string;
        startedAt: string | null;
        completedAt: string | null;
      }>;
    }>(`/meetings/${meetingId}/enrichment-jobs`),

  getMeetingEnrichmentJob: (jobId: string) =>
    get<{
      jobId: string;
      contactId: number;
      name: string;
      accountName: string | null;
      status: 'queued' | 'running' | 'completed' | 'failed';
      stage: string | null;
      outreachJobId: string | null;
      error: string | null;
      patched: Record<string, string> | null;
      createdAt: string;
      startedAt: string | null;
      completedAt: string | null;
    }>(`/meetings/enrichment-jobs/${encodeURIComponent(jobId)}`),

  // Search
  search: (q: string, type = 'all', limit = 20) =>
    get<any>(`/search?q=${encodeURIComponent(q)}&type=${type}&limit=${limit}`),

  // Events
  getEvents: (params?: {
    search?: string;
    city?: string;
    country?: string;
    mode?: string;
    source?: string;
    after?: string;
    before?: string;
    has_location?: boolean;
    tags?: string;
    sort?: string;
    order?: 'asc' | 'desc';
    limit?: number;
    offset?: number;
  }) => {
    const qs = new URLSearchParams();
    if (params?.search) qs.set('search', params.search);
    if (params?.city) qs.set('city', params.city);
    if (params?.country) qs.set('country', params.country);
    if (params?.mode) qs.set('mode', params.mode);
    if (params?.source) qs.set('source', params.source);
    if (params?.after) qs.set('after', params.after);
    if (params?.before) qs.set('before', params.before);
    if (params?.has_location !== undefined) qs.set('has_location', String(params.has_location));
    if (params?.tags) qs.set('tags', params.tags);
    if (params?.sort) qs.set('sort', params.sort);
    if (params?.order) qs.set('order', params.order);
    if (params?.limit !== undefined) qs.set('limit', String(params.limit));
    if (params?.offset !== undefined) qs.set('offset', String(params.offset));
    const q = qs.toString();
    return get<{ events: any[]; total: number }>(`/events${q ? '?' + q : ''}`);
  },

  getEventFacets: () =>
    get<{
      cities: { value: string; count: number }[];
      countries: { value: string; count: number }[];
      modes: { value: string; count: number }[];
      sources: { value: string; count: number }[];
      tags: { value: string; count: number }[];
    }>(`/events/facets`),

  getEvent: (id: number) =>
    get<any>(`/events/${id}`),

  getUpcomingEventsWithContacts: (params?: { mode?: string; after?: string; before?: string; limit?: number }) => {
    const qs = new URLSearchParams();
    if (params?.mode) qs.set('mode', params.mode);
    if (params?.after) qs.set('after', params.after);
    if (params?.before) qs.set('before', params.before);
    if (params?.limit !== undefined) qs.set('limit', String(params.limit));
    const q = qs.toString();
    return get<{ events: any[] }>(`/events/upcoming/with-contacts${q ? '?' + q : ''}`);
  },

  // Opportunities
  getOpportunities: (params?: {
    account_id?: number;
    stage?: string;
    sort?: string;
    order?: 'asc' | 'desc';
    limit?: number;
    offset?: number;
  }) => {
    const qs = new URLSearchParams();
    if (params?.account_id) qs.set('account_id', String(params.account_id));
    if (params?.stage) qs.set('stage', params.stage);
    if (params?.sort) qs.set('sort', params.sort);
    if (params?.order) qs.set('order', params.order);
    if (params?.limit !== undefined) qs.set('limit', String(params.limit));
    if (params?.offset !== undefined) qs.set('offset', String(params.offset));
    const q = qs.toString();
    return get<{ opportunities: any[]; total: number }>(`/opportunities${q ? '?' + q : ''}`);
  },

  getOpportunitiesByAccount: (accountId: number) =>
    get<any[]>(`/accounts/${accountId}/opportunities`),

  getOpportunity: (id: number) =>
    get<any>(`/opportunities/${id}`),

  createOpportunity: (data: any) =>
    post<any>('/opportunities', data),

  patchOpportunity: (id: number, data: any) =>
    patch<any>(`/opportunities/${id}`, data),

  deleteOpportunity: (id: number) =>
    del(`/opportunities/${id}`),

  linkOppProduct: (opportunityId: number, productId: number) =>
    post<any>(`/opportunities/${opportunityId}/products/${productId}`, {}),

  unlinkOppProduct: (opportunityId: number, productId: number) =>
    del(`/opportunities/${opportunityId}/products/${productId}`),

  // Products
  getProducts: (params?: { category_id?: number; search?: string; limit?: number; offset?: number }) => {
    const qs = new URLSearchParams();
    if (params?.category_id) qs.set('category_id', String(params.category_id));
    if (params?.search) qs.set('search', params.search);
    if (params?.limit !== undefined) qs.set('limit', String(params.limit));
    if (params?.offset !== undefined) qs.set('offset', String(params.offset));
    const q = qs.toString();
    return get<{ products: any[]; total: number }>(`/products${q ? '?' + q : ''}`);
  },

  getProduct: (id: number) =>
    get<any>(`/products/${id}`),

  createProduct: (data: { name: string; category_id?: number | null }) =>
    post<any>('/products', data),

  patchProduct: (id: number, data: { name?: string; category_id?: number | null }) =>
    patch<any>(`/products/${id}`, data),

  deleteProduct: (id: number) =>
    del(`/products/${id}`),

  // Product categories
  getProductCategories: (params?: { limit?: number; offset?: number }) => {
    const qs = new URLSearchParams();
    if (params?.limit !== undefined) qs.set('limit', String(params.limit));
    if (params?.offset !== undefined) qs.set('offset', String(params.offset));
    const q = qs.toString();
    return get<{ categories: any[]; total: number }>(`/product-categories${q ? '?' + q : ''}`);
  },

  getProductCategory: (id: number) =>
    get<any>(`/product-categories/${id}`),

  createProductCategory: (data: { name: string }) =>
    post<any>('/product-categories', data),

  patchProductCategory: (id: number, data: { name: string }) =>
    patch<any>(`/product-categories/${id}`, data),

  deleteProductCategory: (id: number) =>
    del(`/product-categories/${id}`),

  // Vendors (global catalog)
  getVendors: (params?: { search?: string; needs_review?: boolean; include_deleted?: boolean; limit?: number; offset?: number }) => {
    const qs = new URLSearchParams();
    if (params?.search) qs.set('search', params.search);
    if (params?.needs_review !== undefined) qs.set('needs_review', String(params.needs_review));
    if (params?.include_deleted !== undefined) qs.set('include_deleted', String(params.include_deleted));
    if (params?.limit !== undefined) qs.set('limit', String(params.limit));
    if (params?.offset !== undefined) qs.set('offset', String(params.offset));
    const q = qs.toString();
    return get<{ vendors: any[]; total: number }>(`/vendors${q ? '?' + q : ''}`);
  },
  getVendor: (id: number) => get<any>(`/vendors/${id}`),
  findOrCreateVendor: (data: { name: string; slug?: string; website?: string | null; notes?: string | null }) =>
    post<{ vendor: any; created: boolean }>('/vendors/find-or-create', data),
  patchVendor: (id: number, data: any) => patch<any>(`/vendors/${id}`, data),
  deleteVendor: (id: number) => del(`/vendors/${id}`),

  // Vendor products (global catalog of products under vendors)
  getVendorProducts: (params?: { vendor_id?: number; vendor_slug?: string; category?: string; search?: string; needs_review?: boolean; include_deleted?: boolean; limit?: number; offset?: number }) => {
    const qs = new URLSearchParams();
    if (params?.vendor_id) qs.set('vendor_id', String(params.vendor_id));
    if (params?.vendor_slug) qs.set('vendor_slug', params.vendor_slug);
    if (params?.category) qs.set('category', params.category);
    if (params?.search) qs.set('search', params.search);
    if (params?.needs_review !== undefined) qs.set('needs_review', String(params.needs_review));
    if (params?.include_deleted !== undefined) qs.set('include_deleted', String(params.include_deleted));
    if (params?.limit !== undefined) qs.set('limit', String(params.limit));
    if (params?.offset !== undefined) qs.set('offset', String(params.offset));
    const q = qs.toString();
    return get<{ products: any[]; total: number }>(`/vendor-products${q ? '?' + q : ''}`);
  },
  getVendorProduct: (id: number) => get<any>(`/vendor-products/${id}`),
  findOrCreateVendorProduct: (data: { vendor_id?: number; vendor_name?: string; name: string; slug?: string; category: string; notes?: string | null }) =>
    post<{ product: any; created: boolean; vendor: any; vendor_created: boolean }>('/vendor-products/find-or-create', data),
  patchVendorProduct: (id: number, data: any) => patch<any>(`/vendor-products/${id}`, data),
  deleteVendorProduct: (id: number) => del(`/vendor-products/${id}`),

  // Account details (technical profile, 1-1 with accounts).
  // A missing row (404) means "no profile yet" — surfaced as null so the GUI
  // can render the empty form without spamming the console.
  getAccountDetails: async (accountId: number) => {
    const res = await fetch(`${BASE}/accounts/${accountId}/details`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return res.json();
  },
  patchAccountDetails: (accountId: number, data: any) => patch<any>(`/accounts/${accountId}/details`, data),
  deleteAccountDetails: (accountId: number) => del(`/accounts/${accountId}/details`),
  getVendorHeatmap: (accountId: number) => get<import('./types').VendorHeatmap>(`/accounts/${accountId}/vendor-heatmap`),

  // Portable import/export (JSON bundles for cross-tenant moves).
  exportBundle: (slugs: string[]) => post<any>('/import-export/export', { slugs }),
  exportAccountBundle: (slug: string) => get<any>(`/import-export/accounts/${encodeURIComponent(slug)}`),
  importBundle: (bundle: any) => post<any>('/import-export/import', bundle),

  // Notes (timestamped markdown blurbs on an account, contact, or opportunity).
  getNotes: (target: { account_id?: number; contact_id?: number; opportunity_id?: number; limit?: number; offset?: number }) => {
    const qs = new URLSearchParams();
    if (target.account_id) qs.set('account_id', String(target.account_id));
    if (target.contact_id) qs.set('contact_id', String(target.contact_id));
    if (target.opportunity_id) qs.set('opportunity_id', String(target.opportunity_id));
    if (target.limit !== undefined) qs.set('limit', String(target.limit));
    if (target.offset !== undefined) qs.set('offset', String(target.offset));
    return get<{ notes: any[]; total: number }>(`/notes?${qs.toString()}`);
  },
  createNote: (data: { account_id?: number; contact_id?: number; opportunity_id?: number; body: string }) =>
    post<any>('/notes', data),
  patchNote: (id: number, data: { body?: string }) =>
    patch<any>(`/notes/${id}`, data),
  deleteNote: (id: number) =>
    del(`/notes/${id}`),

  // Agent provider config (per-user, server-persisted) — replaces the old
  // browser-localStorage state. Background workers read the same row so
  // they hit the same LLM the user has configured for the in-app agent.
  getAgentSettings: () =>
    get<{ provider: string | null; model: string | null; local_base_url: string | null; updated_at: string | null }>('/agent/settings'),
  patchAgentSettings: (data: { provider?: string | null; model?: string | null; local_base_url?: string | null }) =>
    patch<{ provider: string | null; model: string | null; local_base_url: string | null; updated_at: string | null }>('/agent/settings', data),

  // Internal domains (per-user) — domains belonging to the user's own
  // company. Used by the from-emails meeting flow to tag attendees from
  // these domains as kind=internal (skip account creation + research).
  listInternalDomains: () =>
    get<{ domains: Array<{ domain: string; created_at: string }> }>('/internal-domains'),
  addInternalDomain: (domain: string) =>
    post<{ domain: string; created_at: string }>('/internal-domains', { domain }),
  removeInternalDomain: (domain: string) =>
    del<{ domain: string; deleted: boolean }>(`/internal-domains/${encodeURIComponent(domain)}`),

  // Memories — per-user long-lived preferences/rules/facts the agent should
  // apply across sessions. Enabled rows are baked into the agent's system
  // prompt at session start; disabled rows stay in the DB but are skipped.
  listMemories: (params?: { enabled?: boolean; search?: string; limit?: number; offset?: number }) => {
    const qs = new URLSearchParams();
    if (params?.enabled !== undefined) qs.set('enabled', String(params.enabled));
    if (params?.search) qs.set('search', params.search);
    if (params?.limit !== undefined) qs.set('limit', String(params.limit));
    if (params?.offset !== undefined) qs.set('offset', String(params.offset));
    const q = qs.toString();
    return get<{ memories: Array<{ id: number; title: string | null; content: string; enabled: boolean; created_at: string; updated_at: string }>; total: number }>(`/memories${q ? '?' + q : ''}`);
  },
  createMemory: (data: { title?: string | null; content: string; enabled?: boolean }) =>
    post<{ id: number; title: string | null; content: string; enabled: boolean; created_at: string; updated_at: string }>('/memories', data),
  patchMemory: (id: number, data: { title?: string | null; content?: string; enabled?: boolean }) =>
    patch<{ id: number; title: string | null; content: string; enabled: boolean; created_at: string; updated_at: string }>(`/memories/${id}`, data),
  deleteMemory: (id: number) =>
    del<{ deleted: boolean; id: number }>(`/memories/${id}`),

  // Backups (instance-wide pg_dump scheduling and admin).
  getBackupSettings: () =>
    get<{ enabled: boolean; cron: string; retention_count: number; target_dir: string }>('/backup/settings'),
  updateBackupSettings: (patch: { enabled?: boolean; cron?: string; retention_count?: number; target_dir?: string }) =>
    put<any>('/backup/settings', patch),
  listBackups: () =>
    get<{ target_dir: string; backups: Array<{ filename: string; size_bytes: number; created_at: string }> }>('/backup'),
  runBackup: () => post<any>('/backup/run', {}),
  restoreBackup: (filename: string) => post<any>('/backup/restore', { filename }),
  deleteBackup: (filename: string) => del<any>(`/backup/${encodeURIComponent(filename)}`),
  backupDownloadUrl: (filename: string) => `/api/backup/download/${encodeURIComponent(filename)}`,
  importBackup: async (file: File) => {
    // Send the file as a raw octet-stream — the API streams it straight to disk
    // without buffering, so multi-GB dumps don't OOM the request handler.
    const res = await fetch(
      `/api/backup/import?filename=${encodeURIComponent(file.name)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: file,
      }
    );
    if (!res.ok) {
      const body = await res.text();
      let msg = `${res.status} ${res.statusText}`;
      try { msg = JSON.parse(body).error || msg; } catch {}
      throw new Error(msg);
    }
    return res.json() as Promise<{ filename: string; size_bytes: number; created_at: string; original_name: string | null; duration_ms: number }>;
  },

  // Themes — built-in palettes + user-authored custom themes, plus the
  // per-user "active theme" pointer. The GUI applies whichever theme is
  // active by injecting its theme_data as CSS custom properties on :root.
  listThemes: () =>
    get<{ themes: any[] }>('/themes'),
  getTheme: (id: number) =>
    get<any>(`/themes/${id}`),
  getActiveTheme: () =>
    get<{ active_theme_id: number | null; theme: any }>('/themes/active'),
  setActiveTheme: (theme_id: number | null) =>
    post<{ active_theme_id: number | null; theme: any }>('/themes/active', { theme_id }),
  createTheme: (data: { slug: string; name: string; description?: string | null; theme_data: any }) =>
    post<any>('/themes', data),
  patchTheme: (id: number, data: { slug?: string; name?: string; description?: string | null; theme_data?: any }) =>
    patch<any>(`/themes/${id}`, data),
  deleteTheme: (id: number) =>
    del<{ ok: boolean }>(`/themes/${id}`),

  // Health
  health: () => get<any>('/health'),
};
