export function formatRelative(iso: string): string {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return "just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay)
        return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    const yest = new Date(now.getTime() - 86400000);
    if (d.toDateString() === yest.toDateString()) return "yesterday";
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffDays < 7) return `${diffDays}d ago`;
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function formatDateTime(value: string | null | undefined, options?: Intl.DateTimeFormatOptions): string {
    if (!value) return "not started";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return options ? date.toLocaleString("en-US", options) : date.toLocaleString();
}

export function formatShortDate(value: string | null | undefined): string {
    if (!value) return "";
    const dateOnly = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const date = dateOnly
        ? new Date(Date.UTC(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3])))
        : new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
        ...(dateOnly ? { timeZone: "UTC" } : {}),
    });
}

// A Date → YYYY-MM-DD in the browser's LOCAL calendar day.
//
// Use this instead of `someDate.toISOString().slice(0, 10)`. toISOString() is
// always UTC, so once it's past ~5-8pm in the Americas the UTC date has already
// rolled to tomorrow — which silently shifts "today" defaults and date
// comparisons a day forward every evening. getFullYear/getMonth/getDate read the
// local calendar instead. Returns '' for an invalid Date.
export function localDateStr(d: Date): string {
    if (Number.isNaN(d.getTime())) return "";
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

// Today's date as YYYY-MM-DD in the browser's local zone. The local-safe
// replacement for `new Date().toISOString().slice(0, 10)`.
export function todayLocalDate(): string {
    return localDateStr(new Date());
}
