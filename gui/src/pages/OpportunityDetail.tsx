import { createResource, createSignal, For, Show } from 'solid-js';
import { A, useNavigate, useParams } from '@solidjs/router';
import { api } from '../lib/api';
import { OpportunityFormModal } from '../components/FormModals';
import Button from '../components/Button';
import NotesPanel from '../components/NotesPanel';
import { stageLabel, stageChipClass } from '../lib/stages';

// Vendor categories mirrored from TechnicalProfilePanel — used to flatten the
// account's technical profile into a Design of Record prompt without empty rows.
const DOR_VENDOR_ROWS: Array<[string, string]> = [
  ['firewall_products',           'Firewall'],
  ['edr_products',                'EDR'],
  ['siem_products',               'SIEM'],
  ['idp_products',                'Identity Provider'],
  ['mfa_products',                'MFA'],
  ['pam_products',                'PAM'],
  ['email_security_products',     'Email Security'],
  ['mdr_products',                'MDR'],
  ['msp_products',                'MSP'],
  ['sase_products',               'SASE'],
  ['sdwan_products',              'SD-WAN'],
  ['vpn_products',                'VPN'],
  ['dlp_products',                'DLP'],
  ['casb_products',               'CASB'],
  ['vuln_mgmt_products',          'Vuln Mgmt'],
  ['ticketing_products',          'Ticketing'],
  ['productivity_suite_products', 'Productivity Suite'],
  ['cloud_provider_products',     'Cloud Provider'],
  ['cspm_products',               'CSPM'],
  ['appsec_products',             'AppSec'],
  ['ndr_products',                'NDR'],
  ['iot_ot_products',             'OT / IoT'],
];

