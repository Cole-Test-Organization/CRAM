// Dependency-free HTML → markdown/text conversion. Inputs are small chunks of
// HTML (calendar descriptions: Zoom invites, agenda bullets); we don't need a
// full parser, just enough structure (headings, lists, links, line breaks) to
// make the result readable for review. Anything we can't map is stripped.

function safeFromCodePoint(n: number): string {
  try {
    if (!Number.isFinite(n) || n < 0 || n > 0x10ffff) return '';
    return String.fromCodePoint(n);
  } catch {
    return '';
  }
}

function stripTags(s: string): string {
  return String(s).replace(/<[^>]+>/g, '');
}

export function decodeEntities(s: string): string {
  return String(s)
    .replace(/&nbsp;|&#160;|&#xa0;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#0?39;|&#x27;/gi, "'")
    .replace(/&#(\d+);/g, (_m: string, n: string) => safeFromCodePoint(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_m: string, n: string) => safeFromCodePoint(parseInt(n, 16)));
}

export function htmlToMarkdown(html: unknown): string {
  if (!html || typeof html !== 'string') return '';
  let s = html;
  // Drop script/style outright.
  s = s.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '');
  // Links → [text](href).
  s = s.replace(/<a\b[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m: string, href: string, text: string) => {
    const t = stripTags(text).trim();
    const h = (href || '').trim();
    if (!t) return h;
    if (!h || h.toLowerCase() === t.toLowerCase()) return t;
    return `[${t}](${h})`;
  });
  // Headings → markdown headings.
  s = s.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_m: string, lvl: string, text: string) => `\n\n${'#'.repeat(Number(lvl))} ${stripTags(text).trim()}\n\n`);
  // List items → "- " bullets.
  s = s.replace(/<li\b[^>]*>/gi, '\n- ').replace(/<\/li>/gi, '');
  // Block-level closes → paragraph breaks; <br> → single newline.
  s = s.replace(/<\/(p|div|ul|ol|tr|table|blockquote|h[1-6])>/gi, '\n\n');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  // Strip whatever inline tags remain (<b>, <i>, <u>, <span>, …).
  s = stripTags(s);
  s = decodeEntities(s);
  // Tidy whitespace.
  return s
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/^[ \t]+|[ \t]+$/gm, '')
    .trim();
}
