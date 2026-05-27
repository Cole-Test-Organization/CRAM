// One-off: enrich the FixtureCorp Test Account with the full set of related
// entities so we can exercise export → wipe → import round-trips end-to-end.
// Run from host: node dev/scripts/enrich-fixturecorp.js

const API = process.env.API_BASE || 'http://localhost:3200/api';
const SLUG = 'fixturecorp-test';

async function req(method, path, body) {
	const res = await fetch(`${API}${path}`, {
		method,
		headers: { 'Content-Type': 'application/json' },
		body: body == null ? undefined : JSON.stringify(body),
	});
	if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${await res.text()}`);
	return res.json();
}
const get = (p) => req('GET', p);
const post = (p, b) => req('POST', p, b);
const patch = (p, b) => req('PATCH', p, b);

function vpLookup(catalog) {
	const m = new Map();
	for (const p of catalog.products) m.set(`${p.vendor_slug}/${p.slug}`, p.id);
	return (...keys) => keys.map((k) => {
		const id = m.get(k);
		if (!id) throw new Error(`vendor_product missing: ${k}`);
		return id;
	});
}

function daysFromNow(n) {
	const d = new Date();
	d.setDate(d.getDate() + n);
	return d.toISOString().slice(0, 10);
}

async function main() {
	const list = await get(`/accounts?limit=500`);
	const acct = list.accounts.find((a) => a.slug === SLUG);
	if (!acct) throw new Error(`Account ${SLUG} not found — import it first.`);
	const accountId = acct.id;
	console.log(`FixtureCorp account_id=${accountId}`);

	const vpCatalog = await get(`/vendor-products?limit=500`);
	const vp = vpLookup(vpCatalog);
	const today = new Date().toISOString();

	console.log('Setting technical profile (account_details)…');
	await patch(`/accounts/${accountId}/details`, {
		industry: 'Software',
		revenue_usd: 240000000,
		employee_count: 1100,
		user_count: 1050,
		endpoint_count: 1200,
		server_count: 95,
		site_count: 4,
		dc_count: 1,
		hq_city: 'Boise', hq_state: 'ID', hq_country: 'USA',
		it_team_size: 16,
		security_team_size: 3,
		soc_model: 'co-managed',
		compliance_frameworks: ['SOC 2', 'ISO 27001'],
		has_ot_environment: false,
		has_iot_environment: false,
		firewall_ids: vp('fortinet/fortigate'),
		edr_ids: vp('crowdstrike/falcon-insight-xdr'),
		mfa_ids: vp('cisco/duo'),
		idp_ids: vp('microsoft/entra-id'),
		productivity_suite_ids: vp('microsoft/microsoft-365'),
		email_security_ids: vp('proofpoint/email-protection'),
		siem_ids: vp('splunk/splunk-enterprise-security'),
		vuln_mgmt_ids: vp('tenable/nessus'),
		technical_notes: 'Cloud-heavy SaaS company. Engineering on macOS, corp on mixed Windows/macOS. Current EDR contract auto-renews Q4 — open to consolidation.',
		last_verified_at: today,
	});

	console.log('Creating customer contacts…');
	const contacts = [
		{ full_name: 'Elena Park', title: 'CISO', email: 'elena.park@fixturecorp.example', city: 'Boise', state: 'ID', country: 'USA', kind: 'account', company: 'FixtureCorp Test Account' },
		{ full_name: 'Marcus Doyle', title: 'Director of IT Operations', email: 'marcus.doyle@fixturecorp.example', city: 'Boise', state: 'ID', country: 'USA', kind: 'account', company: 'FixtureCorp Test Account' },
		{ full_name: 'Priya Sengupta', title: 'Security Engineer', email: 'priya.sengupta@fixturecorp.example', city: 'Boise', state: 'ID', country: 'USA', kind: 'account', company: 'FixtureCorp Test Account' },
	];
	const contactIds = [];
	for (const c of contacts) {
		const created = await post(`/accounts/${accountId}/contacts`, c);
		contactIds.push(created.id);
	}

	console.log('Creating partner account + partner contact + partnership…');
	let partner;
	try {
		partner = await post('/accounts', {
			slug: 'fixturepartner-co', name: 'FixturePartner Co',
			status: 'partner', domains: ['fixturepartner.example'],
			active_deals: 'FixtureCorp EDR consolidation eval.',
		});
	} catch (e) {
		// already exists (re-running script); fetch it
		const all = await get(`/accounts?limit=500`);
		partner = all.accounts.find((a) => a.slug === 'fixturepartner-co');
	}
	const partnerContact = await post(`/accounts/${partner.id}/contacts`, {
		full_name: 'Reid Calloway', title: 'Account Executive',
		email: 'reid.calloway@fixturepartner.example',
		kind: 'partner', company: 'FixturePartner Co',
	});
	await post(`/accounts/${accountId}/partners/${partner.id}`, {});

	console.log('Creating opportunities…');
	const opp1 = await post('/opportunities', {
		account_id: accountId,
		name: 'FixtureCorp — EDR Consolidation',
		stage: 'pov_tech_validation',
		product_ids: [1, 2], // Cortex XDR, Cortex XSIAM
		why_change: ['Current EDR contract expires Q4', 'Tool sprawl across 4 endpoint products'],
		why_now: ['Renewal forcing function before December'],
		why_us: ['Single-agent consolidation story', 'XSIAM as SOC modernization path'],
		notes: 'Created during end-to-end import/export round-trip test.',
	});
	const opp2 = await post('/opportunities', {
		account_id: accountId,
		name: 'FixtureCorp — SASE Pilot',
		stage: 'tech_discovery',
		product_ids: [13, 5], // Prisma Access, Unit 42
		why_change: ['VPN saturated during peak engineering hours'],
		why_now: ['Annual ZTNA initiative in FY plan'],
		why_us: ['Prisma Access + ZTNA Connector simplicity'],
	});

	console.log('Creating meetings…');
	const meeting1 = await post('/meetings', {
		account_id: accountId,
		date: daysFromNow(-21),
		title: 'discovery-call',
		body: '# FixtureCorp — Discovery\n\n- Elena (CISO) walked through current stack and renewal timing.\n- Pain: 4 endpoint tools, no single source of truth for detections.\n- Next: scope EDR POV, 250 endpoints first wave.',
		contact_ids: [contactIds[0], contactIds[1], partnerContact.id],
	});
	const meeting2 = await post('/meetings', {
		account_id: accountId,
		date: daysFromNow(-7),
		title: 'pov-kickoff',
		body: '# POV kickoff\n\n- Deploy Cortex XDR to 250 endpoints.\n- Success criteria: 95%+ detection on MITRE test cases, <1 FP / 100 endpoints / week.\n- Priya owns deployment on the FixtureCorp side.',
		contact_ids: [contactIds[1], contactIds[2]],
	});
	const meeting3 = await post('/meetings', {
		account_id: accountId,
		date: daysFromNow(14),
		title: 'pov-readout',
		body: '# POV readout\n\nFinal results, success-criteria scorecard, and procurement next steps.',
		contact_ids: [contactIds[0], contactIds[1], contactIds[2]],
	});

	console.log('Creating notes…');
	await post('/notes', { account_id: accountId, body: 'Account-level note: imported via round-trip test. Renewal-driven deal; CFO is involved on procurement.' });
	await post('/notes', { account_id: accountId, body: 'CFO is Quentin Briggs — not yet a contact in the system. Add when introduced.' });
	await post('/notes', { contact_id: contactIds[0], body: 'Elena prefers async updates over status calls. Loop her on Slack channel, not email.' });
	await post('/notes', { opportunity_id: opp1.id, body: 'Procurement uses Coupa. ~3-week PO turnaround after technical sign-off.' });

	console.log('\nDone. FixtureCorp is now populated:');
	console.log(`  account_id:    ${accountId}`);
	console.log(`  contacts:      ${contactIds.length} (customer) + 1 (partner)`);
	console.log(`  partner:       ${partner.slug} (id ${partner.id})`);
	console.log(`  opportunities: 2 (${opp1.id}, ${opp2.id})`);
	console.log(`  meetings:      3 (${meeting1.id}, ${meeting2.id}, ${meeting3.id})`);
	console.log(`  notes:         4`);
	console.log(`  details:       set (vendor stack + technical profile)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
