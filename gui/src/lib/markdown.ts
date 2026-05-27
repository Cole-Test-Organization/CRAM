// Minimal safe markdown parser. Returns an AST; MarkdownRenderer.tsx walks it
// into JSX nodes (no innerHTML, no raw-HTML passthrough).
//
// Supported:
//   # / ## / ### headings, paragraphs, ``` fenced code, > blockquotes,
//   - / * / + unordered + 1. ordered lists, --- horizontal rules,
//   inline: **bold**, *italic*, `code`, [text](url), GFM single-newline → <br>.
//
// Not supported (rendered as plain text): nested lists, tables, images, raw
// HTML, reference-style links, autolinks.

export type InlineNode =
  | { type: 'text'; text: string }
  | { type: 'bold'; children: InlineNode[] }
  | { type: 'italic'; children: InlineNode[] }
  | { type: 'code'; text: string }
  | { type: 'link'; href: string; text: string }
  | { type: 'br' };

export type BlockNode =
  | { type: 'heading'; level: 1 | 2 | 3; children: InlineNode[] }
  | { type: 'paragraph'; children: InlineNode[] }
  | { type: 'codeBlock'; lang?: string; text: string }
  | { type: 'list'; ordered: boolean; items: InlineNode[][] }
  | { type: 'blockquote'; children: BlockNode[] }
  | { type: 'hr' };

export function parseMarkdown(source: string): BlockNode[] {
  const lines = (source || '').replace(/\r\n?/g, '\n').split('\n');
  const blocks: BlockNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (/^\s*$/.test(line)) {
      i++;
      continue;
    }

    if (/^\s{0,3}(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push({ type: 'hr' });
      i++;
      continue;
    }

    const headingMatch = line.match(/^\s{0,3}(#{1,3})\s+(.+?)\s*#*\s*$/);
    if (headingMatch) {
      const level = headingMatch[1].length as 1 | 2 | 3;
      blocks.push({ type: 'heading', level, children: parseInline(headingMatch[2]) });
      i++;
      continue;
    }

    const fenceMatch = line.match(/^\s{0,3}```\s*(\S+)?\s*$/);
    if (fenceMatch) {
      const lang = fenceMatch[1];
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !/^\s{0,3}```\s*$/.test(lines[i])) {
        codeLines.push(lines[i]);
        i++;
      }
      i++;
      blocks.push({ type: 'codeBlock', lang, text: codeLines.join('\n') });
      continue;
    }

    if (/^\s{0,3}>/.test(line)) {
      const quoteLines: string[] = [];
      while (i < lines.length && /^\s{0,3}>/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^\s{0,3}>\s?/, ''));
        i++;
      }
      blocks.push({ type: 'blockquote', children: parseMarkdown(quoteLines.join('\n')) });
      continue;
    }

    const listMatch = line.match(/^\s{0,3}([-*+]|\d+\.)\s+(.*)$/);
    if (listMatch) {
      const ordered = /^\d+\.$/.test(listMatch[1]);
      const items: InlineNode[][] = [];
      while (i < lines.length) {
        const m = lines[i].match(/^\s{0,3}([-*+]|\d+\.)\s+(.*)$/);
        if (!m) break;
        if (ordered !== /^\d+\.$/.test(m[1])) break;
        items.push(parseInline(m[2]));
        i++;
      }
      blocks.push({ type: 'list', ordered, items });
      continue;
    }

    const paraLines: string[] = [line];
    i++;
    while (i < lines.length && !isBlockOpener(lines[i])) {
      paraLines.push(lines[i]);
      i++;
    }
    blocks.push({ type: 'paragraph', children: parseInline(paraLines.join('\n')) });
  }

  return blocks;
}

function isBlockOpener(line: string): boolean {
  if (/^\s*$/.test(line)) return true;
  if (/^\s{0,3}#{1,3}\s+/.test(line)) return true;
  if (/^\s{0,3}(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) return true;
  if (/^\s{0,3}```/.test(line)) return true;
  if (/^\s{0,3}>/.test(line)) return true;
  if (/^\s{0,3}([-*+]|\d+\.)\s+/.test(line)) return true;
  return false;
}

function parseInline(source: string): InlineNode[] {
  const out: InlineNode[] = [];
  let buf = '';
  let i = 0;

  const flushText = () => {
    if (buf) {
      out.push({ type: 'text', text: buf });
      buf = '';
    }
  };

  while (i < source.length) {
    const ch = source[i];

    if (ch === '\n') {
      flushText();
      out.push({ type: 'br' });
      i++;
      continue;
    }

    if (ch === '`') {
      const end = source.indexOf('`', i + 1);
      if (end !== -1) {
        flushText();
        out.push({ type: 'code', text: source.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }

    if ((ch === '*' || ch === '_') && source[i + 1] === ch) {
      const marker = ch + ch;
      const end = source.indexOf(marker, i + 2);
      if (end !== -1 && end > i + 2) {
        flushText();
        out.push({ type: 'bold', children: parseInline(source.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }

    if (ch === '*' || ch === '_') {
      const end = findUnpaired(source, i + 1, ch);
      if (end !== -1 && end > i + 1) {
        flushText();
        out.push({ type: 'italic', children: parseInline(source.slice(i + 1, end)) });
        i = end + 1;
        continue;
      }
    }

    if (ch === '[') {
      const closeBracket = findMatchingBracket(source, i);
      if (closeBracket !== -1 && source[closeBracket + 1] === '(') {
        const closeParen = source.indexOf(')', closeBracket + 2);
        if (closeParen !== -1) {
          flushText();
          out.push({
            type: 'link',
            text: source.slice(i + 1, closeBracket),
            href: source.slice(closeBracket + 2, closeParen),
          });
          i = closeParen + 1;
          continue;
        }
      }
    }

    buf += ch;
    i++;
  }

  flushText();
  return out;
}

function findUnpaired(source: string, from: number, ch: string): number {
  for (let j = from; j < source.length; j++) {
    if (source[j] === ch && source[j + 1] !== ch && source[j - 1] !== ch) return j;
  }
  return -1;
}

function findMatchingBracket(source: string, openIdx: number): number {
  let depth = 0;
  for (let j = openIdx; j < source.length; j++) {
    if (source[j] === '[') depth++;
    else if (source[j] === ']') {
      depth--;
      if (depth === 0) return j;
    }
  }
  return -1;
}

// Only http(s), mailto, relative paths, and anchor links are allowed in link
// hrefs. Anything else (javascript:, data:, etc) is reduced to "#" so a
// malicious markdown source can't smuggle script URLs into the rendered DOM.
export function safeHref(href: string): string {
  return /^(https?:|mailto:|\/|#)/i.test(href) ? href : '#';
}
