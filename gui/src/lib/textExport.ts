// Shared text-export primitives used by meeting/contact/opportunity exports
// and the generic <ExportActions> component. Anything that knows about a
// specific entity (meetings, contacts, opps) goes in its own *Export.ts file
// and uses these helpers — keeps the per-entity files focused on formatting.

import { todayLocalDate } from '../utils/date';
import { slugifyWithFallback } from './slug';

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function downloadTextFile(content: string, filename: string): void {
  downloadBlob(new Blob([content], { type: 'text/plain;charset=utf-8' }), filename);
}

export async function copyTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  // Fallback for non-secure contexts where the async Clipboard API isn't available.
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  document.body.removeChild(ta);
}

export function slugifyForFilename(s: string): string {
  return slugifyWithFallback(s, 'export');
}

export function isoToday(): string {
  return todayLocalDate();
}

// Every per-entity export file needs the same three things on top of its own
// `format(item)`: join many records with a rule, name the file, and package the
// pair for <ExportActions build={…}>. This builds all three from the one piece
// that actually differs.
export function makeExportBuilder<T>(opts: {
  // Render one record as plain text.
  format: (item: T) => string;
  // Display name of one record — used for the single-record filename stem.
  nameOf: (item: T) => string;
  // Filename stem when exporting more than one (e.g. 'meetings').
  plural: string;
  // Date to prefix a single-record filename with. Defaults to today.
  dateOf?: (item: T) => string | null | undefined;
}) {
  const formatMany = (items: T[]): string =>
    items.map(opts.format).join('\n\n---\n\n') + '\n';

  const filename = (items: T[]): string => {
    if (items.length === 1) {
      const date = opts.dateOf?.(items[0]) || isoToday();
      return `${date}-${slugifyForFilename(opts.nameOf(items[0]))}.txt`;
    }
    return `${opts.plural}-${isoToday()}-${items.length}.txt`;
  };

  return {
    formatMany,
    filename,
    build: (items: T[]) => ({ text: formatMany(items), filename: filename(items) }),
  };
}
