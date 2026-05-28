import { slugifyForFilename, isoToday } from './textExport';
import { stageShort } from './stages';

export type ExportableOpportunity = {
  id: number;
  name?: string | null;
  account_name?: string | null;
  stage?: string | null;
  notes?: string | null;
  why_change?: string[] | null;
  why_now?: string[] | null;
  why_us?: string[] | null;
  created_at?: string | null;
  product_count?: number | null;
};

function oppName(o: ExportableOpportunity): string {
  return (o.name || '').trim() || 'Untitled opportunity';
}

function bulletBlock(items: string[] | null | undefined, label: string): string[] {
  if (!items || items.length === 0) return [];
  const cleaned = items.map((v) => (v || '').trim()).filter(Boolean);
  if (cleaned.length === 0) return [];
  return [`${label}:`, ...cleaned.map((v) => `  - ${v}`)];
}

export function formatOpportunity(o: ExportableOpportunity): string {
  const lines: string[] = [oppName(o)];
  if (o.account_name) lines.push(`Account: ${o.account_name}`);
  if (o.stage) lines.push(`Stage: ${stageShort(o.stage) || o.stage}`);
  if (o.created_at) lines.push(`Created: ${(o.created_at || '').slice(0, 10)}`);

  const blocks = [
    bulletBlock(o.why_change, 'Why Change'),
    bulletBlock(o.why_now, 'Why Now'),
    bulletBlock(o.why_us, 'Why Us'),
  ].filter((b) => b.length > 0);
  for (const b of blocks) {
    lines.push('');
    lines.push(...b);
  }

  const notes = (o.notes || '').trim();
  if (notes) {
    lines.push('');
    lines.push('Notes:');
    lines.push(notes);
  }
  return lines.join('\n');
}

export function formatOpportunities(opps: ExportableOpportunity[]): string {
  return opps.map(formatOpportunity).join('\n\n---\n\n') + '\n';
}

export function opportunitiesFilename(opps: ExportableOpportunity[]): string {
  if (opps.length === 1) {
    return `${isoToday()}-${slugifyForFilename(oppName(opps[0]))}.txt`;
  }
  return `opportunities-${isoToday()}-${opps.length}.txt`;
}

export function buildOpportunitiesExport(opps: ExportableOpportunity[]) {
  return { text: formatOpportunities(opps), filename: opportunitiesFilename(opps) };
}
