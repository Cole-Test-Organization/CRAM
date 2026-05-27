// Seed the vendors + vendor_products catalog with the common security stack
// a typical security SE encounters at customers: firewall vendors, endpoint /
// XDR vendors, identity vendors, cloud security vendors, etc.
//
// Idempotency:
//   - vendors:         ON CONFLICT (slug) DO UPDATE SET needs_review = FALSE
//   - vendor_products: ON CONFLICT (vendor_id, slug) DO UPDATE SET needs_review = FALSE
//
//   Existing rows (e.g. anything auto-created via the picker's
//   `find_or_create` workflow) get their needs_review flag CLEARED but other
//   fields (notes, website if set, etc.) are preserved. New rows insert with
//   needs_review = FALSE because the migration is hand-curated.
//
// Categories:
//   Every category seeded here has a corresponding *_ids bigint[] column on
//   account_details (set up by migrations 11 + 16), so every product is
//   linkable to an account from day one.
//
// Down migration is intentionally a no-op: deleting any of these would orphan
// references in account_details *_ids arrays (no FK enforcement on arrays).
// If you genuinely need to remove a vendor, soft-delete via the GUI.

exports.up = (pgm) => {
  // ─── Vendors ─────────────────────────────────────────────────────────
  pgm.sql(`
    INSERT INTO vendors (name, slug, website, needs_review) VALUES
      ('Cisco',               'cisco',               'https://www.cisco.com',            FALSE),
      ('CrowdStrike',         'crowdstrike',         'https://www.crowdstrike.com',      FALSE),
      ('Fortinet',            'fortinet',            'https://www.fortinet.com',         FALSE),
      ('Check Point',         'check-point',         'https://www.checkpoint.com',       FALSE),
      ('Sophos',              'sophos',              'https://www.sophos.com',           FALSE),
      ('SonicWall',           'sonicwall',           'https://www.sonicwall.com',        FALSE),
      ('Juniper Networks',    'juniper-networks',    'https://www.juniper.net',          FALSE),
      ('WatchGuard',          'watchguard',          'https://www.watchguard.com',       FALSE),
      ('SentinelOne',         'sentinelone',         'https://www.sentinelone.com',      FALSE),
      ('Microsoft',           'microsoft',           'https://www.microsoft.com',        FALSE),
      ('Zscaler',             'zscaler',             'https://www.zscaler.com',          FALSE),
      ('Netskope',            'netskope',            'https://www.netskope.com',         FALSE),
      ('Cloudflare',          'cloudflare',          'https://www.cloudflare.com',       FALSE),
      ('Splunk',              'splunk',              'https://www.splunk.com',           FALSE),
      ('IBM',                 'ibm',                 'https://www.ibm.com',              FALSE),
      ('Rapid7',              'rapid7',              'https://www.rapid7.com',           FALSE),
      ('Tenable',             'tenable',             'https://www.tenable.com',          FALSE),
      ('Qualys',              'qualys',              'https://www.qualys.com',           FALSE),
      ('Okta',                'okta',                'https://www.okta.com',             FALSE),
      ('Ping Identity',       'ping-identity',       'https://www.pingidentity.com',     FALSE),
      ('BeyondTrust',         'beyondtrust',         'https://www.beyondtrust.com',      FALSE),
      ('Delinea',             'delinea',             'https://www.delinea.com',          FALSE),
      ('HashiCorp',           'hashicorp',           'https://www.hashicorp.com',        FALSE),
      ('RSA',                 'rsa',                 'https://www.rsa.com',              FALSE),
      ('Yubico',              'yubico',              'https://www.yubico.com',           FALSE),
      ('Proofpoint',          'proofpoint',          'https://www.proofpoint.com',       FALSE),
      ('Mimecast',            'mimecast',            'https://www.mimecast.com',         FALSE),
      ('Abnormal Security',   'abnormal-security',   'https://abnormalsecurity.com',     FALSE),
      ('Trellix',             'trellix',             'https://www.trellix.com',          FALSE),
      ('Broadcom',            'broadcom',            'https://www.broadcom.com',         FALSE),
      ('Trend Micro',         'trend-micro',         'https://www.trendmicro.com',       FALSE),
      ('Tanium',              'tanium',              'https://www.tanium.com',           FALSE),
      ('Cybereason',          'cybereason',          'https://www.cybereason.com',       FALSE),
      ('Bitdefender',         'bitdefender',         'https://www.bitdefender.com',      FALSE),
      ('Wiz',                 'wiz',                 'https://www.wiz.io',               FALSE),
      ('Lacework',            'lacework',            'https://www.lacework.com',         FALSE),
      ('Orca Security',       'orca-security',       'https://orca.security',            FALSE),
      ('Snyk',                'snyk',                'https://snyk.io',                  FALSE),
      ('Aqua Security',       'aqua-security',       'https://www.aquasec.com',          FALSE),
      ('Sysdig',              'sysdig',              'https://sysdig.com',               FALSE),
      ('Veracode',            'veracode',            'https://www.veracode.com',         FALSE),
      ('Checkmarx',           'checkmarx',           'https://checkmarx.com',            FALSE),
      ('Vectra AI',           'vectra-ai',           'https://www.vectra.ai',            FALSE),
      ('ExtraHop',            'extrahop',            'https://www.extrahop.com',         FALSE),
      ('Darktrace',           'darktrace',           'https://darktrace.com',            FALSE),
      ('Corelight',           'corelight',           'https://corelight.com',            FALSE),
      ('Arctic Wolf',         'arctic-wolf',         'https://arcticwolf.com',           FALSE),
      ('Red Canary',          'red-canary',          'https://redcanary.com',            FALSE),
      ('Expel',               'expel',               'https://expel.com',                FALSE),
      ('eSentire',            'esentire',            'https://www.esentire.com',         FALSE),
      ('ReliaQuest',          'reliaquest',          'https://www.reliaquest.com',       FALSE),
      ('ServiceNow',          'servicenow',          'https://www.servicenow.com',       FALSE),
      ('Atlassian',           'atlassian',           'https://www.atlassian.com',        FALSE),
      ('Freshworks',          'freshworks',          'https://www.freshworks.com',       FALSE),
      ('Zendesk',             'zendesk',             'https://www.zendesk.com',          FALSE),
      ('PagerDuty',           'pagerduty',           'https://www.pagerduty.com',        FALSE),
      ('Amazon Web Services', 'aws',                 'https://aws.amazon.com',           FALSE),
      ('Google',              'google',              'https://cloud.google.com',         FALSE),
      ('Oracle',              'oracle',              'https://www.oracle.com',           FALSE),
      ('Slack',               'slack',               'https://slack.com',                FALSE),
      ('Zoom',                'zoom',                'https://zoom.us',                  FALSE),
      ('Forcepoint',          'forcepoint',          'https://www.forcepoint.com',       FALSE),
      ('Skyhigh Security',    'skyhigh-security',    'https://www.skyhighsecurity.com',  FALSE),
      ('Claroty',             'claroty',             'https://claroty.com',              FALSE),
      ('Nozomi Networks',     'nozomi-networks',     'https://www.nozominetworks.com',   FALSE),
      ('Armis',               'armis',               'https://www.armis.com',            FALSE),
      ('Dragos',              'dragos',              'https://www.dragos.com',           FALSE),
      ('Tailscale',           'tailscale',           'https://tailscale.com',            FALSE),
      ('OpenVPN',             'openvpn',             'https://openvpn.net',              FALSE),
      ('Ivanti',              'ivanti',              'https://www.ivanti.com',           FALSE),
      ('Aruba Networks',      'aruba-networks',      'https://www.arubanetworks.com',    FALSE),
      ('Versa Networks',      'versa-networks',      'https://versa-networks.com',       FALSE),
      ('Cato Networks',       'cato-networks',       'https://www.catonetworks.com',     FALSE),
      ('Forescout',           'forescout',           'https://www.forescout.com',        FALSE),
      ('Akamai',              'akamai',              'https://www.akamai.com',           FALSE)
    ON CONFLICT (slug) DO UPDATE SET needs_review = FALSE;
  `);

  // ─── Vendor products ─────────────────────────────────────────────────
  // Linked by vendor slug (vendor_ids are resolved at runtime via JOIN).
  pgm.sql(`
    INSERT INTO vendor_products (vendor_id, name, slug, category, needs_review)
    SELECT v.id, p.name, p.slug, p.category, FALSE
    FROM (VALUES
      -- Cisco
      ('cisco', 'Firepower NGFW',                      'firepower-ngfw',           'firewall'),
      ('cisco', 'ASA',                                 'asa',                      'firewall'),
      ('cisco', 'Meraki MX',                           'meraki-mx',                'firewall'),
      ('cisco', 'AnyConnect',                          'anyconnect',               'vpn'),
      ('cisco', 'Duo',                                 'duo',                      'mfa'),
      ('cisco', 'Umbrella',                            'umbrella',                 'sase'),
      ('cisco', 'Secure Access',                       'secure-access',            'sase'),
      ('cisco', 'Secure Endpoint',                     'secure-endpoint',          'edr'),
      ('cisco', 'Secure Email',                        'secure-email',             'email_security'),
      ('cisco', 'Viptela SD-WAN',                      'viptela-sd-wan',           'sdwan'),
      ('cisco', 'Meraki SD-WAN',                       'meraki-sd-wan',            'sdwan'),
      ('cisco', 'Identity Services Engine',            'identity-services-engine', 'idp'),

      -- CrowdStrike
      ('crowdstrike', 'Falcon Insight XDR',            'falcon-insight-xdr',       'edr'),
      ('crowdstrike', 'Falcon Complete',               'falcon-complete',          'mdr'),
      ('crowdstrike', 'Falcon Identity Protection',    'falcon-identity-protection','idp'),
      ('crowdstrike', 'Falcon LogScale',               'falcon-logscale',          'siem'),
      ('crowdstrike', 'Falcon Cloud Security',         'falcon-cloud-security',    'cspm'),
      ('crowdstrike', 'Falcon Discover',               'falcon-discover',          'vuln_mgmt'),

      -- Fortinet
      ('fortinet', 'FortiGate',                        'fortigate',                'firewall'),
      ('fortinet', 'FortiClient',                      'forticlient',              'vpn'),
      ('fortinet', 'FortiEDR',                         'fortiedr',                 'edr'),
      ('fortinet', 'FortiSIEM',                        'fortisiem',                'siem'),
      ('fortinet', 'FortiSASE',                        'fortisase',                'sase'),
      ('fortinet', 'FortiMail',                        'fortimail',                'email_security'),
      ('fortinet', 'FortiAuthenticator',               'fortiauthenticator',       'mfa'),
      ('fortinet', 'FortiAnalyzer',                    'fortianalyzer',            'siem'),

      -- Check Point
      ('check-point', 'Quantum Firewall',              'quantum-firewall',         'firewall'),
      ('check-point', 'Harmony Endpoint',              'harmony-endpoint',         'edr'),
      ('check-point', 'Harmony Connect',               'harmony-connect',          'sase'),
      ('check-point', 'Harmony Email & Collaboration', 'harmony-email-collaboration', 'email_security'),
      ('check-point', 'Avanan',                        'avanan',                   'email_security'),
      ('check-point', 'CloudGuard',                    'cloudguard',               'cspm'),
      ('check-point', 'Infinity XDR',                  'infinity-xdr',             'siem'),

      -- Sophos
      ('sophos', 'XGS Firewall',                       'xgs-firewall',             'firewall'),
      ('sophos', 'Intercept X',                        'intercept-x',              'edr'),
      ('sophos', 'Sophos MDR',                         'sophos-mdr',               'mdr'),
      ('sophos', 'Sophos Email',                       'sophos-email',             'email_security'),

      -- SonicWall
      ('sonicwall', 'TZ Series',                       'tz-series',                'firewall'),
      ('sonicwall', 'NSa Series',                      'nsa-series',               'firewall'),
      ('sonicwall', 'Capture Client',                  'capture-client',           'edr'),

      -- Juniper
      ('juniper-networks', 'SRX Series Firewall',      'srx-series-firewall',      'firewall'),
      ('juniper-networks', 'Connected Security',       'connected-security',       'edr'),

      -- WatchGuard
      ('watchguard', 'Firebox',                        'firebox',                  'firewall'),
      ('watchguard', 'AuthPoint',                      'authpoint',                'mfa'),

      -- SentinelOne
      ('sentinelone', 'Singularity XDR',               'singularity-xdr',          'edr'),
      ('sentinelone', 'Singularity Cloud Security',    'singularity-cloud-security','cspm'),
      ('sentinelone', 'Singularity Identity',          'singularity-identity',     'idp'),
      ('sentinelone', 'Vigilance MDR',                 'vigilance-mdr',            'mdr'),

      -- Microsoft
      ('microsoft', 'Defender for Endpoint',           'defender-for-endpoint',    'edr'),
      ('microsoft', 'Defender for Office 365',         'defender-for-office-365',  'email_security'),
      ('microsoft', 'Defender for Cloud',              'defender-for-cloud',       'cspm'),
      ('microsoft', 'Defender for Cloud Apps',         'defender-for-cloud-apps',  'casb'),
      ('microsoft', 'Defender for Identity',           'defender-for-identity',    'idp'),
      ('microsoft', 'Sentinel',                        'sentinel',                 'siem'),
      ('microsoft', 'Purview DLP',                     'purview-dlp',              'dlp'),
      ('microsoft', 'Entra ID',                        'entra-id',                 'idp'),
      ('microsoft', 'Authenticator',                   'microsoft-authenticator',  'mfa'),
      ('microsoft', 'Microsoft 365',                   'microsoft-365',            'productivity_suite'),
      ('microsoft', 'Azure',                           'azure',                    'cloud_provider'),
      ('microsoft', 'Intune',                          'intune',                   'vuln_mgmt'),

      -- Zscaler
      ('zscaler', 'Zscaler Internet Access (ZIA)',     'zscaler-internet-access',  'sase'),
      ('zscaler', 'Zscaler Private Access (ZPA)',      'zscaler-private-access',   'sase'),
      ('zscaler', 'Zscaler Posture Control',           'zscaler-posture-control',  'cspm'),

      -- Netskope
      ('netskope', 'Netskope SASE',                    'netskope-sase',            'sase'),
      ('netskope', 'Netskope CASB',                    'netskope-casb',            'casb'),
      ('netskope', 'Netskope NG-SWG',                  'netskope-ng-swg',          'sase'),
      ('netskope', 'Netskope DLP',                     'netskope-dlp',             'dlp'),
      ('netskope', 'Netskope Endpoint DLP',            'netskope-endpoint-dlp',    'dlp'),

      -- Cloudflare
      ('cloudflare', 'Cloudflare One',                 'cloudflare-one',           'sase'),
      ('cloudflare', 'Cloudflare Zero Trust',          'cloudflare-zero-trust',    'sase'),
      ('cloudflare', 'Cloudflare WAF',                 'cloudflare-waf',           'firewall'),
      ('cloudflare', 'Area 1 Email Security',          'area-1-email-security',    'email_security'),

      -- Splunk
      ('splunk', 'Splunk Enterprise Security',         'splunk-enterprise-security','siem'),
      ('splunk', 'Splunk SOAR',                        'splunk-soar',              'siem'),

      -- IBM
      ('ibm', 'QRadar',                                'qradar',                   'siem'),
      ('ibm', 'QRadar XDR',                            'qradar-xdr',               'edr'),
      ('ibm', 'IBM Cloud',                             'ibm-cloud',                'cloud_provider'),

      -- Rapid7
      ('rapid7', 'InsightVM',                          'insightvm',                'vuln_mgmt'),
      ('rapid7', 'Nexpose',                            'nexpose',                  'vuln_mgmt'),
      ('rapid7', 'InsightIDR',                         'insightidr',               'siem'),
      ('rapid7', 'Rapid7 MDR',                         'rapid7-mdr',               'mdr'),
      ('rapid7', 'InsightAppSec',                      'insightappsec',            'appsec'),

      -- Tenable
      ('tenable', 'Nessus',                            'nessus',                   'vuln_mgmt'),
      ('tenable', 'Tenable Vulnerability Management',  'tenable-vulnerability-management', 'vuln_mgmt'),
      ('tenable', 'Tenable Cloud Security',            'tenable-cloud-security',   'cspm'),
      ('tenable', 'Tenable OT Security',               'tenable-ot-security',      'iot_ot'),

      -- Qualys
      ('qualys', 'VMDR',                               'vmdr',                     'vuln_mgmt'),
      ('qualys', 'Qualys TotalCloud',                  'qualys-totalcloud',        'cspm'),
      ('qualys', 'Qualys WAS',                         'qualys-was',               'appsec'),

      -- Okta
      ('okta', 'Workforce Identity Cloud',             'workforce-identity-cloud', 'idp'),
      ('okta', 'Customer Identity Cloud (Auth0)',      'customer-identity-cloud',  'idp'),
      ('okta', 'Okta Verify',                          'okta-verify',              'mfa'),

      -- Ping Identity
      ('ping-identity', 'PingFederate',                'pingfederate',             'idp'),
      ('ping-identity', 'PingOne',                     'pingone',                  'idp'),
      ('ping-identity', 'PingID',                      'pingid',                   'mfa'),

      -- BeyondTrust
      ('beyondtrust', 'Password Safe',                 'password-safe',            'pam'),
      ('beyondtrust', 'Privileged Remote Access',      'privileged-remote-access', 'pam'),

      -- Delinea
      ('delinea', 'Secret Server',                     'secret-server',            'pam'),
      ('delinea', 'Privilege Manager',                 'privilege-manager',        'pam'),

      -- HashiCorp
      ('hashicorp', 'Vault',                           'vault',                    'pam'),

      -- RSA
      ('rsa', 'SecurID',                               'securid',                  'mfa'),
      ('rsa', 'NetWitness',                            'netwitness',               'siem'),

      -- Yubico
      ('yubico', 'YubiKey',                            'yubikey',                  'mfa'),

      -- Proofpoint
      ('proofpoint', 'Email Protection',               'email-protection',         'email_security'),
      ('proofpoint', 'Targeted Attack Protection',     'targeted-attack-protection','email_security'),
      ('proofpoint', 'Insider Threat Management',      'insider-threat-management','dlp'),
      ('proofpoint', 'Information Protection',         'information-protection',   'dlp'),

      -- Mimecast
      ('mimecast', 'Mimecast Email Security',          'mimecast-email-security',  'email_security'),

      -- Abnormal Security
      ('abnormal-security', 'Abnormal Email Security', 'abnormal-email-security',  'email_security'),

      -- Trellix (formerly FireEye + McAfee Enterprise)
      ('trellix', 'Trellix EDR',                       'trellix-edr',              'edr'),
      ('trellix', 'Trellix XDR',                       'trellix-xdr',              'siem'),
      ('trellix', 'Trellix DLP',                       'trellix-dlp',              'dlp'),
      ('trellix', 'Trellix Email Security',            'trellix-email-security',   'email_security'),

      -- Broadcom (Symantec + VMware Carbon Black)
      ('broadcom', 'Symantec Endpoint Protection',     'symantec-endpoint-protection','edr'),
      ('broadcom', 'Symantec DLP',                     'symantec-dlp',             'dlp'),
      ('broadcom', 'Carbon Black Cloud',               'carbon-black-cloud',       'edr'),
      ('broadcom', 'Symantec Web Security Service',    'symantec-web-security-service','sase'),

      -- Trend Micro
      ('trend-micro', 'Vision One',                    'vision-one',               'edr'),
      ('trend-micro', 'Apex One',                      'apex-one',                 'edr'),
      ('trend-micro', 'Cloud One',                     'cloud-one',                'cspm'),

      -- Tanium
      ('tanium', 'Tanium XEM',                         'tanium-xem',               'edr'),
      ('tanium', 'Tanium Comply',                      'tanium-comply',            'vuln_mgmt'),

      -- Cybereason
      ('cybereason', 'Cybereason Defense Platform',    'cybereason-defense-platform','edr'),

      -- Bitdefender
      ('bitdefender', 'GravityZone',                   'gravityzone',              'edr'),

      -- Wiz
      ('wiz', 'Wiz CNAPP',                             'wiz-cnapp',                'cspm'),
      ('wiz', 'Wiz Defend',                            'wiz-defend',               'cspm'),
      ('wiz', 'Wiz Code',                              'wiz-code',                 'appsec'),

      -- Lacework
      ('lacework', 'Lacework Polygraph',               'lacework-polygraph',       'cspm'),

      -- Orca Security
      ('orca-security', 'Orca Cloud Security Platform','orca-cloud-security-platform','cspm'),

      -- Snyk
      ('snyk', 'Snyk Code',                            'snyk-code',                'appsec'),
      ('snyk', 'Snyk Open Source',                     'snyk-open-source',         'appsec'),
      ('snyk', 'Snyk Container',                       'snyk-container',           'appsec'),
      ('snyk', 'Snyk Cloud',                           'snyk-cloud',               'cspm'),

      -- Aqua Security
      ('aqua-security', 'Aqua Cloud Native Platform',  'aqua-cloud-native-platform','cspm'),

      -- Sysdig
      ('sysdig', 'Sysdig Secure',                      'sysdig-secure',            'cspm'),

      -- Veracode
      ('veracode', 'Veracode Application Security',    'veracode-application-security','appsec'),

      -- Checkmarx
      ('checkmarx', 'Checkmarx One',                   'checkmarx-one',            'appsec'),

      -- Vectra AI
      ('vectra-ai', 'Vectra NDR',                      'vectra-ndr',               'ndr'),

      -- ExtraHop
      ('extrahop', 'Reveal(x)',                        'reveal-x',                 'ndr'),

      -- Darktrace
      ('darktrace', 'Darktrace Detect',                'darktrace-detect',         'ndr'),

      -- Corelight
      ('corelight', 'Corelight Open NDR',              'corelight-open-ndr',       'ndr'),

      -- Arctic Wolf
      ('arctic-wolf', 'Arctic Wolf MDR',               'arctic-wolf-mdr',          'mdr'),

      -- Red Canary
      ('red-canary', 'Red Canary MDR',                 'red-canary-mdr',           'mdr'),

      -- Expel
      ('expel', 'Expel MDR',                           'expel-mdr',                'mdr'),

      -- eSentire
      ('esentire', 'eSentire MDR',                     'esentire-mdr',             'mdr'),

      -- ReliaQuest
      ('reliaquest', 'GreyMatter',                     'greymatter',               'mdr'),

      -- ServiceNow
      ('servicenow', 'ServiceNow ITSM',                'servicenow-itsm',          'ticketing'),
      ('servicenow', 'Security Incident Response',     'security-incident-response','ticketing'),
      ('servicenow', 'Vulnerability Response',         'vulnerability-response',   'vuln_mgmt'),

      -- Atlassian
      ('atlassian', 'Jira Service Management',         'jira-service-management',  'ticketing'),

      -- Freshworks
      ('freshworks', 'Freshservice',                   'freshservice',             'ticketing'),

      -- Zendesk
      ('zendesk', 'Zendesk',                           'zendesk',                  'ticketing'),

      -- PagerDuty
      ('pagerduty', 'PagerDuty',                       'pagerduty',                'ticketing'),

      -- Cloud providers
      ('aws',    'AWS',                                'aws',                      'cloud_provider'),
      ('google', 'Google Cloud',                       'google-cloud',             'cloud_provider'),
      ('google', 'Google Workspace',                   'google-workspace',         'productivity_suite'),
      ('google', 'Chronicle',                          'chronicle',                'siem'),
      ('oracle', 'Oracle Cloud Infrastructure',        'oracle-cloud-infrastructure','cloud_provider'),

      -- Productivity suites (collab / docs / mail bundles)
      ('slack',  'Slack',                              'slack',                    'productivity_suite'),
      ('zoom',   'Zoom',                               'zoom',                     'productivity_suite'),

      -- Forcepoint
      ('forcepoint', 'Forcepoint DLP',                 'forcepoint-dlp',           'dlp'),
      ('forcepoint', 'Forcepoint CASB',                'forcepoint-casb',          'casb'),
      ('forcepoint', 'Forcepoint ONE',                 'forcepoint-one',           'sase'),

      -- Skyhigh Security (former McAfee MVISION)
      ('skyhigh-security', 'Skyhigh CASB',             'skyhigh-casb',             'casb'),
      ('skyhigh-security', 'Skyhigh Secure Web Gateway','skyhigh-secure-web-gateway','sase'),

      -- OT/IoT (no schema column yet — seeded for future use)
      ('claroty',         'Claroty xDome',             'claroty-xdome',            'iot_ot'),
      ('nozomi-networks', 'Guardian',                  'guardian',                 'iot_ot'),
      ('armis',           'Armis Centrix',             'armis-centrix',            'iot_ot'),
      ('dragos',          'Dragos Platform',           'dragos-platform',          'iot_ot'),

      -- VPN
      ('tailscale', 'Tailscale',                       'tailscale',                'vpn'),
      ('openvpn',   'OpenVPN Access Server',           'openvpn-access-server',    'vpn'),
      ('ivanti',    'Ivanti Connect Secure',           'ivanti-connect-secure',    'vpn'),

      -- SD-WAN
      ('aruba-networks', 'EdgeConnect SD-WAN',         'edgeconnect-sd-wan',       'sdwan'),
      ('aruba-networks', 'ClearPass',                  'clearpass',                'idp'),
      ('versa-networks', 'Versa SASE',                 'versa-sase',               'sase'),
      ('versa-networks', 'Versa SD-WAN',               'versa-sd-wan',             'sdwan'),
      ('cato-networks',  'Cato SASE Cloud',            'cato-sase-cloud',          'sase'),

      -- NAC / network identity
      ('forescout', 'Forescout Platform',              'forescout-platform',       'idp'),

      -- Akamai
      ('akamai', 'Akamai Connected Cloud',             'akamai-connected-cloud',   'sase'),
      ('akamai', 'Guardicore Segmentation',            'guardicore-segmentation',  'firewall')
    ) AS p(vendor_slug, name, slug, category)
    JOIN vendors v ON v.slug = p.vendor_slug
    ON CONFLICT (vendor_id, slug) DO UPDATE SET needs_review = FALSE;
  `);
};

exports.down = () => {
  // Intentional no-op. Removing seeded vendors/products would orphan references
  // in account_details.*_ids arrays (no FK enforcement on bigint[] elements).
  // If you genuinely need to remove a row, soft-delete via the GUI or write a
  // custom migration that first NULLs out references in account_details.
};
