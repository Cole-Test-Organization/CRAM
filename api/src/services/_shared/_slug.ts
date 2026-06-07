export function slugify(str: unknown): string {
  if (!str) return '';
  return String(str)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function deriveFilename(
  date: string,
  title?: string | null,
  providedFilename?: string | null,
): string {
  if (providedFilename) {
    const stem = providedFilename.replace(/\.md$/i, '');
    const slug = slugify(stem);
    return slug ? `${slug}.md` : `${date}.md`;
  }
  const titleSlug = title ? slugify(title) : '';
  return titleSlug ? `${date}-${titleSlug}.md` : `${date}.md`;
}