type WhyKey = 'why_change' | 'why_now' | 'why_us';
const WHY_COLS: Array<{ key: WhyKey; title: string }> = [
  { key: 'why_change', title: 'Why Change' },
  { key: 'why_now',    title: 'Why Now' },
  { key: 'why_us',     title: 'Why Us' },
];

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function OpportunityDetail() {
  const params = useParams();
  const navigate = useNavigate();
  const [editing, setEditing] = createSignal(false);
  const [showProductPicker, setShowProductPicker] = createSignal(false);
  const [drafts, setDrafts] = createSignal<Record<WhyKey, string>>({
    why_change: '',
    why_now: '',
    why_us: '',
  });

  const [opp, { refetch }] = createResource(
    () => params.id,
    (id) => api.getOpportunity(Number(id))
  );

  const addReason = async (key: WhyKey) => {
    const current = opp();
    if (!current) return;
    const text = drafts()[key].trim();
    if (!text) return;
    const next = [...(current[key] || []), text];
    await api.patchOpportunity(current.id, { [key]: next });
    setDrafts({ ...drafts(), [key]: '' });
    refetch();
  };

  const removeReason = async (key: WhyKey, idx: number) => {
    const current = opp();
    if (!current) return;
    const next = (current[key] || []).filter((_: string, i: number) => i !== idx);
    await api.patchOpportunity(current.id, { [key]: next });
    refetch();
  };

  const [allProducts] = createResource(() => showProductPicker(), async (open) => {
    if (!open) return null;
    const res = await api.getProducts({ limit: 500 });
    return res.products;
  });

  const linkProduct = async (productId: number) => {
    const current = opp();
    if (!current) return;
    await api.linkOppProduct(current.id, productId);
    refetch();
  };

  const unlinkProduct = async (productId: number) => {
    const current = opp();
    if (!current) return;
    await api.unlinkOppProduct(current.id, productId);
    refetch();
  };

  const handleDelete = async () => {
    const current = opp();
    if (!current) return;
    if (!confirm(`Delete opportunity "${current.name}"? This cannot be undone.`)) return;
    await api.deleteOpportunity(current.id);
    navigate('/opportunities');
  };

  const generateDor = async () => {
    const o = opp();
    if (!o) return;

    const [details, notesRes] = await Promise.all([
      api.getAccountDetails(o.account_id).catch(() => null),
      api.getNotes({ opportunity_id: o.id, limit: 500 }).catch(() => ({ notes: [] as any[], total: 0 })),
    ]);

    const lines: string[] = [];
    lines.push(`Generate a Design of Record for opportunity "${o.name}" on account "${o.account_name}" (slug: ${o.account_slug}).`);
    lines.push('');
    lines.push('Opportunity:');
    lines.push(`- Stage: ${stageLabel(o.stage)}`);
    if (o.opp_link) lines.push(`- Opp Link: ${o.opp_link}`);
    if (o.trr_link) lines.push(`- TRR Link: ${o.trr_link}`);
    if (o.tech_validation_link) lines.push(`- Tech Validation Link: ${o.tech_validation_link}`);
    const productNames = (o.products || []).map((p: any) => p.name);
    if (productNames.length) lines.push(`- Products: ${productNames.join(', ')}`);

    for (const [key, label] of [
      ['why_change', 'Why Change'],
      ['why_now',    'Why Now'],
      ['why_us',     'Why Us'],
    ] as const) {
      const reasons = (o[key] as string[]) || [];
      if (reasons.length) {
        lines.push(`- ${label}:`);
        for (const r of reasons) lines.push(`  - ${r}`);
      }
    }

    if (o.notes && String(o.notes).trim()) {
      lines.push('');
      lines.push('Opportunity Notes (inline):');
      lines.push(String(o.notes).trim());
    }

    const timestamped = (notesRes?.notes || []) as any[];
    if (timestamped.length) {
      lines.push('');
      lines.push('Opportunity Notes (timestamped):');
      for (const n of timestamped) {
        const ts = n.created_at ? new Date(n.created_at).toISOString().slice(0, 10) : '';
        lines.push(`- [${ts}] ${String(n.body || '').trim()}`);
      }
    }

    if (details) {
      lines.push('');
      lines.push('Account Technical Profile:');
      if (details.industry) lines.push(`- Industry: ${details.industry}`);
      if (details.revenue_usd != null) lines.push(`- Revenue (USD): ${details.revenue_usd}`);

      const sizes: string[] = [];
      if (details.employee_count != null) sizes.push(`employees ${details.employee_count}`);
      if (details.user_count != null) sizes.push(`users ${details.user_count}`);
      if (details.endpoint_count != null) sizes.push(`endpoints ${details.endpoint_count}`);
      if (details.server_count != null) sizes.push(`servers ${details.server_count}`);
      if (details.site_count != null) sizes.push(`sites ${details.site_count}`);
      if (details.dc_count != null) sizes.push(`data centers ${details.dc_count}`);
      if (sizes.length) lines.push(`- Size: ${sizes.join(', ')}`);

      const hq = [details.hq_city, details.hq_state, details.hq_country].filter(Boolean).join(', ');
      if (hq) lines.push(`- HQ: ${hq}`);

      const teams: string[] = [];
      if (details.it_team_size != null) teams.push(`IT ${details.it_team_size}`);
      if (details.security_team_size != null) teams.push(`Security ${details.security_team_size}`);
      if (teams.length) lines.push(`- Team sizes: ${teams.join(', ')}`);

      if (details.soc_model) lines.push(`- SOC Model: ${details.soc_model}`);
      if (Array.isArray(details.compliance_frameworks) && details.compliance_frameworks.length) {
        lines.push(`- Compliance: ${details.compliance_frameworks.join(', ')}`);
      }
      if (details.has_ot_environment) lines.push('- Has OT environment');
      if (details.has_iot_environment) lines.push('- Has IoT environment');

      const stack: string[] = [];
      for (const [field, label] of DOR_VENDOR_ROWS) {
        const products = (details[field] as any[]) || [];
        if (products.length) {
          const names = products.map((p: any) => {
            const vendor = p.vendor_name ? `${p.vendor_name} ` : '';
            return `${vendor}${p.name}`;
          });
          stack.push(`  - ${label}: ${names.join(', ')}`);
        }
      }
      if (stack.length) {
        lines.push('- Vendor Stack:');
        lines.push(...stack);
      }

      if (details.technical_notes && String(details.technical_notes).trim()) {
        lines.push('- Technical Notes:');
        lines.push(String(details.technical_notes).trim());
      }
    }

    lines.push('');
    lines.push('Design of Record — Information Requested:');
    lines.push("- What are the account's problems and pain points (specifically as they relate to this opportunity)?");
    lines.push("- Why haven't they been able to solve their problems/pain points with their current technology investments?");
    lines.push('- What use cases have you identified for this opportunity?');

    navigate('/agent', {
      state: {
        pendingPrompt: lines.join('\n'),
        returnTo: { label: o.name, href: `/opportunities/${o.id}` },
        // The agent has every fact it needs in the prompt above — no tool
        // calls expected. Forcing an empty toolset keeps it from wandering
        // off to fetch redundant context.
        allowedTools: [],
      },
    });
  };

  const availableProducts = () => {
    const current = opp();
    const all = allProducts() || [];
    const linkedIds = new Set((current?.products || []).map((p: any) => p.id));
    return all.filter((p: any) => !linkedIds.has(p.id));
  };

  return (
    <div>
      <div class="mb-4">
        <A href="/opportunities" class="text-base-400 text-[12px] uppercase tracking-wider hover:text-surf-300 transition-colors">
          ← Opportunities
        </A>
      </div>

      <Show when={!opp.loading} fallback={<div class="text-base-300 p-10 text-center">Loading...</div>}>
        <Show when={opp()} fallback={<div class="text-base-300 p-10 text-center">Opportunity not found.</div>}>
          {(o) => (
            <>
              <div class="flex flex-col gap-3 mb-6 md:flex-row md:justify-between md:items-start">
                <div class="flex-1 min-w-0">
                  <h1 class="text-[26px] font-bold font-[family-name:var(--font-display)] break-words">{o().name}</h1>
                  <div class="mt-2 flex items-center gap-3 flex-wrap">
                    <span class={`text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 border ${stageChipClass(o().stage)}`}>
                      {stageLabel(o().stage)}
                    </span>
                    <Show when={o().account_slug}>
                      <A href={`/accounts/${o().account_slug}`} class="text-surf-300 text-[13px] underline hover:text-surf-200">
                        {o().account_name}
                      </A>
                    </Show>
                  </div>
                </div>
                <div class="flex items-center gap-3 flex-wrap">
                  <Button variant="secondary" onClick={generateDor} title="Ask the agent to generate a Design of Record for this opportunity">Generate Design of Record</Button>
                  <Button variant="ghost" onClick={() => setEditing(true)}>Edit</Button>
                  <Button variant="danger" onClick={handleDelete}>Delete</Button>
                </div>
              </div>

              <div class="grid grid-cols-1 md:grid-cols-2 gap-5 mb-5">
                <div class="panel panel-accent p-4">
                  <div class="text-[10px] uppercase tracking-widest font-bold text-surf-300 mb-1">Created</div>
                  <div class="text-base-50 text-sm">{formatDate(o().created_at)}</div>
                </div>
                <div class="panel panel-accent p-4">
                  <div class="text-[10px] uppercase tracking-widest font-bold text-surf-300 mb-1">Opp Link</div>
                  <Show
                    when={o().opp_link}
                    fallback={<div class="text-base-400 text-[12px] italic">—</div>}
                  >
                    <a href={o().opp_link!} target="_blank" rel="noopener noreferrer" class="text-surf-300 text-sm underline break-all hover:text-surf-200">
                      {o().opp_link}
                    </a>
                  </Show>
                </div>
                <div class="panel panel-accent p-4">
                  <div class="text-[10px] uppercase tracking-widest font-bold text-surf-300 mb-1">TRR Link</div>
                  <Show
                    when={o().trr_link}
                    fallback={<div class="text-base-400 text-[12px] italic">—</div>}
                  >
                    <a href={o().trr_link!} target="_blank" rel="noopener noreferrer" class="text-surf-300 text-sm underline break-all hover:text-surf-200">
                      {o().trr_link}
                    </a>
                  </Show>
                </div>
                <div class="panel panel-accent p-4">
                  <div class="text-[10px] uppercase tracking-widest font-bold text-surf-300 mb-1">Tech Validation Link</div>
                  <Show
                    when={o().tech_validation_link}
                    fallback={<div class="text-base-400 text-[12px] italic">—</div>}
                  >
                    <a href={o().tech_validation_link!} target="_blank" rel="noopener noreferrer" class="text-surf-300 text-sm underline break-all hover:text-surf-200">
                      {o().tech_validation_link}
                    </a>
                  </Show>
                </div>
              </div>

              <div class="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
                <For each={WHY_COLS}>
                  {(col) => (
                    <div class="panel panel-accent p-4 flex flex-col gap-3">
                      <div class="text-[10px] uppercase tracking-widest font-bold text-surf-300">{col.title}</div>
                      <div class="flex flex-col gap-2 flex-1">
                        <For
                          each={(o()[col.key] as string[]) || []}
                          fallback={<div class="text-base-400 text-[12px] italic">No reasons yet.</div>}
                        >
                          {(reason, idx) => (
                            <div class="flex items-start justify-between gap-2 px-2 py-1.5 bg-base-950 border border-base-700">
                              <span class="text-base-100 text-sm break-words flex-1 whitespace-pre-wrap">{reason}</span>
                              <button
                                type="button"
                                class="btn-x flex-shrink-0"
                                aria-label={`Remove reason: ${reason}`}
                                onClick={() => removeReason(col.key, idx())}
                              >
                                &times;
                              </button>
                            </div>
                          )}
                        </For>
                      </div>
                      <form
                        class="flex gap-2"
                        onSubmit={(e) => { e.preventDefault(); addReason(col.key); }}
                      >
                        <input
                          type="text"
                          class="input-vintage flex-1 min-w-0"
                          placeholder="Add a reason…"
                          value={drafts()[col.key]}
                          onInput={(e) => setDrafts({ ...drafts(), [col.key]: e.currentTarget.value })}
                        />
                        <Button type="submit" variant="ghost" size="sm">Add</Button>
                      </form>
                    </div>
                  )}
                </For>
              </div>

              <Show when={o().notes}>
                <div class="panel panel-accent p-4 mb-5">
                  <div class="text-[10px] uppercase tracking-widest font-bold text-surf-300 mb-2">Notes</div>
                  <div class="text-base-100 text-sm whitespace-pre-wrap">{o().notes}</div>
                </div>
              </Show>

              <div class="panel panel-accent p-4">
                <div class="flex items-center justify-between mb-3 flex-wrap gap-2">
                  <div class="text-[10px] uppercase tracking-widest font-bold text-surf-300">
                    Products ({(o().products || []).length})
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => setShowProductPicker(!showProductPicker())}>
                    {showProductPicker() ? 'Close' : '+ Add Product'}
                  </Button>
                </div>

                <Show when={showProductPicker()}>
                  <div class="border-2 border-base-500 bg-base-950 p-2 mb-3 max-h-48 overflow-y-auto">
                    <Show when={!allProducts.loading} fallback={<div class="text-base-300 text-[12px] p-2">Loading...</div>}>
                      <Show
                        when={availableProducts().length > 0}
                        fallback={<div class="text-base-400 text-[12px] italic p-2">All products are already attached, or you have no products yet. <A href="/products" class="underline">Manage catalog</A>.</div>}
                      >
                        <For each={availableProducts()}>
                          {(p: any) => (
                            <button
                              type="button"
                              class="w-full text-left px-2 py-1.5 text-sm text-base-50 hover:bg-base-800 transition-colors flex items-center justify-between gap-3"
                              onClick={() => linkProduct(p.id)}
                            >
                              <span>{p.name}</span>
                              <Show when={p.category_name}>
                                <span class="text-[10px] uppercase tracking-wider text-base-400">{p.category_name}</span>
                              </Show>
                            </button>
                          )}
                        </For>
                      </Show>
                    </Show>
                  </div>
                </Show>

                <Show
                  when={(o().products || []).length > 0}
                  fallback={<div class="text-base-400 text-[12px] italic">No products attached.</div>}
                >
                  <div class="flex flex-col gap-2">
                    <For each={o().products || []}>
                      {(p: any) => (
                        <div class="flex items-center justify-between gap-3 px-3 py-2 bg-base-950 border border-base-700">
                          <div class="flex items-center gap-3 flex-wrap min-w-0">
                            <span class="text-base-50 text-sm font-semibold truncate">{p.name}</span>
                            <Show when={p.category_name}>
                              <span class="text-[10px] uppercase tracking-wider text-base-400">{p.category_name}</span>
                            </Show>
                          </div>
                          <button
                            type="button"
                            class="btn-x"
                            aria-label={`Remove ${p.name}`}
                            onClick={() => unlinkProduct(p.id)}
                          >
                            &times;
                          </button>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
              </div>

              <div class="mt-5">
                <NotesPanel target={{ opportunity_id: o().id }} inlineCompose />
              </div>

              <OpportunityFormModal
                open={editing()}
                onClose={() => setEditing(false)}
                existing={o()}
                onSaved={() => refetch()}
              />
            </>
          )}
        </Show>
      </Show>
    </div>
  );
}
