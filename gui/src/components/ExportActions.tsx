import { createSignal } from 'solid-js';
import Button from './Button';
import type { ButtonSize } from './Button';
import { downloadTextFile, copyTextToClipboard } from '../lib/textExport';

type BuildResult = { text: string; filename: string };

type Props = {
  // Currently-selected row ids — closure so the component picks up the latest selection.
  ids: () => number[];
  // Turn the selected ids into the text body + filename. Per-entity formatters
  // live in gui/src/lib/*Export.ts and expose ready-made `build*Export` helpers.
  build: (ids: number[]) => Promise<BuildResult> | BuildResult;
  size?: ButtonSize;
  // True while the parent is still loading the data backing the selection.
  disabled?: () => boolean;
};

export default function ExportActions(props: Props) {
  const [busy, setBusy] = createSignal<'copy' | 'export' | null>(null);
  const [copied, setCopied] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const disabled = () =>
    !!props.disabled?.() || busy() !== null || props.ids().length === 0;

  const handleCopy = async () => {
    setError(null);
    setBusy('copy');
    try {
      const { text } = await props.build(props.ids());
      if (text) {
        await copyTextToClipboard(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }
    } catch (e: any) {
      setError(e?.message || 'Copy failed');
    } finally {
      setBusy(null);
    }
  };

  const handleExport = async () => {
    setError(null);
    setBusy('export');
    try {
      const { text, filename } = await props.build(props.ids());
      if (text) downloadTextFile(text, filename);
    } catch (e: any) {
      setError(e?.message || 'Export failed');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div class="flex items-center gap-2 flex-wrap">
      <Button variant="ghost" size={props.size || 'sm'} disabled={disabled()} onClick={handleCopy}>
        {busy() === 'copy' ? 'Copying...' : copied() ? 'Copied!' : 'Copy'}
      </Button>
      <Button variant="ghost" size={props.size || 'sm'} disabled={disabled()} onClick={handleExport}>
        {busy() === 'export' ? 'Exporting...' : 'Export TXT'}
      </Button>
      {error() && (
        <span class="text-scarlet-400 text-[11px] uppercase tracking-wider">{error()}</span>
      )}
    </div>
  );
}
