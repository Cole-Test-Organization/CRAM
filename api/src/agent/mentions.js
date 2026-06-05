// Resolve @-mentions the GUI attached to an agent prompt into compact identity
// cards. The point is to hand the model the EXACT record id (so it never has to
// search/disambiguate — the step small local models are worst at) plus just
// enough identity to know what it's holding. We deliberately summarize to one
// line per tag rather than inlining the full record: the fat getById fan-out
// (contacts + meetings + opportunities) would blow the local model's context
// window — the agent already has the id and can pull depth via tools on demand.

const MAX_MENTIONS = 20;

const isClosed = (stage) => typeof stage === "string" && stage.endsWith("_closed");
const day = (d) => (d ? String(d).slice(0, 10) : null);

function fmtAccount(a) {
    const parts = [a.name];
    if (a.status) parts.push(`status: ${a.status}`);
    const domain = Array.isArray(a.domains) ? a.domains[0] : a.domains;
    if (domain) parts.push(domain);

    const contacts = Array.isArray(a.contacts)
        ? a.contacts.length
        : typeof a.contact_count === "number"
          ? a.contact_count
          : null;
    if (contacts != null) parts.push(`${contacts} contact${contacts === 1 ? "" : "s"}`);

    const open =
        typeof a.active_deals === "number"
            ? a.active_deals
            : Array.isArray(a.opportunities)
              ? a.opportunities.filter((o) => !isClosed(o.stage)).length
              : null;
    if (open != null) parts.push(`${open} open opp${open === 1 ? "" : "s"}`);

    const last =
        day(a.last_contact) ||
        (Array.isArray(a.meetings)
            ? day(a.meetings.map((m) => m.date).filter(Boolean).sort().at(-1))
            : null);
    if (last) parts.push(`last contact ${last}`);

    return parts.join(" · ");
}

function fmtContact(c) {
    const head = c.full_name || c.email || `contact ${c.id}`;
    const parts = [head];
    const company =
        c.company || (Array.isArray(c.accounts) && c.accounts[0]?.name) || null;
    const role = [c.title, company].filter(Boolean).join(" @ ");
    if (role) parts.push(role);
    if (c.email && c.email !== head) parts.push(c.email);
    if (c.kind && c.kind !== "account") parts.push(`kind: ${c.kind}`);
    return parts.join(" · ");
}

function fmtOpp(o, m) {
    const parts = [o.name];
    if (o.stage) parts.push(`stage: ${o.stage}`);
    // opp getById carries account_id but not the account name; the mention slug
    // (account_slug from search) is the friendlier handle when we have it.
    const acct = m?.slug || (o.account_id != null ? `account #${o.account_id}` : null);
    if (acct) parts.push(`account: ${acct}`);
    return parts.join(" · ");
}

function fmtMeeting(mt) {
    const parts = [];
    const d = day(mt.date);
    if (d) parts.push(d);
    parts.push(mt.title ? `"${mt.title}"` : "(untitled)");
    if (mt.account_name) parts.push(`account: ${mt.account_name}`);
    else if (mt.internal) parts.push("internal");
    return parts.join(" · ");
}

async function resolveOne(userId, m, services) {
    const id = Number(m.id);
    if (!Number.isFinite(id)) return null;
    const notFound = `[${m.type} #${m.id}] ${m.label} — NOT FOUND (deleted, or not yours)`;

    switch (m.type) {
        // partner and account are the same table (status discriminates) — both
        // resolve through the accounts service.
        case "account":
        case "partner": {
            const a = await services.accountsService.getById(userId, id);
            return a ? `[${m.type} #${id}] ${fmtAccount(a)}` : notFound;
        }
        case "contact": {
            const c = await services.contactsService.getById(userId, id);
            return c ? `[contact #${id}] ${fmtContact(c)}` : notFound;
        }
        case "opportunity": {
            const o = await services.opportunitiesService.getById(userId, id);
            return o ? `[opportunity #${id}] ${fmtOpp(o, m)}` : notFound;
        }
        case "meeting": {
            const mt = await services.meetingsService.getById(userId, id);
            return mt ? `[meeting #${id}] ${fmtMeeting(mt)}` : notFound;
        }
        default:
            return null;
    }
}

/**
 * Turn the prompt's @-mentions into a `--- TAGGED RECORDS ---` block to append
 * to the user message. Returns '' when there's nothing to add.
 *
 * @param {number} userId
 * @param {Array<{type:string,id:number,label:string,slug?:string}>} mentions
 * @param {object} services  the same services bag the MCP session built (so RLS
 *   and dependency wiring match the agent's own tool calls)
 */
export async function resolveMentions(userId, mentions, services) {
    if (!Array.isArray(mentions) || mentions.length === 0) return "";
    if (!services) return "";

    const capped = mentions.slice(0, MAX_MENTIONS);
    const lines = [];
    for (const m of capped) {
        try {
            const line = await resolveOne(userId, m, services);
            if (line) lines.push(line);
        } catch (err) {
            // A single bad/stale tag must not kill the turn — record and move on.
            lines.push(`[${m?.type} #${m?.id}] ${m?.label ?? ""} — (lookup failed: ${err?.message || "error"})`);
        }
    }
    if (lines.length === 0) return "";

    let block =
        "--- TAGGED RECORDS (the user @-tagged these; ids are already resolved — use them directly, do NOT search) ---\n" +
        lines.join("\n");
    if (mentions.length > capped.length) {
        block += `\n(+${mentions.length - capped.length} more tag(s) omitted — limit ${MAX_MENTIONS})`;
    }
    return block;
}
