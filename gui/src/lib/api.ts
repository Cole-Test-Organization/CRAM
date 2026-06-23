const BASE = '/api';

// ── Notes-import job shapes (bulk directory/zip → meetings) ───────────────
export type NotesImportOutcome = 'linked' | 'created' | 'parked' | 'skipped' | 'error';

export type NotesImportResult = {
  path: string;
  ok: boolean;
  outcome: NotesImportOutcome;
  reason?: string | null; // 'internal' | 'ambiguous' | 'no_account_hint' | 'duplicate'
  meeting_id?: number;
  account_id?: number | null;
  account_slug?: string | null;
  account_created?: boolean;
  matched_by?: string | null;
  match_score?: number | null;
  candidates?: Array<{ id: number; slug: string; name: string; status?: string; score: number }> | null;
  note?: string;
  error?: string;
};

export type NotesImportJob = {
  jobId: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  stage: string | null;
  total: number;
  processed: number;
  counts: { linked: number; created: number; parked: number; skipped: number; error: number };
  results: NotesImportResult[];
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
};

// ── Provisioning / Homelab shapes ────────────────────────────────────────
export type ProvisioningJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';

export type ProvisioningDeploymentSummary = {
  id: string;
  configPath: string;
  name: string;
  provider: string | null;
  projectName: string | null;
  resourceKinds: string[];
  resourceCount: number;
  stepCount: number;
  deployable: boolean;
  /** Slug of the template this was cloned from; null when this row IS a catalog template. */
  templateName: string | null;
  /** Operator label — slug for templates, the typed name for instances. */
  displayName: string | null;
  /** True when this is a launchable blueprint (not a deployed instance). */
  isTemplate: boolean;
};

export type ProvisioningDeploymentDescriptor = ProvisioningDeploymentSummary & {
  providerProfile: string | null;
  resources: Array<{
    kind: string;
    name: string | null;
    hostname: string;
    provider: string | null;
  }>;
  steps: Array<{
    name: string;
    action: string;
    targets: string[];
    resourceAction?: string;
    description?: string;
    enabled?: boolean;
    when?: { param: string; enablesWhen: string | number | boolean };
  }>;
  inputs: Array<{
    name: string;
    label?: string;
    description?: string;
    type: 'string' | 'number' | 'boolean';
    default?: string | number | boolean;
    options?: Array<{ label: string; value: string | number | boolean }>;
    enablesWhen?: string | number | boolean;
    affectsSteps: string[];
    source: string;
  }>;
  requiredEnv: string[];
};

export type ProvisioningResource = {
  id: string;
  deploymentId: string;
  name: string | null;
  hostname: string;
  kind: string | null;
  lifecycleStatus: string;
  configPath: string;
  provider: string | null;
  vmId: number | null;
  providerResourceId: string | null;
  terraformStatePath: string | null;
  outputs: Record<string, unknown> | null;
  lastJobId: string | null;
  powerState: string | null;
  powerStateCheckedAt: string | null;
  updatedAt: string;
};

export type ProvisioningJob = {
  id: string;
  action: string;
  target: string | null;
  deployment: string | null;
  resourceAction: string | null;
  status: ProvisioningJobStatus;
  cancelRequested: boolean;
  params: Record<string, unknown> | null;
  error: string | null;
  createdAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  logs?: string[];
};

export type ProvisioningSecretSummary = {
  name: string;
  description: string | null;
  updatedAt: string;
};

