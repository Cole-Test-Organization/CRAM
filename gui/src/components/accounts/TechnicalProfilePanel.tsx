import { createSignal, createResource, createMemo, For, Show, batch } from 'solid-js';
import { api } from '../../lib/api';
import { createAutoSave } from '../../lib/editing';
import type { AccountDetails, AccountDetailsVendorCategory, VendorProduct } from '../../lib/types';
import VendorProductPicker from './VendorProductPicker';
import VendorHeatmap from './VendorHeatmap';
import SaveIndicator from '../SaveIndicator';
import EditableMarkdown from '../EditableMarkdown';

type VendorRow = { category: AccountDetailsVendorCategory; idsField: keyof AccountDetails; productsField: keyof AccountDetails; label: string };

const VENDOR_ROWS: VendorRow[] = [
  { category: 'firewall',           idsField: 'firewall_ids',           productsField: 'firewall_products',           label: 'Firewall' },
  { category: 'edr',                idsField: 'edr_ids',                productsField: 'edr_products',                label: 'EDR' },
  { category: 'siem',               idsField: 'siem_ids',               productsField: 'siem_products',               label: 'SIEM' },
  { category: 'idp',                idsField: 'idp_ids',                productsField: 'idp_products',                label: 'Identity Provider' },
  { category: 'mfa',                idsField: 'mfa_ids',                productsField: 'mfa_products',                label: 'MFA' },
  { category: 'pam',                idsField: 'pam_ids',                productsField: 'pam_products',                label: 'PAM' },
  { category: 'email_security',     idsField: 'email_security_ids',     productsField: 'email_security_products',     label: 'Email Security' },
  { category: 'mdr',                idsField: 'mdr_ids',                productsField: 'mdr_products',                label: 'MDR' },
  { category: 'msp',                idsField: 'msp_ids',                productsField: 'msp_products',                label: 'MSP' },
  { category: 'sase',               idsField: 'sase_ids',               productsField: 'sase_products',               label: 'SASE' },
  { category: 'sdwan',              idsField: 'sdwan_ids',              productsField: 'sdwan_products',              label: 'SD-WAN' },
  { category: 'vpn',                idsField: 'vpn_ids',                productsField: 'vpn_products',                label: 'VPN' },
  { category: 'dlp',                idsField: 'dlp_ids',                productsField: 'dlp_products',                label: 'DLP' },
  { category: 'casb',               idsField: 'casb_ids',               productsField: 'casb_products',               label: 'CASB' },
  { category: 'vuln_mgmt',          idsField: 'vuln_mgmt_ids',          productsField: 'vuln_mgmt_products',          label: 'Vuln Mgmt' },
  { category: 'ticketing',          idsField: 'ticketing_ids',          productsField: 'ticketing_products',          label: 'Ticketing' },
  { category: 'productivity_suite', idsField: 'productivity_suite_ids', productsField: 'productivity_suite_products', label: 'Productivity Suite' },
  { category: 'cloud_provider',     idsField: 'cloud_provider_ids',     productsField: 'cloud_provider_products',     label: 'Cloud Provider' },
  { category: 'cspm',               idsField: 'cspm_ids',               productsField: 'cspm_products',               label: 'CSPM' },
  { category: 'appsec',             idsField: 'appsec_ids',             productsField: 'appsec_products',             label: 'AppSec' },
  { category: 'ndr',                idsField: 'ndr_ids',                productsField: 'ndr_products',                label: 'NDR' },
  { category: 'iot_ot',             idsField: 'iot_ot_ids',             productsField: 'iot_ot_products',             label: 'OT / IoT' },
  { category: 'ai_security',        idsField: 'ai_security_ids',        productsField: 'ai_security_products',        label: 'AI Security' },
];

const FIELD_CLASS = 'press-field';

// Empty profile shape used when an account hasn't had its details populated
// yet. Mirrors the columns in the migration; the API will create the row on
// first PATCH.
function emptyDetails(accountId: number): AccountDetails {
  const empty: any = {
    account_id: accountId,
    industry: null, revenue_usd: null, employee_count: null, user_count: null,
    endpoint_count: null, server_count: null, site_count: null, dc_count: null,
    hq_city: null, hq_state: null, hq_country: null,
    it_team_size: null, security_team_size: null,
    soc_model: null, compliance_frameworks: [],
    has_ot_environment: null, has_iot_environment: null,
    technical_notes: null, last_verified_at: null,
    created_at: '', updated_at: '',
  };
  for (const row of VENDOR_ROWS) {
    empty[row.idsField] = [];
    empty[row.productsField] = [];
  }
  return empty as AccountDetails;
}

type StackView = 'editor' | 'heatmap';

