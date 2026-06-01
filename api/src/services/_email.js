// Email-string helpers shared across the meeting + import services.

import { normalizeDomain } from './_domain.js';

// Normalize a single email: trim + lowercase, and require an "@". Returns null
// for anything that doesn't look like an address.
export function normalizeEmail(e) {
  if (!e || typeof e !== 'string') return null;
  const v = e.trim().toLowerCase();
  return v.includes('@') ? v : null;
}

// Parse a free-form list of email strings into deduped
// { email, domain, name_guess } records. Designed to be forgiving — calendar
// invites paste in lots of different shapes:
//   - bare emails:                          "jane@acme.com"
//   - RFC-5322 addr-spec:                   "Jane Doe <jane@acme.com>"
//   - quoted display names (incl. commas):  '"Smith, John" <jsmith@acme.com>'
//   - mixed comma / semicolon / newline separation
//   - leading/trailing prose ("Attendees: a@x.com, B <b@x.com>. Thanks.")
//
// Strategy: don't pre-split (a comma inside a quoted display name would
// shred it). Instead, scan the input directly for emails:
//   pass 1 finds 'Name <email>' forms and captures the display name from
//   whatever immediately precedes the angle bracket;
//   pass 2 picks up any remaining bare emails the first pass didn't claim.
export function parseEmailList(text) {
  if (!text) return [];
  const seen = new Map();
  const EMAIL_BODY = '[A-Z0-9._%+\\-]+@[A-Z0-9.\\-]+\\.[A-Z]{2,}';

  function add(email, displayName) {
    const e = String(email || '').toLowerCase();
    if (!e || seen.has(e)) return;
    const cleaned = String(displayName || '')
      .replace(/^[\s,;]+|[\s,;.]+$/g, '')
      .replace(/^["']|["']$/g, '')
      .trim();
    const [, domainRaw] = e.split('@');
    const domain = normalizeDomain(domainRaw);
    // Only a genuine display name becomes name_guess. We deliberately do NOT
    // derive a name from the email local-part ("jsmith" → "Jsmith") anymore:
    // an address-only attendee stays nameless (name_guess = null) and is stored
    // as an email-only contact, with the real name filled in later if a future
    // event carries one.
    const nameGuess = cleaned || null;
    seen.set(e, { email: e, domain, name_guess: nameGuess });
  }

  // Pass 1: "Display Name <email>" — quoted name preserved intact (including
  // any commas inside the quotes), unquoted display bounded by `,;<\n` so it
  // can't slurp text from the previous attendee.
  const bracketRe = new RegExp(
    `(?:"([^"]+)"|'([^']+)'|([^<,;\\n]*?))\\s*<\\s*(${EMAIL_BODY})\\s*>`,
    'gi'
  );
  const remainder = String(text).replace(bracketRe, (_full, q1, q2, plain, email) => {
    add(email, q1 || q2 || plain || '');
    // Blank out the matched span so pass 2 doesn't re-grab the same email.
    return ' '.repeat(_full.length);
  });

  // Pass 2: any bare emails left over (no angle brackets around them).
  const bareRe = new RegExp(EMAIL_BODY, 'gi');
  let m;
  while ((m = bareRe.exec(remainder)) !== null) {
    add(m[0], '');
  }

  return [...seen.values()];
}
