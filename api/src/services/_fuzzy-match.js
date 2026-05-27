// Helpers for fuzzy-matching candidate names against existing catalog rows in
// vendors / vendor_products findOrCreate. The DB does the actual trigram
// math via pg_trgm.similarity(); this file owns the normalization and the
// shared threshold so both call sites stay aligned.

export const FUZZY_THRESHOLD = 0.4;

// Common corporate suffixes that mean nothing semantically. Stripped from the
// candidate before vendor matching so "Aruba" finds "Aruba Networks", "Versa"
// finds "Versa Networks", etc.
const VENDOR_GENERIC_SUFFIXES = [
  'networks', 'security', 'systems', 'technologies', 'software',
  'group', 'corporation', 'corp', 'inc', 'incorporated', 'ltd', 'llc', 'co',
];

// Words the LLM tends to append redundantly to product names (often when it
// only had the category to go on). Stripped before product matching so
// "FortiGate Platform" finds "FortiGate", "Defender for Endpoint Cloud" finds
// "Defender for Endpoint", etc.
const PRODUCT_GENERIC_WORDS = [
  'platform', 'cloud', 'service', 'services', 'solution', 'software',
];

function stripWords(s, words) {
  let out = ` ${s.toLowerCase()} `;
  for (const w of words) {
    out = out.replace(new RegExp(`\\s+${w}\\s+`, 'g'), ' ');
  }
  return out.replace(/\s+/g, ' ').trim();
}

export function normalizeVendorName(name) {
  return stripWords((name || '').replace(/[^a-z0-9\s]/gi, ' '), VENDOR_GENERIC_SUFFIXES);
}

// Strip the vendor name prefix from a product so "CyberArk Identity" + vendor
// "CyberArk" → "identity". Also drops common generic trailing words.
export function normalizeProductName(name, vendorName) {
  let n = (name || '').toLowerCase().replace(/[^a-z0-9\s]/gi, ' ');
  const v = (vendorName || '').toLowerCase().replace(/[^a-z0-9\s]/gi, ' ').trim();
  if (v && n.trim().startsWith(v + ' ')) {
    n = n.trim().slice(v.length);
  }
  return stripWords(n, PRODUCT_GENERIC_WORDS);
}
