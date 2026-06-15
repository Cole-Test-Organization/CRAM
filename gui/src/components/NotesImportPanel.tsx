import { createSignal, onCleanup, Show, For } from 'solid-js';
import { A } from '@solidjs/router';
import { api, type NotesImportJob, type NotesImportResult, type NotesImportOutcome } from '../lib/api';
import Button from './Button';

// Text extensions we'll read from a chosen folder. Binary document conversion
// happens server-side for .zip uploads so the folder path can stay lightweight.
const TEXT_EXT = ['.md', '.markdown', '.mdown', '.txt', '.text', '.org', '.rst'];
const MAX_FILE_BYTES = 2 * 1024 * 1024; // skip any single file bigger than this

function isTextFile(name: string) {
  const lower = name.toLowerCase();
  return TEXT_EXT.some((e) => lower.endsWith(e));
}

function humanBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const OUTCOME: Record<NotesImportOutcome, { label: string; cls: string }> = {
  linked:  { label: 'Linked',      cls: 'text-surf-300 bg-surf-500/10 border-surf-500/50' },
  created: { label: 'New account', cls: 'text-amber-300 bg-amber-500/10 border-amber-500/50' },
  parked:  { label: 'Parked',      cls: 'text-papaya-300 bg-papaya-500/10 border-papaya-500/50' },
  skipped: { label: 'Skipped',     cls: 'text-base-300 bg-base-500/10 border-base-500/50' },
  error:   { label: 'Error',       cls: 'text-scarlet-300 bg-scarlet-500/10 border-scarlet-500/50' },
};

function parkedReason(reason?: string | null) {
  switch (reason) {
    case 'ambiguous': return 'looks like an existing account — open to assign';
    case 'internal': return 'internal note (no customer)';
    case 'no_account_hint': return 'no company identified — open to assign';
    default: return 'parked for review';
  }
}

