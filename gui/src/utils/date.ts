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
