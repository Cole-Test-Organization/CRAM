import { slugifyForFilename, isoToday } from './textExport';

export type ExportableContact = {
  id: number;
  full_name?: string | null;
  title?: string | null;
  email?: string | null;
  phone?: string | null;
  linkedin?: string | null;
  notes?: string | null;
  company?: string | null;
  // Global list view only — comma-joined list of every account the contact is linked to.
  account_names?: string | null;
  kind?: string | null;
};

function contactName(c: ExportableContact): string {
  return (c.full_name || '').trim() || 'Unnamed contact';
}

export function formatContact(c: ExportableContact): string {
  const lines: string[] = [contactName(c)];
  if (c.title) lines.push(`Title: ${c.title}`);
  // account_names (global list) lists every linked account; company (per-account
  // list) is a free-text field on the contact itself. Prefer account_names when
  // we have it.
  const company = c.account_names || c.company;
  if (company) lines.push(`Company: ${company}`);
  if (c.email) lines.push(`Email: ${c.email}`);
  if (c.phone) lines.push(`Phone: ${c.phone}`);
  if (c.linkedin) lines.push(`LinkedIn: ${c.linkedin}`);
  if (c.kind && c.kind !== 'account') lines.push(`Kind: ${c.kind}`);
  const notes = (c.notes || '').trim();
  if (notes) {
    lines.push('');
    lines.push('Notes:');
    lines.push(notes);
  }
  return lines.join('\n');
}

export function formatContacts(contacts: ExportableContact[]): string {
  return contacts.map(formatContact).join('\n\n---\n\n') + '\n';
}

export function contactsFilename(contacts: ExportableContact[]): string {
  if (contacts.length === 1) {
    return `${isoToday()}-${slugifyForFilename(contactName(contacts[0]))}.txt`;
  }
  return `contacts-${isoToday()}-${contacts.length}.txt`;
}

export function buildContactsExport(contacts: ExportableContact[]) {
  return { text: formatContacts(contacts), filename: contactsFilename(contacts) };
}