export default function NotesImportPanel() {
  // idle → reading (folder) → submitting → tracking (polling the job)
  const [phase, setPhase] = createSignal<'idle' | 'reading' | 'submitting' | 'tracking'>('idle');
  const [job, setJob] = createSignal<NotesImportJob | null>(null);
  const [error, setError] = createSignal('');
  const [readInfo, setReadInfo] = createSignal<{ kept: number; skipped: number; bytes: number; converted?: number } | null>(null);
  // The job we're tracking, kept so the error block's Retry can re-enter polling.
  const [trackingId, setTrackingId] = createSignal<string | null>(null);

  // Tolerate a few transient poll blips before giving up — a long, LLM-backed
  // import shouldn't wedge the panel because one fetch failed.
  const MAX_POLL_FAILURES = 5;

  let zipInput!: HTMLInputElement;
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => { if (pollTimer) clearTimeout(pollTimer); });

  const running = () => {
    const j = job();
    return phase() === 'reading' || phase() === 'submitting'
      || (phase() === 'tracking' && (j?.status === 'queued' || j?.status === 'running'));
  };

  const pct = () => {
    const j = job();
    if (!j || !j.total) return 0;
    return Math.round((j.processed / j.total) * 100);
  };

  const reset = () => { setError(''); setJob(null); setReadInfo(null); setTrackingId(null); };

  const track = (jobId: string) => {
    if (pollTimer) { clearTimeout(pollTimer); pollTimer = undefined; }
    setError('');
    setTrackingId(jobId);
    setPhase('tracking');
    let failures = 0;
    const poll = async () => {
      try {
        const j = await api.getNotesImportJob(jobId);
        failures = 0;
        setJob(j);
        setError('');
        if (j.status === 'completed' || j.status === 'failed') return;
      } catch (e: any) {
        failures += 1;
        if (failures >= MAX_POLL_FAILURES) {
          // Give up: drop the stale job snapshot so running() is false again and
          // the import buttons re-enable. The server-side job may still be fine,
          // so the error block offers a Retry that re-enters polling.
          setJob(null);
          setPhase('idle');
          setError(`Lost contact with the import (${e?.message || String(e)}). The import may still be running — retry to reconnect.`);
          return;
        }
        // Transient blip: surface it but keep polling at the same cadence.
        setError(`Connection hiccup, retrying… (${e?.message || String(e)})`);
      }
      pollTimer = setTimeout(poll, 1500);
    };
    poll();
  };

  // Re-enter polling for the job we were tracking (or, if it's gone, just reset).
  const retryTracking = () => {
    const id = trackingId();
    if (id) track(id);
    else reset();
  };

  const onFolderChosen = async (fileList: FileList) => {
    reset();
    setPhase('reading');
    try {
      const files: Array<{ path: string; content: string }> = [];
      let skipped = 0, bytes = 0;
      for (const f of Array.from(fileList)) {
        const path = (f as any).webkitRelativePath || f.name;
        if (!isTextFile(path) || f.size > MAX_FILE_BYTES) { skipped++; continue; }
        const content = await f.text();
        if (!content.trim()) { skipped++; continue; }
        files.push({ path, content });
        bytes += f.size;
      }
      setReadInfo({ kept: files.length, skipped, bytes, converted: 0 });
      if (files.length === 0) {
        setError('No text notes (.md / .txt / .org / .rst) found in that folder. For .docx or .pdf files, zip the folder and use the zip import.');
        setPhase('idle');
        return;
      }
      setPhase('submitting');
      const { jobId } = await api.importNotes(files);
      track(jobId);
    } catch (e: any) {
      setError(e?.message || String(e));
      setPhase('idle');
    }
  };

  const onZipChosen = async (file: File) => {
    reset();
    setPhase('submitting');
    try {
      const { jobId, file_count, skipped_count, converted_count } = await api.importNotesZip(file);
      setReadInfo({
        kept: file_count,
        skipped: skipped_count || 0,
        converted: converted_count || 0,
        bytes: file.size,
      });
      track(jobId);
    } catch (e: any) {
      setError(e?.message || String(e));
      setPhase('idle');
    }
  };

  const resultDetail = (r: NotesImportResult) => {
    if (r.outcome === 'linked' || r.outcome === 'created') {
      return (
        <span class="text-[11px] text-base-300">
          {r.outcome === 'created' ? 'auto-created ' : ''}
          <Show when={r.account_slug} fallback={<>account #{r.account_id}</>}>
            <A href={`/accounts/${r.account_slug}`} class="text-surf-300 hover:text-surf-200 underline">{r.account_slug}</A>
          </Show>
          <Show when={r.outcome === 'created'}> — verify it</Show>
          <Show when={r.matched_by && r.outcome === 'linked'}>
            {' '}(matched on {r.matched_by}{r.match_score != null ? `, ${Math.round(r.match_score * 100)}%` : ''})
          </Show>
        </span>
      );
    }
    if (r.outcome === 'parked') {
      return (
        <span class="text-[11px] text-base-300">
          {parkedReason(r.reason)}
          <Show when={r.meeting_id}>
            {' · '}<A href={`/meetings/${r.meeting_id}`} class="text-papaya-300 hover:text-papaya-200 underline">open note</A>
          </Show>
          <Show when={r.candidates && r.candidates.length}>
            <span class="block text-base-400 mt-0.5">maybe: {r.candidates!.map((c) => c.name).join(', ')}</span>
          </Show>
        </span>
      );
    }
    if (r.outcome === 'skipped') return <span class="text-[11px] text-base-400">{r.note || 'already imported'}</span>;
    if (r.outcome === 'error') return <span class="text-[11px] text-scarlet-300">{r.error}</span>;
    return null;
  };

  return (
    <div>
      <p class="text-base-300 text-[13px] mb-6 max-w-3xl">
        Drop in a folder of notes (Obsidian, Apple/Google Notes, a folder of call summaries) or a <code>.zip</code>.
        Each file is read by your local model — one at a time — to pull out the date, title, company, and attendees,
        then filed as a meeting. A confident company match is linked; an unknown company auto-creates an account
        flagged for review; an ambiguous or company-less note is parked so you can place it. Re-importing the same
        files is safe — duplicates are skipped.
      </p>

      <div class="grid grid-cols-1 gap-6 md:grid-cols-2">
        {/* === FOLDER === */}
        <div class="panel panel-accent p-5">
          <h3 class="text-[15px] font-bold uppercase tracking-widest text-surf-300 mb-3 font-[family-name:var(--font-display)]">Import a folder</h3>
          <p class="text-base-300 text-[12px] mb-4">
            Pick a directory. Text notes (.md, .txt, .org, .rst) are read in your browser and sent up; everything else
            is ignored. For Word docs or PDFs, zip the folder and use the zip import.
          </p>
          <input
            ref={(el) => { el.setAttribute('webkitdirectory', ''); el.setAttribute('directory', ''); }}
            type="file"
            multiple
            class="hidden"
            id="notes-folder-input"
            onChange={(e) => {
              const fl = e.currentTarget.files;
              if (fl && fl.length) onFolderChosen(fl);
              e.currentTarget.value = '';
            }}
          />
          <Button variant="primary" disabled={running()} onClick={() => document.getElementById('notes-folder-input')?.click()}>
            {phase() === 'reading' ? 'Reading folder…' : 'Choose folder…'}
          </Button>
          <Show when={readInfo()}>
            {(info) => (
              <div class="text-[11px] text-base-400 mt-3">
                {info().kept} note(s) read{info().converted ? `, ${info().converted} converted` : ''}{info().skipped ? `, ${info().skipped} skipped` : ''} · {humanBytes(info().bytes)}
              </div>
            )}
          </Show>
        </div>

        {/* === ZIP === */}
        <div class="panel panel-accent p-5">
          <h3 class="text-[15px] font-bold uppercase tracking-widest text-surf-300 mb-3 font-[family-name:var(--font-display)]">Import a .zip</h3>
          <p class="text-base-300 text-[12px] mb-4">
            Upload a zipped notes folder. The server reads text files and converts <code>.docx</code> plus
            text-based <code>.pdf</code> files, then runs the same import pipeline.
          </p>
          <p class="text-base-400 text-[11px] mb-4">
            <span class="text-papaya-300 font-semibold">From Google Drive?</span> Download the Drive folder as a
            <code> .zip</code> and upload it here. Native Docs exported as <code>.docx</code> and text PDFs are converted
            before import; scanned PDFs are skipped.
          </p>
          <input
            ref={zipInput}
            type="file"
            accept=".zip,application/zip"
            class="hidden"
            onChange={(e) => {
              const file = e.currentTarget.files?.[0];
              if (file) onZipChosen(file);
              e.currentTarget.value = '';
            }}
          />
          <Button variant="primary" disabled={running()} onClick={() => zipInput?.click()}>
            {phase() === 'submitting' && !job() ? 'Uploading…' : 'Choose .zip…'}
          </Button>
        </div>
      </div>

      {/* === ERROR === */}
      <Show when={error()}>
        <div class="mt-6 p-3 border-2 border-scarlet-500/50 bg-scarlet-500/10 text-scarlet-300 text-[12px]">
          <div>{error()}</div>
          {/* Once polling has given up (no live job, not busy) offer a way back in —
              otherwise the panel would stay stuck behind disabled buttons. */}
          <Show when={!running() && trackingId()}>
            <div class="flex flex-wrap gap-2 mt-3">
              <Button variant="secondary" size="sm" onClick={retryTracking}>Retry</Button>
              <Button variant="ghost" size="sm" onClick={reset}>Dismiss</Button>
            </div>
          </Show>
        </div>
      </Show>

      {/* === PROGRESS / RESULTS === */}
      <Show when={job()}>
        {(j) => (
          <div class="panel panel-accent p-5 mt-6">
            {/* status line + progress bar */}
            <div class="flex items-center justify-between gap-3 flex-wrap mb-2">
              <span class="text-[13px] font-bold text-base-50">
                <Show when={running()} fallback={j().status === 'failed' ? 'Import failed' : 'Import complete'}>
                  Importing… {j().stage ? `(${j().stage})` : ''}
                </Show>
              </span>
              <span class="text-[11px] text-base-300">{j().processed} / {j().total}</span>
            </div>
            <div class="h-2 bg-base-900 border-2 border-base-600 mb-4">
              <div
                class={`h-full transition-all duration-300 ${j().status === 'failed' ? 'bg-scarlet-500' : 'bg-surf-500'}`}
                style={`width:${pct()}%`}
              />
            </div>

            <Show when={j().status === 'failed' && j().error}>
              <div class="p-3 border-2 border-scarlet-500/50 bg-scarlet-500/10 text-scarlet-300 text-[12px] mb-4">{j().error}</div>
            </Show>

            {/* outcome count chips */}
            <div class="flex flex-wrap gap-2 mb-4">
              <For each={(['linked', 'created', 'parked', 'skipped', 'error'] as NotesImportOutcome[]).filter((k) => j().counts[k] > 0)}>
                {(k) => (
                  <span class={`text-[10px] font-bold uppercase px-2 py-0.5 border ${OUTCOME[k].cls}`}>
                    {j().counts[k]} {OUTCOME[k].label}
                  </span>
                )}
              </For>
            </div>

            {/* needs-attention callout */}
            <Show when={!running() && (j().counts.created > 0 || j().counts.parked > 0)}>
              <div class="p-3 border-2 border-amber-500/50 bg-amber-500/10 text-amber-200 text-[12px] mb-4">
                <Show when={j().counts.created > 0}>
                  {j().counts.created} account(s) were auto-created — review them in{' '}
                  <A href="/accounts" class="text-amber-100 underline hover:text-white">Accounts</A>.{' '}
                </Show>
                <Show when={j().counts.parked > 0}>
                  {j().counts.parked} note(s) were parked — open each below (or in{' '}
                  <A href="/meetings" class="text-amber-100 underline hover:text-white">Meetings</A>) to assign an account.
                </Show>
              </div>
            </Show>

            {/* per-file results */}
            <Show when={j().results.length > 0}>
              <div class="border-2 border-base-600 bg-base-950 max-h-96 overflow-y-auto">
                <For each={j().results}>
                  {(r) => (
                    <div class="px-3 py-2 border-b border-base-700 last:border-b-0">
                      <div class="flex items-center gap-2 flex-wrap">
                        <span class={`text-[10px] font-bold uppercase px-2 py-0.5 border ${OUTCOME[r.outcome].cls}`}>
                          {OUTCOME[r.outcome].label}
                        </span>
                        <span class="text-[13px] text-base-50 break-all flex-1 min-w-0">{r.path}</span>
                      </div>
                      <div class="mt-1">{resultDetail(r)}</div>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </div>
        )}
      </Show>
    </div>
  );
}
