// Dev-only seed: creates a coherent set of customer accounts, partner accounts,
// contacts, partnerships, opportunities, and meetings via the running API.
//
// Two ways to invoke:
//   1. From the host:  node dev/scripts/seed-dev-data.js
//   2. From compose:   docker compose --profile dev --profile seed up
//
// Idempotency: if accounts already exist, the script exits with a warning so it
// never silently appends to a populated DB. To refresh, TRUNCATE first.

const API = process.env.API_BASE || 'http://localhost:3200/api';

async function waitForApi(maxAttempts = 60, delayMs = 1000) {
	for (let i = 0; i < maxAttempts; i++) {
		try {
			const res = await fetch(`${API}/health`);
			if (res.ok) {
				const body = await res.json();
				if (body.counts && body.counts.accounts > 0) {
					console.error(`API already has ${body.counts.accounts} account(s) + ${body.counts.contacts} contact(s). Refusing to seed on top of existing data — TRUNCATE first.`);
					process.exit(1);
				}
				return;
			}
		} catch {
			// API not up yet — keep polling
		}
		if (i === 0) console.log(`Waiting for API at ${API}…`);
		await new Promise(r => setTimeout(r, delayMs));
	}
	throw new Error(`API at ${API} never came up after ${maxAttempts} attempts`);
}