export type ProvisioningRdpTunnel = {
  id: string;
  resourceId: string;
  hostname: string;
  providerResourceId: string;
  status: 'opening' | 'running' | 'closed';
  bindAddress: string;
  advertisedHost: string;
  publicPort: number;
  internalPort: number;
  remotePort: number;
  rdpEndpoint: string;
  username: string | null;
  startedAt: string;
  expiresAt: string | null;
  closedAt: string | null;
  closeReason: string | null;
  logs: string[];
};

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

  // Account-link management (contacts are many-to-many with accounts).
  linkContactAccount: (id: number, accountId: number) =>
    post<any>(`/contacts/${id}/accounts/${accountId}`, {}),

  unlinkContactAccount: (id: number, accountId: number) =>
    del<any>(`/contacts/${id}/accounts/${accountId}`),

  // Atomically move a contact's account link: link to_account_id and unlink
  // from_account_id (optional) in one step — fixes a contact imported onto the
  // wrong account without a transient orphaned state. Only moves the one named
  // link; other links are preserved.
  reassignContactAccount: (id: number, opts: { to_account_id: number; from_account_id?: number }) =>
    post<any>(`/contacts/${id}/reassign-account`, opts),

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

  createMeeting: (data: { account_id?: number; internal?: boolean; date: string; starts_at?: string | null; ends_at?: string | null; location?: string | null; title?: string; attendees?: string; contact_ids?: number[]; body: string }) =>
    post<any>(`/meetings`, data),

  updateMeeting: (id: number, data: any) =>
    put<any>(`/meetings/${id}`, data),

  deleteMeeting: (id: number) =>
    del(`/meetings/${id}`),

  // Triage: attach a parked (account-less, needs_review) note to an account.
  // Flips internal→false, sets account_id, and clears the review flag.
  assignMeetingAccount: (id: number, accountId: number) =>
    post<any>(`/meetings/${id}/assign-account`, { account_id: accountId }),

  // Move a meeting to a different account, or convert it to an internal note
  // (fix a bad import). Pass account_id to move it there; pass internal=true
  // (and omit account_id) to strip the account. Works on a meeting that already
  // has an account — unlike assignMeetingAccount, which is account-less only.
  reassignMeetingAccount: (id: number, opts: { account_id?: number; internal?: boolean }) =>
    post<any>(`/meetings/${id}/reassign-account`, opts),

  // Generic merge (object-agnostic; entity dispatched server-side). previewMerge
  // returns a plan (scalar/append fields + relation collections) for the resolver
  // UI; applyMerge commits the user's choices, tombstoning the source record.
  previewMerge: (entity: string, base_id: number, source_id: number) =>
    post<any>(`/merge/${entity}/preview`, { base_id, source_id }),

  applyMerge: (entity: string, base_id: number, source_id: number, choices: any) =>
    post<any>(`/merge/${entity}`, { base_id, source_id, choices }),

  // From-emails flow: resolve a list of attendee emails into known contacts +
  // account candidates, then submit the user's choices to create the meeting
  // (and optionally fire off background contact enrichment). The resolve step
  // now lives on the contacts surface (POST /api/contacts/resolve-emails) — it's
  // a contacts/accounts concern, shared with the no-meeting import path.
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
    }>('/contacts/resolve-emails', { emails }),

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
  mergeVendorProducts: (winner_id: number, loser_id: number) =>
    post<{ winner: any; loser: any; accounts_repointed: number }>('/vendor-products/merge', { winner_id, loser_id }),

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

  // Notes import — bulk-ingest a directory (or .zip) of notes. Each file is run
  // through the local model one at a time, then resolved to an account and
  // written as a meeting (linked, auto-created, or parked for triage). Async:
  // returns a jobId; poll getNotesImportJob until status is completed/failed.
  importNotes: (files: Array<{ path: string; content: string }>) =>
    post<{ jobId: string }>('/notes-import', { files }),
  importNotesZip: async (file: File) => {
    // Raw octet-stream like the backup upload — the API unpacks text entries
    // server-side. No Content-Type juggling, no multipart.
    const res = await fetch(`${BASE}/notes-import/upload-zip`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: file,
    });
    if (!res.ok) {
      const body = await res.text();
      let msg = `${res.status} ${res.statusText}`;
      try { msg = JSON.parse(body).error || msg; } catch {}
      throw new Error(msg);
    }
    return res.json() as Promise<{
      jobId: string;
      file_count: number;
      converted_count?: number;
      skipped_count?: number;
      summary?: unknown;
    }>;
  },
  getNotesImportJob: (jobId: string) =>
    get<NotesImportJob>(`/notes-import/jobs/${encodeURIComponent(jobId)}`),
  listNotesImportJobs: (params?: { status?: string; limit?: number }) => {
    const qs = new URLSearchParams();
    if (params?.status) qs.set('status', params.status);
    if (params?.limit !== undefined) qs.set('limit', String(params.limit));
    const q = qs.toString();
    return get<{ jobs: NotesImportJob[] }>(`/notes-import/jobs${q ? '?' + q : ''}`);
  },

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

  // Threads + tasks (open workstreams per account, each with steps + a contact
  // pool). Open-only by default; pass includeClosed for the full history.
  getThreads: (accountId: number, includeClosed = false) => {
    const qs = new URLSearchParams({ account_id: String(accountId) });
    if (includeClosed) qs.set('include_closed', 'true');
    return get<{ threads: import('./types').Thread[]; total: number }>(`/threads?${qs.toString()}`);
  },
  getThread: (id: number) =>
    get<import('./types').Thread>(`/threads/${id}`),
  createThread: (data: { account_id: number; title: string; description?: string | null; contact_ids?: number[] }) =>
    post<import('./types').Thread>('/threads', data),
  patchThread: (id: number, data: { title?: string; description?: string | null; closed?: boolean }) =>
    patch<import('./types').Thread>(`/threads/${id}`, data),
  deleteThread: (id: number) =>
    del<{ deleted: boolean; id: number }>(`/threads/${id}`),
  addThreadTask: (threadId: number, data: { title: string; description?: string | null; assignee_contact_id?: number | null; due_date?: string | null }) =>
    post<import('./types').ThreadTask>(`/threads/${threadId}/tasks`, data),
  patchThreadTask: (threadId: number, taskId: number, data: { title?: string; description?: string | null; assignee_contact_id?: number | null; due_date?: string | null; completed?: boolean }) =>
    patch<import('./types').ThreadTask>(`/threads/${threadId}/tasks/${taskId}`, data),
  deleteThreadTask: (threadId: number, taskId: number) =>
    del<{ deleted: boolean; id: number }>(`/threads/${threadId}/tasks/${taskId}`),
  linkThreadContact: (threadId: number, contactId: number) =>
    post<import('./types').Thread>(`/threads/${threadId}/contacts`, { contact_id: contactId }),
  unlinkThreadContact: (threadId: number, contactId: number) =>
    del<import('./types').Thread>(`/threads/${threadId}/contacts/${contactId}`),

  // Agent provider config (per-user, server-persisted) — replaces the old
  // browser-localStorage state. Background workers read the same row so
  // they hit the same LLM the user has configured for the in-app agent.
  getAgentSettings: () =>
    get<{ provider: string | null; model: string | null; local_base_url: string | null; system_prompt: string | null; default_system_prompt: string; updated_at: string | null }>('/agent/settings'),
  patchAgentSettings: (data: { provider?: string | null; model?: string | null; local_base_url?: string | null; system_prompt?: string | null }) =>
    patch<{ provider: string | null; model: string | null; local_base_url: string | null; system_prompt: string | null; default_system_prompt: string; updated_at: string | null }>('/agent/settings', data),

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

  // Backups (instance-wide pg_dump, on-demand).
  getBackupSettings: () =>
    get<{ retention_count: number; target_dir: string }>('/backup/settings'),
  updateBackupSettings: (patch: { retention_count?: number; target_dir?: string }) =>
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

  // Provisioning / Homelab (async Terraform-backed lifecycle).
  listProvisioningDeployments: () =>
    get<ProvisioningDeploymentSummary[]>('/provisioning/deployments'),
  getProvisioningDeployment: (id: string) =>
    get<ProvisioningDeploymentDescriptor>(`/provisioning/deployments/${encodeURIComponent(id)}`),
  listProvisioningResources: () =>
    get<ProvisioningResource[]>('/provisioning/resources'),
  getProvisioningResource: (id: string) =>
    get<ProvisioningResource>(`/provisioning/resources/${encodeURIComponent(id)}`),
  refreshProvisioningPowerState: (id: string) =>
    get<ProvisioningResource>(`/provisioning/resources/${encodeURIComponent(id)}/power-state`),
  startProvisioningResource: (id: string) =>
    post<ProvisioningResource>(`/provisioning/resources/${encodeURIComponent(id)}/start`, {}),
  stopProvisioningResource: (id: string) =>
    post<ProvisioningResource>(`/provisioning/resources/${encodeURIComponent(id)}/stop`, {}),
  deployProvisioningDeployment: (id: string, params?: Record<string, unknown>) =>
    post<ProvisioningJob>(`/provisioning/deployments/${encodeURIComponent(id)}/deploy`, { params: params ?? {} }),
  createProvisioningInstance: (templateId: string, name: string, params?: Record<string, unknown>) =>
    post<ProvisioningJob>(`/provisioning/deployments/${encodeURIComponent(templateId)}/instances`, { name, params: params ?? {} }),
  deleteProvisioningDeployment: (id: string) =>
    del<{ deleted: boolean }>(`/provisioning/deployments/${encodeURIComponent(id)}`),
  deprovisionProvisioningDeployment: (id: string, params?: Record<string, unknown>) =>
    post<ProvisioningJob>(`/provisioning/deployments/${encodeURIComponent(id)}/deprovision`, { params: params ?? {} }),
  downProvisioningResource: (id: string, params?: Record<string, unknown>) =>
    post<ProvisioningJob>(`/provisioning/resources/${encodeURIComponent(id)}/down`, { params: params ?? {} }),
  runProvisioningAction: (deploymentId: string, target: string, action: string, params?: Record<string, unknown>) =>
    post<ProvisioningJob>(`/provisioning/deployments/${encodeURIComponent(deploymentId)}/resources/${encodeURIComponent(target)}/actions/${encodeURIComponent(action)}`, { params: params ?? {} }),
  listProvisioningJobs: (params?: { status?: ProvisioningJobStatus; limit?: number }) => {
    const qs = new URLSearchParams();
    if (params?.status) qs.set('status', params.status);
    if (params?.limit !== undefined) qs.set('limit', String(params.limit));
    const q = qs.toString();
    return get<ProvisioningJob[]>(`/provisioning/jobs${q ? '?' + q : ''}`);
  },
  getProvisioningJob: (id: string) =>
    get<ProvisioningJob>(`/provisioning/jobs/${encodeURIComponent(id)}`),
  cancelProvisioningJob: (id: string) =>
    post<ProvisioningJob>(`/provisioning/jobs/${encodeURIComponent(id)}/cancel`, {}),
  listProvisioningRdpTunnels: () =>
    get<ProvisioningRdpTunnel[]>('/provisioning/tunnels'),
  openProvisioningRdpTunnel: (id: string, data?: { port?: number; remotePort?: number; ttlSeconds?: number }) =>
    post<ProvisioningRdpTunnel>(`/provisioning/resources/${encodeURIComponent(id)}/rdp-tunnel`, data ?? {}),
  closeProvisioningRdpTunnel: (id: string) =>
    del<ProvisioningRdpTunnel>(`/provisioning/tunnels/${encodeURIComponent(id)}`),
  closeProvisioningResourceRdpTunnel: (id: string) =>
    del<ProvisioningRdpTunnel>(`/provisioning/resources/${encodeURIComponent(id)}/rdp-tunnel`),
  listProvisioningSecrets: () =>
    get<ProvisioningSecretSummary[]>('/provisioning/secrets'),
  setProvisioningSecret: (name: string, data: { value: string; description?: string }) =>
    put<{ name: string }>(`/provisioning/secrets/${encodeURIComponent(name)}`, data),

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
