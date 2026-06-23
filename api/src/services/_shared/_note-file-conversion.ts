import AdmZip from 'adm-zip';
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';

export interface NoteFile {
  path: string;
  content: string;
}

export interface NoteFileSkip {
  path: string;
  reason: string;
  message?: string;
}

export interface NoteFileImportSummary {
  total_entries: number;
  files: number;
  text_files: number;
  converted_files: number;
  docx_files: number;
  pdf_files: number;
  skipped_files: number;
  skipped_by_reason: Record<string, number>;
  skipped_entries: NoteFileSkip[];
}

export interface NoteFilesFromZipResult {
  files: NoteFile[];
  summary: NoteFileImportSummary;
}

export const TEXT_NOTE_EXTENSIONS = new Set(['.md', '.markdown', '.mdown', '.txt', '.text', '.org', '.rst']);
export const CONVERTIBLE_NOTE_EXTENSIONS = new Set(['.docx', '.pdf']);

const MAX_ZIP_ENTRY_BYTES = Number(process.env.NOTES_IMPORT_MAX_ZIP_ENTRY_BYTES) || 25 * 1024 * 1024;
const MAX_REPORTED_SKIPS = Number(process.env.NOTES_IMPORT_MAX_REPORTED_SKIPS) || 25;

export const SUPPORTED_NOTE_FILE_DESCRIPTION = '.md/.markdown/.txt/.org/.rst/.docx/.pdf';

export async function noteFilesFromZip(buffer: Buffer): Promise<NoteFilesFromZipResult> {
  const zip = new AdmZip(buffer);
  const files: NoteFile[] = [];
  const summary: NoteFileImportSummary = {
    total_entries: 0,
    files: 0,
    text_files: 0,
    converted_files: 0,
    docx_files: 0,
    pdf_files: 0,
    skipped_files: 0,
    skipped_by_reason: {},
    skipped_entries: [],
  };

  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    summary.total_entries++;

    const path = entry.entryName;
    if (isJunkPath(path)) {
      recordSkip(summary, path, 'junk');
      continue;
    }

    const size = Number(entry.header?.size || 0);
    if (size > MAX_ZIP_ENTRY_BYTES) {
      recordSkip(summary, path, 'too_large', `Entry is larger than ${MAX_ZIP_ENTRY_BYTES} bytes.`);
      continue;
    }

    const ext = extensionOf(path);
    if (TEXT_NOTE_EXTENSIONS.has(ext)) {
      const content = entry.getData().toString('utf8');
      if (!content.trim()) {
        recordSkip(summary, path, 'empty');
        continue;
      }
      files.push({ path, content });
      summary.text_files++;
      continue;
    }

    if (!CONVERTIBLE_NOTE_EXTENSIONS.has(ext)) {
      recordSkip(summary, path, 'unsupported');
      continue;
    }

    try {
      const content = await convertEntryToText(path, entry.getData(), ext);
      if (!content.trim()) {
        recordSkip(summary, path, 'empty_converted', `${ext} did not contain extractable text.`);
        continue;
      }
      files.push({ path, content });
      summary.converted_files++;
      if (ext === '.docx') summary.docx_files++;
      if (ext === '.pdf') summary.pdf_files++;
    } catch (err) {
      recordSkip(summary, path, 'conversion_failed', (err as Error).message || String(err));
    }
  }

  summary.files = files.length;
  return { files, summary };
}

export function isSupportedNotePath(path: string) {
  const ext = extensionOf(path);
  return TEXT_NOTE_EXTENSIONS.has(ext) || CONVERTIBLE_NOTE_EXTENSIONS.has(ext);
}

async function convertEntryToText(path: string, buffer: Buffer, ext: string) {
  if (ext === '.docx') return convertDocxToText(buffer);
  if (ext === '.pdf') return convertPdfToText(buffer);
  throw new Error(`Unsupported file type for conversion: ${path}`);
}

async function convertDocxToText(buffer: Buffer) {
  const result = await mammoth.extractRawText({ buffer });
  return normalizeExtractedText(result.value || '');
}

async function convertPdfToText(buffer: Buffer) {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return normalizeExtractedText(result.text || '');
  } finally {
    await parser.destroy();
  }
}

function normalizeExtractedText(text: string) {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

function extensionOf(path: string) {
  const slash = path.lastIndexOf('/');
  const dot = path.lastIndexOf('.');
  return dot > slash ? path.slice(dot).toLowerCase() : '';
}

function isJunkPath(path: string) {
  return /(^|\/)(__MACOSX\/|\.DS_Store$|\._)/.test(path);
}

function recordSkip(summary: NoteFileImportSummary, path: string, reason: string, message?: string) {
  summary.skipped_files++;
  summary.skipped_by_reason[reason] = (summary.skipped_by_reason[reason] || 0) + 1;
  if (summary.skipped_entries.length < MAX_REPORTED_SKIPS) {
    summary.skipped_entries.push({ path, reason, ...(message ? { message } : {}) });
  }
}