async function post(path, body) {
	const res = await fetch(`${API}${path}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	});
	if (!res.ok) {
		const text = await res.text();
		throw new Error(`POST ${path} → ${res.status}: ${text}`);
	}
	return res.json();
}

async function patch(path, body) {
	const res = await fetch(`${API}${path}`, {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	});
	if (!res.ok) {
		const text = await res.text();
		throw new Error(`PATCH ${path} → ${res.status}: ${text}`);
	}
	return res.json();
}

// Loads the seeded vendor_products catalog and returns a lookup object whose
// `ids(...keys)` method resolves "vendor-slug/product-slug" strings to the
// numeric vendor_products.id values that account_details.*_ids columns expect.
// Throws if any referenced product is missing — keeps us honest with the
// catalog migrations (1000000000014_seed-vendor-catalog).
async function loadVendorProductCatalog() {
	const res = await fetch(`${API}/vendor-products?limit=500`);
	if (!res.ok) throw new Error(`Failed to load vendor product catalog: ${res.status}`);
	const { products } = await res.json();
	const map = new Map();
	for (const p of products) map.set(`${p.vendor_slug}/${p.slug}`, p.id);
	return {
		ids(...keys) {
			return keys.map(k => {
				const id = map.get(k);
				if (!id) throw new Error(`Unknown vendor_product "${k}" — not seeded in vendor catalog`);
				return id;
			});
		},
	};
}

function daysFromNow(n) {
	const d = new Date();
	d.setDate(d.getDate() + n);
	return d.toISOString().slice(0, 10);
}

const customers = [
	{ slug: 'acme-manufacturing', name: 'Acme Manufacturing', domains: ['acmemfg.com'], summary: 'Mid-market manufacturer evaluating EDR + SOC consolidation. Active POV on next-gen endpoint.' },
	{ slug: 'riverstone-health', name: 'Riverstone Health System', domains: ['riverstonehealth.org'], summary: 'Regional hospital network, HIPAA-driven. Replacing legacy AV across 14 sites.' },
	{ slug: 'blueoak-financial', name: 'BlueOak Financial', domains: ['blueoakfinancial.com'], summary: 'Community bank, FFIEC compliance focus. SOC outsourcing decision in Q3.' },
	{ slug: 'northland-credit-union', name: 'Northland Credit Union', domains: ['northlandcu.org'], summary: 'Credit union, ~80k members. Evaluating MDR options.' },
	{ slug: 'pearl-mining-logistics', name: 'Pearl Mining Logistics', domains: ['pearlmininglog.com'], summary: 'OT-heavy logistics operator. Looking at network segmentation + OT visibility.' },
	{ slug: 'cascade-insurance', name: 'Cascade Insurance', domains: ['cascadeinsurance.com'], summary: 'Regional insurer. Renewed cyber insurance pushed MFA hardening to top of list.' },
	{ slug: 'sentinel-aerospace', name: 'Sentinel Aerospace', domains: ['sentinelaero.com'], summary: 'Aerospace supplier, CMMC L2 in scope. Boundary protection rip-and-replace likely.' },
	{ slug: 'granite-state-university', name: 'Granite State University', domains: ['granitestate.edu'], summary: 'Public university, ~22k students. Phishing-driven account compromise pattern, looking at email security upgrade.' },
	{ slug: 'meridian-telecom', name: 'Meridian Telecom', domains: ['meridiantelecom.net'], summary: 'Regional MSP/telecom. They sell SASE to SMB and want a new upstream platform.' },
	{ slug: 'harbormaster-logistics', name: 'Harbormaster Logistics', domains: ['harbormasterlogistics.com'], summary: 'Freight forwarder, port-heavy footprint. Recently breached; rebuilding from the ground up.' },
];

const partners = [
	{ slug: 'cdw', name: 'CDW', domains: ['cdw.com'], active_deals: 'Acme POV (open), Riverstone renewal Q4.' },
	{ slug: 'trace3', name: 'Trace3', domains: ['trace3.com'], active_deals: 'Sentinel CMMC engagement.' },
	{ slug: 'guidepoint-security', name: 'GuidePoint Security', domains: ['guidepointsecurity.com'], active_deals: 'BlueOak MDR eval, Northland workshop scheduled.' },
	{ slug: 'optiv', name: 'Optiv', domains: ['optiv.com'], active_deals: 'Pearl Mining OT assessment.' },
	{ slug: 'shi-international', name: 'SHI International', domains: ['shi.com'], active_deals: 'Granite State email security renewal.' },
];

const contactsByCustomerSlug = {
	'acme-manufacturing': [
		{ full_name: 'Diane Yu', title: 'CISO', email: 'diane.yu@acmemfg.com', city: 'Cleveland', state: 'OH', country: 'USA' },
		{ full_name: 'Marcus Tate', title: 'IT Director', email: 'marcus.tate@acmemfg.com', city: 'Cleveland', state: 'OH', country: 'USA' },
		{ full_name: 'Priya Shah', title: 'Security Engineer', email: 'priya.shah@acmemfg.com', city: 'Cleveland', state: 'OH', country: 'USA' },
	],
	'riverstone-health': [
		{ full_name: 'Lena Carter', title: 'VP Information Security', email: 'lena.carter@riverstonehealth.org', city: 'Columbus', state: 'OH', country: 'USA' },
		{ full_name: 'Aaron Klein', title: 'Network Operations Manager', email: 'aaron.klein@riverstonehealth.org', city: 'Columbus', state: 'OH', country: 'USA' },
	],
	'blueoak-financial': [
		{ full_name: 'Sandra Phelps', title: 'CISO', email: 'sphelps@blueoakfinancial.com', city: 'Charlotte', state: 'NC', country: 'USA' },
		{ full_name: 'Owen Bartlett', title: 'Director of IT', email: 'obartlett@blueoakfinancial.com', city: 'Charlotte', state: 'NC', country: 'USA' },
	],
	'northland-credit-union': [
		{ full_name: 'Kimberly Anders', title: 'Information Security Officer', email: 'kanders@northlandcu.org', city: 'Minneapolis', state: 'MN', country: 'USA' },
		{ full_name: 'Devon Park', title: 'Sysadmin', email: 'dpark@northlandcu.org', city: 'Minneapolis', state: 'MN', country: 'USA' },
	],
	'pearl-mining-logistics': [
		{ full_name: 'Wendy Ortiz', title: 'CIO', email: 'wortiz@pearlmininglog.com', city: 'Salt Lake City', state: 'UT', country: 'USA' },
		{ full_name: 'Jason McNeil', title: 'OT/ICS Lead', email: 'jmcneil@pearlmininglog.com', city: 'Salt Lake City', state: 'UT', country: 'USA' },
		{ full_name: 'Theresa Liu', title: 'Network Engineer', email: 'tliu@pearlmininglog.com', city: 'Salt Lake City', state: 'UT', country: 'USA' },
	],
	'cascade-insurance': [
		{ full_name: 'Henry Beck', title: 'Director of Cybersecurity', email: 'hbeck@cascadeinsurance.com', city: 'Portland', state: 'OR', country: 'USA' },
		{ full_name: 'Olivia Reeves', title: 'IAM Architect', email: 'oreeves@cascadeinsurance.com', city: 'Portland', state: 'OR', country: 'USA' },
	],
	'sentinel-aerospace': [
		{ full_name: 'Raj Patel', title: 'CISO', email: 'rpatel@sentinelaero.com', city: 'Huntsville', state: 'AL', country: 'USA' },
		{ full_name: 'Catherine Wu', title: 'Compliance Lead', email: 'cwu@sentinelaero.com', city: 'Huntsville', state: 'AL', country: 'USA' },
	],
	'granite-state-university': [
		{ full_name: 'Brian Halloway', title: 'CISO', email: 'b.halloway@granitestate.edu', city: 'Manchester', state: 'NH', country: 'USA' },
		{ full_name: 'Jessica Moreno', title: 'Email & Collaboration Admin', email: 'j.moreno@granitestate.edu', city: 'Manchester', state: 'NH', country: 'USA' },
	],
	'meridian-telecom': [
		{ full_name: 'Tyler Boyd', title: 'VP Engineering', email: 'tboyd@meridiantelecom.net', city: 'Austin', state: 'TX', country: 'USA' },
		{ full_name: 'Nadia Aslam', title: 'Director of Security Services', email: 'naslam@meridiantelecom.net', city: 'Austin', state: 'TX', country: 'USA' },
	],
	'harbormaster-logistics': [
		{ full_name: 'Greg Lindstrom', title: 'Interim CISO', email: 'glindstrom@harbormasterlogistics.com', city: 'Long Beach', state: 'CA', country: 'USA' },
		{ full_name: 'Sasha Romero', title: 'IR Lead', email: 'sromero@harbormasterlogistics.com', city: 'Long Beach', state: 'CA', country: 'USA' },
	],
};

const contactsByPartnerSlug = {
	'cdw': [
		{ full_name: 'Ron Bechtel', title: 'Account Executive', email: 'ron.bechtel@cdw.com', kind: 'partner' },
		{ full_name: 'Megan Sosa', title: 'Solutions Architect', email: 'megan.sosa@cdw.com', kind: 'partner' },
	],
	'trace3': [
		{ full_name: 'Vince Marek', title: 'Client Director', email: 'vince.marek@trace3.com', kind: 'partner' },
		{ full_name: 'Jasmine Coyle', title: 'Cybersecurity Practice Lead', email: 'jasmine.coyle@trace3.com', kind: 'partner' },
	],
	'guidepoint-security': [
		{ full_name: 'Mike Donato', title: 'Regional Sales Manager', email: 'mdonato@guidepointsecurity.com', kind: 'partner' },
	],
	'optiv': [
		{ full_name: 'Erin Forrest', title: 'Senior Account Manager', email: 'eforrest@optiv.com', kind: 'partner' },
	],
	'shi-international': [
		{ full_name: 'Doug Petrov', title: 'Account Executive', email: 'doug.petrov@shi.com', kind: 'partner' },
	],
};

const internalContacts = [
	{ full_name: 'Alex Munro', title: 'Regional Sales Manager', email: 'amunro@vendor.local', kind: 'internal' },
	{ full_name: 'Carla Ng', title: 'Customer Success Manager', email: 'cng@vendor.local', kind: 'internal' },
	{ full_name: 'Tom Iverson', title: 'Principal Solutions Architect', email: 'tiverson@vendor.local', kind: 'internal' },
];

// (customer slug → list of partner slugs to link)
const partnerships = {
	'acme-manufacturing': ['cdw'],
	'riverstone-health': ['cdw'],
	'blueoak-financial': ['guidepoint-security'],
	'northland-credit-union': ['guidepoint-security'],
	'sentinel-aerospace': ['trace3'],
	'pearl-mining-logistics': ['optiv'],
	'granite-state-university': ['shi-international'],
};

// Technical profiles per customer account. Completeness varies on purpose so
// queries can exercise both well-profiled and sparse accounts. All vendor
// product slugs below must exist in the seeded vendor catalog (see migration
// 1000000000014_seed-vendor-catalog) — loadVendorProductCatalog() will throw
// if any reference is missing.
function buildAccountDetailsByCustomer(vp) {
	const today = new Date().toISOString();
	return {
		'acme-manufacturing': {
			industry: 'Manufacturing',
			revenue_usd: 850000000,
			employee_count: 3500,
			user_count: 3200,
			endpoint_count: 3200,
			server_count: 145,
			site_count: 5,
			hq_city: 'Cleveland', hq_state: 'OH', hq_country: 'USA',
			it_team_size: 12,
			security_team_size: 3,
			soc_model: 'in-house',
			compliance_frameworks: ['ISO 27001'],
			has_ot_environment: true,
			has_iot_environment: false,
			firewall_ids: vp.ids('cisco/firepower-ngfw'),
			edr_ids: vp.ids('broadcom/symantec-endpoint-protection'),
			vpn_ids: vp.ids('cisco/anyconnect'),
			mfa_ids: vp.ids('microsoft/microsoft-authenticator'),
			idp_ids: vp.ids('microsoft/entra-id'),
			productivity_suite_ids: vp.ids('microsoft/microsoft-365'),
			email_security_ids: vp.ids('microsoft/defender-for-office-365'),
			technical_notes: 'Mixed Windows/macOS (~70/30). Legacy AV missing fileless threats — driver for the active XDR POV. Plant floor has a flat L2 OT segment that needs follow-up after EDR lands.',
			last_verified_at: today,
		},
		'riverstone-health': {
			industry: 'Healthcare',
			revenue_usd: 1500000000,
			employee_count: 6200,
			user_count: 5500,
			endpoint_count: 4800,
			server_count: 310,
			site_count: 14,
			dc_count: 2,
			hq_city: 'Columbus', hq_state: 'OH', hq_country: 'USA',
			it_team_size: 35,
			security_team_size: 6,
			soc_model: 'co-managed',
			compliance_frameworks: ['HIPAA', 'HITRUST'],
			has_ot_environment: false,
			has_iot_environment: true,
			firewall_ids: vp.ids('fortinet/fortigate'),
			edr_ids: vp.ids('trend-micro/apex-one'),
			mfa_ids: vp.ids('cisco/duo'),
			idp_ids: vp.ids('microsoft/entra-id'),
			productivity_suite_ids: vp.ids('microsoft/microsoft-365'),
			email_security_ids: vp.ids('mimecast/mimecast-email-security'),
			mdr_ids: vp.ids('arctic-wolf/arctic-wolf-mdr'),
			siem_ids: vp.ids('splunk/splunk-enterprise-security'),
			vuln_mgmt_ids: vp.ids('tenable/nessus'),
			technical_notes: 'Hospital floors run Citrix VDA (~2,800 sessions). Legacy AV contract expires October 2026 — replacement is the active deal. Medical devices on isolated VLANs but no formal IoT inventory.',
			last_verified_at: today,
		},
		'blueoak-financial': {
			industry: 'Financial Services',
			revenue_usd: 320000000,
			employee_count: 820,
			user_count: 780,
			endpoint_count: 910,
			server_count: 78,
			site_count: 22,
			hq_city: 'Charlotte', hq_state: 'NC', hq_country: 'USA',
			it_team_size: 14,
			security_team_size: 4,
			soc_model: 'in-house',
			compliance_frameworks: ['FFIEC', 'PCI DSS', 'SOC 2', 'GLBA'],
			firewall_ids: vp.ids('cisco/firepower-ngfw'),
			edr_ids: vp.ids('crowdstrike/falcon-insight-xdr'),
			mfa_ids: vp.ids('okta/okta-verify'),
			idp_ids: vp.ids('okta/workforce-identity-cloud'),
			productivity_suite_ids: vp.ids('microsoft/microsoft-365'),
			email_security_ids: vp.ids('proofpoint/email-protection'),
			siem_ids: vp.ids('splunk/splunk-enterprise-security'),
			vuln_mgmt_ids: vp.ids('rapid7/insightvm'),
			ticketing_ids: vp.ids('servicenow/servicenow-itsm'),
			technical_notes: 'Branch fleet on Cisco ISR/Firepower combo. SOC analyst turnover prompted the MDR eval — current Splunk content built in-house. FFIEC exam in Q3 is forcing prioritization.',
			last_verified_at: today,
		},
		'northland-credit-union': {
			industry: 'Financial Services',
			revenue_usd: 95000000,
			employee_count: 285,
			user_count: 270,
			endpoint_count: 340,
			site_count: 9,
			hq_city: 'Minneapolis', hq_state: 'MN', hq_country: 'USA',
			it_team_size: 6,
			security_team_size: 1,
			soc_model: 'none',
			compliance_frameworks: ['NCUA', 'PCI DSS'],
			firewall_ids: vp.ids('sonicwall/tz-series'),
			edr_ids: vp.ids('sophos/intercept-x'),
			mfa_ids: vp.ids('cisco/duo'),
			productivity_suite_ids: vp.ids('microsoft/microsoft-365'),
			email_security_ids: vp.ids('microsoft/defender-for-office-365'),
			technical_notes: 'No after-hours coverage today; phishing incident in March went undetected for 4 days. Lean team — MDR pitched as alternative to hiring a second analyst.',
		},
		'pearl-mining-logistics': {
			industry: 'Mining & Logistics',
			revenue_usd: 680000000,
			employee_count: 1850,
			user_count: 1100,
			endpoint_count: 1100,
			server_count: 118,
			site_count: 7,
			hq_city: 'Salt Lake City', hq_state: 'UT', hq_country: 'USA',
			it_team_size: 18,
			security_team_size: 2,
			soc_model: 'mssp',
			compliance_frameworks: ['NIST CSF'],
			has_ot_environment: true,
			has_iot_environment: true,
			firewall_ids: vp.ids('fortinet/fortigate'),
			edr_ids: vp.ids('microsoft/defender-for-endpoint'),
			mfa_ids: vp.ids('microsoft/microsoft-authenticator'),
			idp_ids: vp.ids('microsoft/entra-id'),
			productivity_suite_ids: vp.ids('microsoft/microsoft-365'),
			vpn_ids: vp.ids('fortinet/forticlient'),
			technical_notes: 'OT and IT share L2 at 3 of 4 sites — no PLC traffic visibility, no OT-specific tooling deployed. Coal Hill site walk found 3 unmanaged switches and 1 unsegmented vendor link. OT visibility is the wedge for the broader segmentation play.',
			last_verified_at: today,
		},
		'cascade-insurance': {
			industry: 'Insurance',
			revenue_usd: 410000000,
			employee_count: 1200,
			user_count: 1150,
			endpoint_count: 1300,
			server_count: 92,
			site_count: 3,
			hq_city: 'Portland', hq_state: 'OR', hq_country: 'USA',
			it_team_size: 18,
			security_team_size: 3,
			soc_model: 'co-managed',
			compliance_frameworks: ['SOC 2', 'NAIC Model Law'],
			firewall_ids: vp.ids('cisco/asa'),
			edr_ids: vp.ids('sentinelone/singularity-xdr'),
			idp_ids: vp.ids('okta/workforce-identity-cloud'),
			mfa_ids: vp.ids('okta/okta-verify'),
			vpn_ids: vp.ids('cisco/anyconnect'),
			productivity_suite_ids: vp.ids('microsoft/microsoft-365'),
			email_security_ids: vp.ids('proofpoint/email-protection'),
			siem_ids: vp.ids('splunk/splunk-enterprise-security'),
			technical_notes: 'Cisco ASA is end-of-sale and AnyConnect is the chokepoint for remote — both inherited from the previous CISO. Cyber insurance renewal in Q4 is the forcing function for FIDO2 + inline web filtering.',
			last_verified_at: today,
		},
		'sentinel-aerospace': {
			industry: 'Aerospace & Defense',
			revenue_usd: 720000000,
			employee_count: 2400,
			user_count: 2300,
			endpoint_count: 1400,
			server_count: 210,
			site_count: 4,
			dc_count: 2,
			hq_city: 'Huntsville', hq_state: 'AL', hq_country: 'USA',
			it_team_size: 28,
			security_team_size: 7,
			soc_model: 'in-house',
			compliance_frameworks: ['CMMC L2', 'NIST 800-171', 'ITAR', 'DFARS 7012'],
			has_ot_environment: false,
			firewall_ids: vp.ids('cisco/firepower-ngfw'),
			edr_ids: vp.ids('crowdstrike/falcon-insight-xdr'),
			idp_ids: vp.ids('microsoft/entra-id'),
			mfa_ids: vp.ids('yubico/yubikey'),
			siem_ids: vp.ids('splunk/splunk-enterprise-security'),
			productivity_suite_ids: vp.ids('microsoft/microsoft-365'),
			email_security_ids: vp.ids('proofpoint/email-protection'),
			vuln_mgmt_ids: vp.ids('tenable/nessus'),
			technical_notes: '1,400 in-scope CUI assets identified during CMMC scoping. Enclave decision pending: full enclave vs scoped boundary. Current Cisco boundary doesn\'t map cleanly to AC/SC families — that\'s the rip-and-replace opening.',
			last_verified_at: today,
		},
		'granite-state-university': {
			industry: 'Higher Education',
			employee_count: 3200,
			user_count: 25000,
			endpoint_count: 8000,
			server_count: 240,
			site_count: 3,
			hq_city: 'Manchester', hq_state: 'NH', hq_country: 'USA',
			it_team_size: 45,
			security_team_size: 4,
			soc_model: 'in-house',
			compliance_frameworks: ['FERPA', 'GLBA', 'PCI DSS'],
			firewall_ids: vp.ids('fortinet/fortigate'),
			edr_ids: vp.ids('microsoft/defender-for-endpoint'),
			idp_ids: vp.ids('microsoft/entra-id'),
			mfa_ids: vp.ids('cisco/duo'),
			productivity_suite_ids: vp.ids('google/google-workspace'),
			email_security_ids: vp.ids('mimecast/mimecast-email-security'),
			siem_ids: vp.ids('ibm/qradar'),
			technical_notes: 'Google Workspace primary; Mimecast incumbent for inbound filtering — admin UX is the main complaint. Roughly 80 accounts compromised in the September phishing wave. Student devices not centrally managed.',
			last_verified_at: today,
		},
		'meridian-telecom': {
			industry: 'Telecommunications',
			revenue_usd: 180000000,
			employee_count: 450,
			user_count: 430,
			endpoint_count: 480,
			server_count: 85,
			hq_city: 'Austin', hq_state: 'TX', hq_country: 'USA',
			it_team_size: 22,
			security_team_size: 5,
			soc_model: 'in-house',
			compliance_frameworks: ['SOC 2'],
			firewall_ids: vp.ids('fortinet/fortigate'),
			edr_ids: vp.ids('sophos/intercept-x'),
			sase_ids: vp.ids('zscaler/zscaler-internet-access'),
			productivity_suite_ids: vp.ids('microsoft/microsoft-365'),
			siem_ids: vp.ids('splunk/splunk-enterprise-security'),
			mdr_ids: vp.ids('sophos/sophos-mdr'),
			technical_notes: 'Internal stack overlaps heavily with what they resell to SMB customers. Zscaler is the current upstream they\'re trying to replace — needs multi-tenant + white-label, which is the gap they\'ve flagged.',
			last_verified_at: today,
		},
		'harbormaster-logistics': {
			industry: 'Logistics & Freight Forwarding',
			revenue_usd: 540000000,
			employee_count: 2100,
			user_count: 2000,
			endpoint_count: 2400,
			site_count: 11,
			hq_city: 'Long Beach', hq_state: 'CA', hq_country: 'USA',
			it_team_size: 20,
			security_team_size: 4,
			soc_model: 'mssp',
			compliance_frameworks: ['ISO 27001'],
			edr_ids: vp.ids('microsoft/defender-for-endpoint'),
			idp_ids: vp.ids('microsoft/entra-id'),
			mfa_ids: vp.ids('yubico/yubikey'),
			productivity_suite_ids: vp.ids('microsoft/microsoft-365'),
			technical_notes: 'Post-breach rebuild in progress. Old firewall/EDR/SIEM stack ripped out during IR. Defender deployed to ~600 endpoints so far (2 false-positive patterns being tuned), YubiKey rollout starting with privileged users. Firewall, SIEM, email security still to be chosen — that\'s the open scope of the active deal.',
			last_verified_at: today,
		},
	};
}

async function main() {
	console.log(`API base: ${API}`);
	await waitForApi();
	console.log('Creating customer accounts…');
	const customerIds = {};
	for (const c of customers) {
		const acc = await post('/accounts', {
			slug: c.slug, name: c.name, status: 'account',
			domains: c.domains, relationship_summary: c.summary,
		});
		customerIds[c.slug] = acc.id;
	}

	console.log('Creating partner accounts…');
	const partnerIds = {};
	for (const p of partners) {
		const acc = await post('/accounts', {
			slug: p.slug, name: p.name, status: 'partner',
			domains: p.domains, active_deals: p.active_deals,
		});
		partnerIds[p.slug] = acc.id;
	}

	console.log('Creating customer contacts…');
	const contactIdsByCustomer = {};
	for (const [slug, contacts] of Object.entries(contactsByCustomerSlug)) {
		contactIdsByCustomer[slug] = [];
		for (const c of contacts) {
			const created = await post(`/accounts/${customerIds[slug]}/contacts`, { ...c, kind: 'account', company: customers.find(x => x.slug === slug).name });
			contactIdsByCustomer[slug].push(created.id);
		}
	}

	console.log('Creating partner contacts…');
	const contactIdsByPartner = {};
	for (const [slug, contacts] of Object.entries(contactsByPartnerSlug)) {
		contactIdsByPartner[slug] = [];
		for (const c of contacts) {
			const created = await post(`/accounts/${partnerIds[slug]}/contacts`, { ...c, company: partners.find(x => x.slug === slug).name });
			contactIdsByPartner[slug].push(created.id);
		}
	}

	console.log('Creating internal contacts…');
	const internalIds = [];
	for (const c of internalContacts) {
		const created = await post('/contacts', c);
		internalIds.push(created.id);
	}

	console.log('Linking partnerships…');
	for (const [customerSlug, partnerSlugs] of Object.entries(partnerships)) {
		for (const partnerSlug of partnerSlugs) {
			await post(`/accounts/${customerIds[customerSlug]}/partners/${partnerIds[partnerSlug]}`, {});
		}
	}

	console.log('Loading vendor product catalog…');
	const vp = await loadVendorProductCatalog();

	console.log('Setting account technical profiles…');
	const accountDetailsByCustomer = buildAccountDetailsByCustomer(vp);
	let accountDetailsCreated = 0;
	for (const [customerSlug, details] of Object.entries(accountDetailsByCustomer)) {
		await patch(`/accounts/${customerIds[customerSlug]}/details`, details);
		accountDetailsCreated++;
	}

	console.log('Creating opportunities…');
	// product_ids reference the seeded Palo Alto catalog (see migrations
	// 1000000000012 / 1000000000014). IDs are stable because the catalog
	// is seeded by migration in fixed order.
	const opportunities = [
		{ customer: 'acme-manufacturing', name: 'Acme — XDR Replacement', stage: 'pov_tech_validation', product_ids: [1, 2],
			why_change: ['Legacy AV missing modern fileless threats', 'IR retainer flagging dwell time > 30 days'],
			why_now: ['Cyber insurance renewal Q3 requires EDR with behavioral detection'],
			why_us: ['MITRE Engenuity coverage', 'Cortex XSIAM as path to consolidate SOC tooling'] },
		{ customer: 'riverstone-health', name: 'Riverstone — Endpoint Modernization', stage: 'tech_discovery', product_ids: [1, 2],
			why_change: ['HIPAA audit flagged endpoint visibility gap', '14-site deployment overhead with current vendor'],
			why_now: ['Legacy AV contract expires October 2026'],
			why_us: ['VDI-aware sensor', 'Healthcare references with similar Citrix footprint'] },
		{ customer: 'blueoak-financial', name: 'BlueOak — SOC Consolidation', stage: 'non_pov_tech_validation', product_ids: [2, 5],
			why_change: ['SOC analyst turnover, hiring market is rough', 'Tool sprawl across 5 vendors'],
			why_now: ['FFIEC exam scheduled for Q3'],
			why_us: ['XSIAM + Unit 42 managed offering replaces three vendors'] },
		{ customer: 'northland-credit-union', name: 'Northland — 24x7 Monitoring', stage: 'opp_identification', product_ids: [2],
			why_change: ['No after-hours coverage today', 'Recent phishing incident undetected for 4 days'],
			why_now: ['NCUA examiner requested enhanced monitoring in last review'],
			why_us: ['Lower TCO than building in-house SOC at their scale'] },
		{ customer: 'pearl-mining-logistics', name: 'Pearl Mining — OT Visibility & Segmentation', stage: 'tech_discovery', product_ids: [9, 11, 1],
			why_change: ['OT network is flat — IT and ICS share L2', 'No telemetry on PLC traffic'],
			why_now: ['Ransomware hit a peer mining op last month — board wants action'],
			why_us: ['OT signatures + segmentation playbook for mining'] },
		{ customer: 'cascade-insurance', name: 'Cascade — SASE Rollout', stage: 'pov_planning', product_ids: [13, 17, 16],
			why_change: ['Phishing-driven account compromise pattern', 'Legacy VPN is the bottleneck'],
			why_now: ['Cyber insurance renewal demands hardware-key MFA and inline web filtering'],
			why_us: ['Prisma Access + CASB + GlobalProtect as one platform'] },
		{ customer: 'sentinel-aerospace', name: 'Sentinel — CMMC L2 Boundary', stage: 'tech_decision_pending', product_ids: [9, 11, 1],
			why_change: ['Current boundary controls don\'t map cleanly to CMMC AC/SC families'],
			why_now: ['DoD contract requires CMMC L2 certification by December 2026'],
			why_us: ['CMMC reference architecture', 'Pre-built control mapping docs'] },
		{ customer: 'granite-state-university', name: 'Granite State — Email & Web Security', stage: 'pov_tech_validation', product_ids: [13, 16],
			why_change: ['Phishing → student credential theft, repeating incidents each semester'],
			why_now: ['Budget freed up post-audit findings'],
			why_us: ['Native Google Workspace integration', 'Better admin UX than incumbent'] },
		{ customer: 'meridian-telecom', name: 'Meridian — SASE-as-a-Service Platform', stage: 'tech_discovery', product_ids: [13, 14, 18],
			why_change: ['SMB customers demanding SASE, current upstream can\'t deliver'],
			why_now: ['Lost two prospects to competitors who already had this'],
			why_us: ['Multi-tenant management', 'White-label options for MSP partners'] },
		{ customer: 'harbormaster-logistics', name: 'Harbormaster — Post-Breach Rebuild', stage: 'pov_planning', product_ids: [1, 2, 17, 5],
			why_change: ['Recently breached, IR completed last month', 'Old stack proven inadequate'],
			why_now: ['Board allocated emergency budget with a 90-day implementation window'],
			why_us: ['Rapid deploy with Unit 42 retainer attached', 'Identity-first rebuild aligned to their plan'] },
	];
	for (const o of opportunities) {
		const { customer, ...body } = o;
		await post('/opportunities', { account_id: customerIds[customer], ...body });
	}

	console.log('Creating meetings…');
	const meetings = [
		// Acme — active POV
		{ customer: 'acme-manufacturing', date: daysFromNow(-45), title: 'initial-intro', body: '# Acme — Initial intro\n\nWarm intro from CDW. Diane and Marcus joined; quick overview of where they are and what they\'re evaluating.', extraContacts: ['cdw'] },
		{ customer: 'acme-manufacturing', date: daysFromNow(-30), title: 'discovery-call', body: '# Acme — Discovery\n\n- 3,200 endpoints, mixed Windows/macOS\n- Pain: legacy AV missing modern threats\n- Next: scope POV', extraContacts: ['cdw'] },
		{ customer: 'acme-manufacturing', date: daysFromNow(-9), title: 'pov-kickoff', body: '# POV kickoff\n\n- Deploying to 200 endpoints first wave\n- Success criteria: detection of test EDR cases, low false-positive ratio', extraContacts: ['cdw'] },
		{ customer: 'acme-manufacturing', date: daysFromNow(7), title: 'pov-checkpoint', body: '# POV midpoint\n\nReview alert tuning and tag any noisy detections.' },
		{ customer: 'acme-manufacturing', date: daysFromNow(21), title: 'pov-readout', body: '# POV readout\n\nFinal results, success-criteria scorecard, and procurement next steps.' },

		// Riverstone — healthcare
		{ customer: 'riverstone-health', date: daysFromNow(-35), title: 'intro-call', body: '# Riverstone intro\n\nLena introduced by CDW. Walked the architecture at a high level.', extraContacts: ['cdw'] },
		{ customer: 'riverstone-health', date: daysFromNow(-21), title: 'site-walkthrough', body: '# Riverstone — site walkthrough\n\n14 sites, central SOC. Mostly Win10 with Citrix VDA at hospital floors.', extraContacts: ['cdw'] },
		{ customer: 'riverstone-health', date: daysFromNow(3), title: 'technical-deep-dive', body: '# Technical deep dive\n\nFocus: Citrix VDA agent footprint, sensor performance.' },
		{ customer: 'riverstone-health', date: daysFromNow(17), title: 'budget-planning', body: '# Budget planning\n\nAaron + finance — model 3-year TCO vs incumbent renewal.' },

		// BlueOak
		{ customer: 'blueoak-financial', date: daysFromNow(-22), title: 'soc-strategy-call', body: '# SOC strategy\n\nSandra walked through her staffing problem. Open to MDR if TCO works.', extraContacts: ['guidepoint-security'] },
		{ customer: 'blueoak-financial', date: daysFromNow(-12), title: 'mdr-comparison', body: '# MDR comparison\n\nComparing in-house SOC retention vs MDR outsourcing. CFO needs TCO model.', extraContacts: ['guidepoint-security'] },
		{ customer: 'blueoak-financial', date: daysFromNow(5), title: 'cfo-tco-review', body: '# CFO TCO review\n\nPresent 3-year TCO. Sandra + Owen + CFO attending.' },

		// Northland
		{ customer: 'northland-credit-union', date: daysFromNow(-5), title: 'mdr-workshop', body: '# MDR workshop\n\nGuidePoint led; reviewed playbooks. Decision delayed pending Q3 budget.', extraContacts: ['guidepoint-security'] },
		{ customer: 'northland-credit-union', date: daysFromNow(28), title: 'q3-budget-checkpoint', body: '# Q3 budget checkpoint\n\nKimberly to confirm budget allocation post-Q3 close.' },

		// Pearl Mining
		{ customer: 'pearl-mining-logistics', date: daysFromNow(-40), title: 'ot-assessment-kickoff', body: '# OT assessment kickoff\n\nOptiv-led. Need passive visibility on PLC traffic across 4 sites.', extraContacts: ['optiv'] },
		{ customer: 'pearl-mining-logistics', date: daysFromNow(-15), title: 'site-visit-coal', body: '# Site visit — Coal Hill\n\nPhysical walkthrough. Found 3 unmanaged switches and 1 unsegmented vendor link.', extraContacts: ['optiv'] },
		{ customer: 'pearl-mining-logistics', date: daysFromNow(14), title: 'ot-readout', body: '# OT readout\n\nPresent findings and proposed segmentation plan.' },

		// Cascade
		{ customer: 'cascade-insurance', date: daysFromNow(-18), title: 'mfa-hardening', body: '# MFA hardening review\n\nCyber insurance renewal requires hardware-key MFA for privileged accounts. Mapped out FIDO2 rollout.' },
		{ customer: 'cascade-insurance', date: daysFromNow(11), title: 'sase-pov-kickoff', body: '# SASE POV kickoff\n\nPilot 50 users on Prisma Access. GlobalProtect retire timeline.' },

		// Sentinel
		{ customer: 'sentinel-aerospace', date: daysFromNow(-28), title: 'cmmc-intake', body: '# CMMC intake\n\nRaj + Catherine. Confirmed L2 scope, ~1,400 in-scope assets.', extraContacts: ['trace3'] },
		{ customer: 'sentinel-aerospace', date: daysFromNow(-7), title: 'cmmc-scoping', body: '# CMMC scoping\n\nTrace3 driving. Boundary controls mapped to AC, SC family. Next: enclave decision.', extraContacts: ['trace3'] },
		{ customer: 'sentinel-aerospace', date: daysFromNow(9), title: 'final-architecture-review', body: '# Final architecture review\n\nWalk through enclave design with Raj + compliance team.' },

		// Granite State
		{ customer: 'granite-state-university', date: daysFromNow(-12), title: 'phishing-incident-review', body: '# Phishing incident review\n\nReviewed Sept campaign, ~80 accounts compromised. Quantified blast radius.' },
		{ customer: 'granite-state-university', date: daysFromNow(-3), title: 'email-security-demo', body: '# Email security demo\n\nDemoed inbound + outbound DLP. Asked about Google Workspace integration depth.', extraContacts: ['shi-international'] },
		{ customer: 'granite-state-university', date: daysFromNow(13), title: 'admin-workshop', body: '# Admin workshop\n\nHands-on session with Jessica\'s team on policy authoring.' },

		// Meridian
		{ customer: 'meridian-telecom', date: daysFromNow(-14), title: 'sase-platform-eval', body: '# SASE platform eval\n\nThey want to white-label SASE for SMB customers. Need multi-tenant management.' },
		{ customer: 'meridian-telecom', date: daysFromNow(6), title: 'multi-tenant-deep-dive', body: '# Multi-tenant deep dive\n\nReview tenant isolation, billing hooks, branding options.' },

		// Harbormaster
		{ customer: 'harbormaster-logistics', date: daysFromNow(-25), title: 'post-breach-roadmap', body: '# Post-breach roadmap\n\nThey just finished IR. Rebuilding identity-first; need MFA + EDR + SIEM in 90 days.' },
		{ customer: 'harbormaster-logistics', date: daysFromNow(-11), title: 'weekly-checkpoint-1', body: '# Weekly checkpoint 1\n\nGreg + Sasha. Identity rollout schedule locked, EDR deployment kicks off Monday.' },
		{ customer: 'harbormaster-logistics', date: daysFromNow(-4), title: 'weekly-checkpoint-2', body: '# Weekly checkpoint 2\n\nEDR live on 600 endpoints. Two false-positive patterns to tune.' },
		{ customer: 'harbormaster-logistics', date: daysFromNow(10), title: 'identity-rollout-plan', body: '# Identity rollout plan\n\nWalk through phased MFA enrollment and conditional access posture.' },
	];

	// Internal-only meetings (no account, no attendees required)
	const internalMeetings = [
		{ date: daysFromNow(-7), title: 'weekly-pipeline-review', body: '# Weekly pipeline review\n\n- Acme POV midpoint next week\n- Sentinel decision pending\n- Harbormaster on track for Q3 close\n- Northland slipping — needs budget confirmation' },
		{ date: daysFromNow(-2), title: 'cmmc-enablement-session', body: '# CMMC enablement\n\nInternal training on CMMC L2 control mapping and Sentinel-style deals.' },
		{ date: daysFromNow(4), title: 'q3-forecast-prep', body: '# Q3 forecast prep\n\nWalk every opp; classify commit vs upside vs pipeline.' },
	];

	let meetingsCreated = 0;
	for (const m of meetings) {
		const contactIds = [...contactIdsByCustomer[m.customer]];
		if (m.extraContacts) {
			for (const partnerSlug of m.extraContacts) {
				contactIds.push(...contactIdsByPartner[partnerSlug]);
			}
		}
		await post('/meetings', {
			account_id: customerIds[m.customer],
			date: m.date,
			title: m.title,
			body: m.body,
			contact_ids: contactIds,
		});
		meetingsCreated++;
	}
	for (const m of internalMeetings) {
		await post('/meetings', {
			internal: true,
			date: m.date,
			title: m.title,
			body: m.body,
		});
		meetingsCreated++;
	}

	console.log('\nSeed complete.');
	console.log(`  Customers:     ${Object.keys(customerIds).length}`);
	console.log(`  Partners:      ${Object.keys(partnerIds).length}`);
	console.log(`  Contacts:      ${Object.values(contactIdsByCustomer).flat().length} customer + ${Object.values(contactIdsByPartner).flat().length} partner + ${internalIds.length} internal`);
	console.log(`  Opportunities: ${opportunities.length}`);
	console.log(`  Meetings:      ${meetingsCreated} (${meetings.length} account + ${internalMeetings.length} internal)`);
	console.log(`  Acct details:  ${accountDetailsCreated}`);
}

main().catch(err => {
	console.error(err);
	process.exit(1);
});
