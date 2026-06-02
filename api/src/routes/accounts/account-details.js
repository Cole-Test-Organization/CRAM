// Account details — 1-1 with accounts. Holds the typed tech profile
// (firmographics, vendor product references, technical notes) that replaced
// the old accounts.environment JSONB blob.

const PATCH_BODY = {
  type: 'object',
  properties: {
    // firmographic
    industry: { type: 'string', nullable: true },
    revenue_usd: { type: 'integer', nullable: true },
    employee_count: { type: 'integer', nullable: true },
    user_count: { type: 'integer', nullable: true },
    endpoint_count: { type: 'integer', nullable: true },
    server_count: { type: 'integer', nullable: true },
    site_count: { type: 'integer', nullable: true },
    dc_count: { type: 'integer', nullable: true },
    hq_city: { type: 'string', nullable: true },
    hq_state: { type: 'string', nullable: true },
    hq_country: { type: 'string', nullable: true },
    it_team_size: { type: 'integer', nullable: true },
    security_team_size: { type: 'integer', nullable: true },
    // categorical
    soc_model: { type: 'string', nullable: true, description: 'in-house, mssp, co-managed, none, ...' },
    compliance_frameworks: { type: 'array', items: { type: 'string' }, description: 'e.g. PCI, HIPAA, SOC2, FFIEC' },
    has_ot_environment: { type: 'boolean', nullable: true },
    has_iot_environment: { type: 'boolean', nullable: true },
    // vendor product arrays (each element is vendor_products.id)
    firewall_ids:       { type: 'array', items: { type: 'integer' } },
    edr_ids:            { type: 'array', items: { type: 'integer' } },
    siem_ids:           { type: 'array', items: { type: 'integer' } },
    idp_ids:            { type: 'array', items: { type: 'integer' } },
    mfa_ids:            { type: 'array', items: { type: 'integer' } },
    pam_ids:            { type: 'array', items: { type: 'integer' } },
    email_security_ids: { type: 'array', items: { type: 'integer' } },
    mdr_ids:            { type: 'array', items: { type: 'integer' } },
    msp_ids:            { type: 'array', items: { type: 'integer' } },
    sase_ids:           { type: 'array', items: { type: 'integer' } },
    sdwan_ids:          { type: 'array', items: { type: 'integer' } },
    vpn_ids:            { type: 'array', items: { type: 'integer' } },
    dlp_ids:            { type: 'array', items: { type: 'integer' } },
    casb_ids:           { type: 'array', items: { type: 'integer' } },
    vuln_mgmt_ids:      { type: 'array', items: { type: 'integer' } },
    ticketing_ids:      { type: 'array', items: { type: 'integer' } },
    productivity_suite_ids: { type: 'array', items: { type: 'integer' } },
    cloud_provider_ids:     { type: 'array', items: { type: 'integer' } },
    cspm_ids:               { type: 'array', items: { type: 'integer' } },
    appsec_ids:             { type: 'array', items: { type: 'integer' } },
    ndr_ids:                { type: 'array', items: { type: 'integer' } },
    iot_ot_ids:             { type: 'array', items: { type: 'integer' } },
    ai_security_ids:        { type: 'array', items: { type: 'integer' } },
    // prose + meta
    technical_notes: { type: 'string', nullable: true },
    last_verified_at: { type: 'string', format: 'date-time', nullable: true },
  },
};

export default async function accountDetailsRoutes(fastify, { accountDetailsService, vendorHeatmapService }) {
  fastify.get('/accounts/:accountId/details', {
    schema: {
      description: 'Get the technical profile for an account. Returns null fields if no row exists yet; each *_ids array is also expanded into a *_products array of resolved {id, name, vendor_name, vendor_slug, category} objects.',
      tags: ['account-details'],
      params: { type: 'object', properties: { accountId: { type: 'integer' } } },
    },
  }, async (request, reply) => {
    const details = await accountDetailsService.getByAccountId(request.userId, request.params.accountId);
    if (!details) { reply.code(404); return { error: 'No account_details row for this account yet' }; }
    return details;
  });

  fastify.get('/accounts/:accountId/vendor-heatmap', {
    schema: {
      description: 'Per-account vendor heatmap. Aggregates the vendor product references on account_details into 5 portfolio buckets (ai_security, cloud, identity, network, soc) and returns rows = vendors, cells = products in each bucket. Empty when no account_details row exists or the row has no vendor products yet.',
      tags: ['account-details'],
      params: { type: 'object', properties: { accountId: { type: 'integer' } } },
    },
  }, async (request) => {
    return vendorHeatmapService.getByAccountId(request.userId, request.params.accountId);
  });

  fastify.patch('/accounts/:accountId/details', {
    schema: {
      description: 'Upsert the account_details row. PATCH semantics: only fields present in the body are touched. Array fields are fully replaced when present (pass [] to clear).',
      tags: ['account-details'],
      params: { type: 'object', properties: { accountId: { type: 'integer' } } },
      body: PATCH_BODY,
    },
  }, async (request, reply) => {
    try {
      const details = await accountDetailsService.upsert(request.userId, request.params.accountId, request.body || {});
      return details;
    } catch (err) {
      if (err.statusCode) { reply.code(err.statusCode); return { error: err.message }; }
      throw err;
    }
  });

  fastify.delete('/accounts/:accountId/details', {
    schema: {
      description: 'Delete the account_details row (returns the account to a no-tech-profile state).',
      tags: ['account-details'],
      params: { type: 'object', properties: { accountId: { type: 'integer' } } },
    },
  }, async (request, reply) => {
    const deleted = await accountDetailsService.delete(request.userId, request.params.accountId);
    if (!deleted) { reply.code(404); return { error: 'No account_details row for this account' }; }
    return { deleted: true };
  });
}