export default function TechnicalProfilePanel(props: { accountId: number }) {
  const [data, { refetch }] = createResource(() => props.accountId, async (id) => {
    const fetched = await api.getAccountDetails(id);
    return fetched || emptyDetails(id);
  });

  const [stackView, setStackView] = createSignal<StackView>('editor');

  const saver = createAutoSave(async (patch: any) => {
    await api.patchAccountDetails(props.accountId, patch);
  });

  // Local mutable shadow of the loaded row, so inputs stay responsive while
  // the debounced saver flushes. Re-derived whenever the resource refetches.
  const [local, setLocal] = createSignal<AccountDetails | null>(null);

  createMemo(() => {
    const d = data();
    if (d) setLocal(d);
  });

  const patchField = <K extends keyof AccountDetails>(key: K, value: AccountDetails[K]) => {
    const cur = local();
    if (!cur) return;
    setLocal({ ...cur, [key]: value });
    saver.save({ [key]: value });
  };

  const patchNow = <K extends keyof AccountDetails>(key: K, value: AccountDetails[K]) => {
    const cur = local();
    if (!cur) return;
    setLocal({ ...cur, [key]: value });
    saver.saveNow({ [key]: value });
  };

  const numericInput = (label: string, key: keyof AccountDetails, placeholder = '') => (
    <label class="block">
      <span class="block text-[10px] uppercase tracking-widest font-bold text-surf-300 mb-1">{label}</span>
      <input
        type="number"
        class={`${FIELD_CLASS} w-full`}
        placeholder={placeholder}
        value={(local()?.[key] as number | null) ?? ''}
        onInput={(e) => {
          const raw = e.currentTarget.value;
          const parsed = raw === '' ? null : Number(raw);
          patchField(key, parsed as AccountDetails[typeof key]);
        }}
      />
    </label>
  );

  const textInput = (label: string, key: keyof AccountDetails, placeholder = '') => (
    <label class="block">
      <span class="block text-[10px] uppercase tracking-widest font-bold text-surf-300 mb-1">{label}</span>
      <input
        type="text"
        class={`${FIELD_CLASS} w-full`}
        placeholder={placeholder}
        value={(local()?.[key] as string | null) ?? ''}
        onInput={(e) => patchField(key, (e.currentTarget.value || null) as AccountDetails[typeof key])}
      />
    </label>
  );

  return (
    <Show when={local()} fallback={<div class="text-base-300 p-10 text-center">Loading technical profile...</div>}>
      {(d) => (
        <div class="flex flex-col gap-4">
          <div class="flex justify-end">
            <SaveIndicator status={saver.status()} />
          </div>

          {/* ── Firmographics ────────────────────────────────────────── */}
          <div class="panel panel-accent p-5">
            <h3 class="text-[13px] font-bold uppercase tracking-widest text-surf-300 font-[family-name:var(--font-display)] mb-3">Firmographics</h3>
            <div class="grid grid-cols-1 gap-3 md:grid-cols-3">
              {textInput('Industry', 'industry', 'e.g. regional bank, health system')}
              {numericInput('Revenue (USD)', 'revenue_usd', 'e.g. 250000000')}
              {numericInput('Employees', 'employee_count')}
              {numericInput('IT Users', 'user_count')}
              {numericInput('Endpoints', 'endpoint_count')}
              {numericInput('Servers', 'server_count')}
              {numericInput('Sites', 'site_count')}
              {numericInput('Data Centers', 'dc_count')}
              {numericInput('IT Team', 'it_team_size')}
              {numericInput('Security Team', 'security_team_size')}
              {textInput('HQ City', 'hq_city')}
              {textInput('HQ State', 'hq_state')}
              {textInput('HQ Country', 'hq_country')}
            </div>
          </div>

          {/* ── Categorical ──────────────────────────────────────────── */}
          <div class="panel panel-accent p-5">
            <h3 class="text-[13px] font-bold uppercase tracking-widest text-surf-300 font-[family-name:var(--font-display)] mb-3">Security Posture</h3>
            <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
              <label class="block">
                <span class="block text-[10px] uppercase tracking-widest font-bold text-surf-300 mb-1">SOC Model</span>
                <select
                  class={`${FIELD_CLASS} w-full`}
                  value={d().soc_model || ''}
                  onChange={(e) => patchNow('soc_model', (e.currentTarget.value || null) as any)}
                >
                  <option value="">—</option>
                  <option value="in-house">In-house</option>
                  <option value="mssp">MSSP</option>
                  <option value="co-managed">Co-managed</option>
                  <option value="none">None</option>
                </select>
              </label>
              <label class="block">
                <span class="block text-[10px] uppercase tracking-widest font-bold text-surf-300 mb-1">Compliance Frameworks</span>
                <input
                  type="text"
                  class={`${FIELD_CLASS} w-full`}
                  placeholder="comma-separated, e.g. PCI, HIPAA, SOC2"
                  value={(d().compliance_frameworks || []).join(', ')}
                  onBlur={(e) => {
                    const parsed = e.currentTarget.value
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean);
                    patchNow('compliance_frameworks', parsed as any);
                  }}
                />
              </label>
              <label class="flex items-center gap-2">
                <input
                  type="checkbox"
                  class="accent-surf-400 w-4 h-4 cursor-pointer"
                  checked={!!d().has_ot_environment}
                  onChange={(e) => patchNow('has_ot_environment', e.currentTarget.checked as any)}
                />
                <span class="text-[11px] uppercase tracking-wider font-semibold">Has OT environment</span>
              </label>
              <label class="flex items-center gap-2">
                <input
                  type="checkbox"
                  class="accent-surf-400 w-4 h-4 cursor-pointer"
                  checked={!!d().has_iot_environment}
                  onChange={(e) => patchNow('has_iot_environment', e.currentTarget.checked as any)}
                />
                <span class="text-[11px] uppercase tracking-wider font-semibold">Has IoT environment</span>
              </label>
            </div>
          </div>

          {/* ── Vendor stack ─────────────────────────────────────────── */}
          <div class="panel panel-accent p-5">
            <div class="flex flex-col gap-3 mb-3 md:flex-row md:justify-between md:items-center">
              <h3 class="text-[13px] font-bold uppercase tracking-widest text-surf-300 font-[family-name:var(--font-display)]">Vendor Stack</h3>
              <div class="flex gap-0 border-2 border-base-600 w-fit">
                <button
                  type="button"
                  class={`px-3 py-1 text-[10px] uppercase tracking-widest font-bold transition-colors duration-150 ${
                    stackView() === 'editor'
                      ? 'bg-surf-500/20 text-surf-200'
                      : 'text-base-300 hover:text-base-50'
                  }`}
                  onClick={() => setStackView('editor')}
                >Editor</button>
                <button
                  type="button"
                  class={`px-3 py-1 text-[10px] uppercase tracking-widest font-bold border-l-2 border-base-600 transition-colors duration-150 ${
                    stackView() === 'heatmap'
                      ? 'bg-surf-500/20 text-surf-200'
                      : 'text-base-300 hover:text-base-50'
                  }`}
                  onClick={() => setStackView('heatmap')}
                >Heatmap</button>
              </div>
            </div>
            <Show when={stackView() === 'editor'}>
              <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
                <For each={VENDOR_ROWS}>
                  {(row) => (
                    <label class="block">
                      <span class="block text-[10px] uppercase tracking-widest font-bold text-surf-300 mb-1">{row.label}</span>
                      <VendorProductPicker
                        value={(d()[row.productsField] as VendorProduct[]) || []}
                        category={row.category}
                        onChange={(next) => {
                          batch(() => {
                            const ids = next.map((p) => p.id);
                            setLocal({ ...local()!, [row.idsField]: ids, [row.productsField]: next });
                            saver.saveNow({ [row.idsField]: ids });
                          });
                        }}
                      />
                    </label>
                  )}
                </For>
              </div>
            </Show>
            <Show when={stackView() === 'heatmap'}>
              <VendorHeatmap accountId={props.accountId} />
            </Show>
          </div>

          {/* ── Notes & verification ─────────────────────────────────── */}
          <div class="panel panel-accent p-5">
            <h3 class="text-[13px] font-bold uppercase tracking-widest text-surf-300 font-[family-name:var(--font-display)] mb-3">Technical Notes</h3>
            <EditableMarkdown
              content={d().technical_notes || ''}
              onSave={(val) => patchField('technical_notes', (val || null) as any)}
              status={saver.status()}
              rows={8}
              placeholder="Free-form technical prose. Things like 'Cisco FTD used as VPN only', 'SSL decryption deferred — firewalls sized for it', 'Firemon rebuild in progress, Oct renewal'. Don't put people/politics here — that's `relationship_summary` on the account."
            />
            <div class="mt-3">
              <label class="block">
                <span class="block text-[10px] uppercase tracking-widest font-bold text-surf-300 mb-1">Last Verified</span>
                <input
                  type="datetime-local"
                  class={`${FIELD_CLASS}`}
                  value={d().last_verified_at ? d().last_verified_at!.slice(0, 16) : ''}
                  onChange={(e) => {
                    const v = e.currentTarget.value;
                    patchNow('last_verified_at', (v ? new Date(v).toISOString() : null) as any);
                  }}
                />
              </label>
            </div>
          </div>
        </div>
      )}
    </Show>
  );
}
