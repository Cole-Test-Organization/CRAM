import AdmZip from 'adm-zip';
import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
  type IRunOptions,
} from 'docx';
import type { ExportFile } from './export.js';

const README = `Google Drive account export

Each account folder contains one Microsoft Word document for the account
overview, one for contacts (when contacts exist), and one document per meeting.

To put it in Google Drive:
1. Unzip this archive on your computer.
2. In Google Drive, choose New > Folder upload.
3. Select an extracted account folder, or the containing export folder when
   the archive includes multiple accounts.

Google Drive can open and edit the .docx files with Google Docs.
`;

/**
 * Turn the export service's lossless markdown representation into a folder of
 * Google Drive-friendly Word documents, then package that folder as a zip.
 */
export async function buildDriveArchive(files: ExportFile[]): Promise<Buffer> {
  const zip = new AdmZip();
  const roots = new Set<string>();

  for (const file of files) {
    const [root] = file.path.split('/');
    if (root) roots.add(root);
    zip.addFile(driveDocumentPath(file.path), await markdownToDocx(file.content));
  }

  if (roots.size === 1) {
    zip.addFile(`${[...roots][0]}/README.txt`, Buffer.from(README, 'utf8'));
  } else {
    zip.addFile('README.txt', Buffer.from(README, 'utf8'));
  }

  return zip.toBuffer();
}

export async function markdownToDocx(markdown: string): Promise<Buffer> {
  const paragraphs: Paragraph[] = [];
  let inCodeBlock = false;

  for (const sourceLine of String(markdown || '').replace(/\r\n?/g, '\n').split('\n')) {
    if (/^\s*```/.test(sourceLine)) {
      inCodeBlock = !inCodeBlock;
      continue;
    }

    if (inCodeBlock) {
      paragraphs.push(new Paragraph({
        children: [new TextRun({ text: sourceLine || ' ', font: 'Courier New', size: 20 })],
        indent: { left: 360 },
        spacing: { after: 40 },
      }));
      continue;
    }

    const heading = /^(#{1,4})\s+(.+)$/.exec(sourceLine);
    if (heading) {
      const levels = [
        HeadingLevel.TITLE,
        HeadingLevel.HEADING_1,
        HeadingLevel.HEADING_2,
        HeadingLevel.HEADING_3,
      ];
      paragraphs.push(new Paragraph({
        heading: levels[heading[1].length - 1],
        children: inlineRuns(heading[2]),
      }));
      continue;
    }

    const bullet = /^(\s*)[-*+]\s+(.+)$/.exec(sourceLine);
    if (bullet) {
      const level = Math.min(3, Math.floor(bullet[1].replace(/\t/g, '  ').length / 2));
      paragraphs.push(new Paragraph({
        bullet: { level },
        children: inlineRuns(normalizeCheckbox(bullet[2])),
        spacing: { after: 60 },
      }));
      continue;
    }

    const quote = /^\s*>\s?(.*)$/.exec(sourceLine);
    if (quote) {
      paragraphs.push(new Paragraph({
        children: inlineRuns(quote[1], { italics: true, color: '595959' }),
        indent: { left: 360 },
        spacing: { after: 80 },
      }));
      continue;
    }

    if (/^\s*(---+|___+|\*\*\*+)\s*$/.test(sourceLine)) {
      paragraphs.push(new Paragraph({
        children: [new TextRun({ text: '────────────────────────', color: 'A6A6A6' })],
        spacing: { before: 80, after: 80 },
      }));
      continue;
    }

    if (!sourceLine.trim()) {
      paragraphs.push(new Paragraph({ children: [new TextRun('')] }));
      continue;
    }

    paragraphs.push(new Paragraph({
      children: inlineRuns(normalizeCheckbox(sourceLine)),
      spacing: { after: 100 },
    }));
  }

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { font: 'Arial', size: 22 },
          paragraph: { spacing: { line: 276 } },
        },
      },
    },
    sections: [{
      properties: {
        page: {
          margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 },
        },
      },
      children: paragraphs.length > 0 ? paragraphs : [new Paragraph('')],
    }],
  });

  return Packer.toBuffer(doc);
}

function driveDocumentPath(path: string): string {
  const parts = path.split('/').filter(Boolean);
  const root = safePathPart(parts.shift() || 'account');
  const relative = parts.join('/');

  if (relative === '_account.md') return `${root}/Account Overview.docx`;
  if (relative === 'contacts.md') return `${root}/Contacts.docx`;

  const filename = safePathPart((parts.at(-1) || 'Meeting').replace(/\.md$/i, ''));
  return `${root}/Meetings/${filename}.docx`;
}

function safePathPart(value: string) {
  const cleaned = value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/[. ]+$/g, '').trim();
  return cleaned || 'Untitled';
}

function normalizeCheckbox(value: string) {
  return value.replace(/^\[ \]\s*/, '☐ ').replace(/^\[[xX]\]\s*/, '☒ ');
}

function inlineRuns(text: string, inherited: Partial<IRunOptions> = {}): TextRun[] {
  const runs: TextRun[] = [];
  const tokenPattern = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\[[^\]]+\]\([^)]+\)|\*[^*\n]+\*|_[^_\n]+_)/g;
  let cursor = 0;

  for (const match of text.matchAll(tokenPattern)) {
    const index = match.index ?? 0;
    if (index > cursor) runs.push(new TextRun({ ...inherited, text: text.slice(cursor, index) }));

    const token = match[0];
    if ((token.startsWith('**') && token.endsWith('**')) || (token.startsWith('__') && token.endsWith('__'))) {
      runs.push(new TextRun({ ...inherited, text: token.slice(2, -2), bold: true }));
    } else if (token.startsWith('`')) {
      runs.push(new TextRun({ ...inherited, text: token.slice(1, -1), font: 'Courier New' }));
    } else if (token.startsWith('[')) {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      runs.push(new TextRun({ ...inherited, text: link ? `${link[1]} (${link[2]})` : token }));
    } else {
      runs.push(new TextRun({ ...inherited, text: token.slice(1, -1), italics: true }));
    }
    cursor = index + token.length;
  }

  if (cursor < text.length) runs.push(new TextRun({ ...inherited, text: text.slice(cursor) }));
  return runs.length > 0 ? runs : [new TextRun({ ...inherited, text: '' })];
}
