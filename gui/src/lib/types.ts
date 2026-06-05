export interface Account {
  id: number;
  slug: string;
  name: string;
  status: string | null;
  last_contact: string | null;
  relationship_summary: string | null;
  active_deals: string | null;
  domains: string[] | null;
  open_thread_count?: number;
  created_at: string;
  updated_at: string;
}

export interface ThreadTask {
  id: number;
  thread_id: number;
  assignee_contact_id: number | null;
  assignee_full_name: string | null;
  title: string;
  description: string | null;
  due_date: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ThreadContact {
  id: number;
  full_name: string | null;
  company: string | null;
  title: string | null;
  email: string | null;
  kind: string;
}

export interface Thread {
  id: number;
  account_id: number;
  title: string;
  description: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
  tasks: ThreadTask[];
  contacts: ThreadContact[];
}

export interface Vendor {
  id: number;
  name: string;
  slug: string;
  website: string | null;
  notes: string | null;
  needs_review: boolean;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface VendorProduct {
  id: number;
  vendor_id: number;
  vendor_name: string;
  vendor_slug: string;
  name: string;
  slug: string;
  category: string;
  notes: string | null;
  needs_review: boolean;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export type AccountDetailsVendorCategory =
  | 'firewall' | 'edr' | 'siem' | 'idp' | 'mfa' | 'pam'
  | 'email_security' | 'mdr' | 'msp' | 'sase' | 'sdwan'
  | 'vpn' | 'dlp' | 'casb' | 'vuln_mgmt' | 'ticketing'
  | 'productivity_suite' | 'cloud_provider'
  | 'cspm' | 'appsec' | 'ndr' | 'iot_ot' | 'ai_security';

export interface AccountDetails {
  account_id: number;
  // firmographic
  industry: string | null;
  revenue_usd: number | null;
  employee_count: number | null;
  user_count: number | null;
  endpoint_count: number | null;
  server_count: number | null;
  site_count: number | null;
  dc_count: number | null;
  hq_city: string | null;
  hq_state: string | null;
  hq_country: string | null;
  it_team_size: number | null;
  security_team_size: number | null;
  // categorical
  soc_model: string | null;
  compliance_frameworks: string[];
  has_ot_environment: boolean | null;
  has_iot_environment: boolean | null;
  // vendor product arrays — raw IDs (write path)
  firewall_ids: number[];
  edr_ids: number[];
  siem_ids: number[];
  idp_ids: number[];
  mfa_ids: number[];
  pam_ids: number[];
  email_security_ids: number[];
  mdr_ids: number[];
  msp_ids: number[];
  sase_ids: number[];
  sdwan_ids: number[];
  vpn_ids: number[];
  dlp_ids: number[];
  casb_ids: number[];
  vuln_mgmt_ids: number[];
  ticketing_ids: number[];
  productivity_suite_ids: number[];
  cloud_provider_ids: number[];
  cspm_ids: number[];
  appsec_ids: number[];
  ndr_ids: number[];
  iot_ot_ids: number[];
  ai_security_ids: number[];
  // vendor product arrays — expanded (read path; populated by API)
  firewall_products?: VendorProduct[];
  edr_products?: VendorProduct[];
  siem_products?: VendorProduct[];
  idp_products?: VendorProduct[];
  mfa_products?: VendorProduct[];
  pam_products?: VendorProduct[];
  email_security_products?: VendorProduct[];
  mdr_products?: VendorProduct[];
  msp_products?: VendorProduct[];
  sase_products?: VendorProduct[];
  sdwan_products?: VendorProduct[];
  vpn_products?: VendorProduct[];
  dlp_products?: VendorProduct[];
  casb_products?: VendorProduct[];
  vuln_mgmt_products?: VendorProduct[];
  ticketing_products?: VendorProduct[];
  productivity_suite_products?: VendorProduct[];
  cloud_provider_products?: VendorProduct[];
  cspm_products?: VendorProduct[];
  appsec_products?: VendorProduct[];
  ndr_products?: VendorProduct[];
  iot_ot_products?: VendorProduct[];
  ai_security_products?: VendorProduct[];
  // prose + meta
  technical_notes: string | null;
  last_verified_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PartnerAccount {
  id: number;
  slug: string;
  name: string;
  status: string | null;
  contact_count?: number;
}

export interface AccountDetail extends Account {
  contacts: Contact[];
  meetings: MeetingSummary[];
  partners: PartnerAccount[];
}

export interface Contact {
  id: number;
  account_id?: number;
  full_name: string;
  company: string | null;
  title: string | null;
  email: string | null;
  phone: string | null;
  linkedin: string | null;
  notes: string | null;
  kind: 'account' | 'partner' | 'internal';
}

export interface MeetingSummary {
  id: number;
  account_id: number | null;
  date: string;
  // Precise event start/end as ISO 8601 timestamps. Null for notes-import rows
  // and hand-entered meetings with no time of day; the calendar import sets them
  // from the event's start/end. Used by the Today timeline.
  starts_at: string | null;
  ends_at: string | null;
  // Meeting location — for virtual meetings the conferencing URL (rendered as a
  // "Join" link on the Today timeline), for in-person a room/address. Null when
  // unknown; the calendar import sets it from the event location.
  location: string | null;
  title: string | null;
  filename: string;
  attendees: string | null;
  internal: boolean;
}

// Per-meeting RSVP / attendance, recorded on the meeting↔contact join row.
// null when unknown (notes-import rows, legacy events, contacts attached
// without a status).
export type AttendeeStatus = 'going' | 'declined' | 'maybe' | 'invited' | 'owner';

// A contact linked to a meeting, as returned on Meeting.contacts. Narrower than
// Contact (no kind/notes/account fields are sent on this shape) plus the
// per-meeting status.
export interface MeetingAttendee {
  id: number;
  full_name: string | null;
  company: string | null;
  title: string | null;
  email: string | null;
  phone: string | null;
  linkedin: string | null;
  status: AttendeeStatus | null;
}

// An attendee recorded on a meeting with no CRM contact yet (linkable later).
export interface UnlinkedAttendee {
  attendee_id: number;
  display_name: string | null;
  email: string | null;
  status: AttendeeStatus | null;
}

export interface Meeting extends MeetingSummary {
  body: string;
  account_slug: string | null;
  account_name: string | null;
  contacts?: MeetingAttendee[];
  unlinked_attendees?: UnlinkedAttendee[];
}

// A meeting in a contact's history (GET /api/contacts/:id → meetings[]), with
// this contact's per-meeting RSVP status.
export interface ContactMeeting {
  id: number;
  date: string;
  title: string | null;
  internal: boolean;
  needs_review: boolean;
  account_id: number | null;
  account_slug: string | null;
  account_name: string | null;
  status: AttendeeStatus | null;
}

export interface ProductCategory {
  id: number;
  name: string;
  created_at: string;
  updated_at: string;
  product_count?: number;
}

export interface Product {
  id: number;
  name: string;
  category_id: number | null;
  category_name?: string | null;
  created_at: string;
  updated_at: string;
}

export type { OpportunityStage } from './stages';
import type { OpportunityStage as _OppStage } from './stages';

export interface OpportunitySummary {
  id: number;
  account_id: number;
  name: string;
  opp_link: string | null;
  trr_link: string | null;
  tech_validation_link: string | null;
  stage: _OppStage;
  notes: string | null;
  why_change: string[];
  why_now: string[];
  why_us: string[];
  created_at: string;
  updated_at: string;
  account_name?: string;
  account_slug?: string;
  product_count?: number;
}

export interface OpportunityDetail extends OpportunitySummary {
  products: Array<{ id: number; name: string; category_id: number | null; category_name: string | null }>;
}

export type VendorHeatmapBucketKey = 'ai_security' | 'cloud' | 'identity' | 'network' | 'soc';

export interface VendorHeatmapCellProduct {
  id: number;
  name: string;
  vendor_id: number;
  vendor_name: string;
  vendor_slug: string;
}

export interface VendorHeatmapSubcategory {
  key: string;
  label: string;
  products: VendorHeatmapCellProduct[];
}

export interface VendorHeatmapBucket {
  key: VendorHeatmapBucketKey;
  label: string;
  subcategories: VendorHeatmapSubcategory[];
}

export interface VendorHeatmap {
  account_id: number;
  buckets: VendorHeatmapBucket[];
}

export interface SearchResults {
  results: {
    accounts?: Array<Account & { snippet: string; rank: number }>;
    contacts?: Array<Contact & { account_slug: string; account_name: string; snippet: string; rank: number }>;
    meetings?: Array<MeetingSummary & { account_slug: string | null; account_name: string | null; snippet: string; rank: number }>;
  };
  query: string;
  total: number;
}
