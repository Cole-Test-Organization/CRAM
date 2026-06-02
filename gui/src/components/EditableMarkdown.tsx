import { createSignal, createEffect, Show } from 'solid-js';
import MarkdownRenderer from './MarkdownRenderer';
import Button from './Button';
import SaveIndicator from './SaveIndicator';
import type { SaveStatus } from '../lib/editing';

/** Click-to-edit markdown field: shows the rendered markdown, click to drop
 *  into a textarea, edits stream to `onSave` on every keystroke (wire it to a
 *  debounced `createAutoSave`). The `status` drives the inline SaveIndicator.
 *
 *  `placeholder` doubles as the empty-state hint and the textarea placeholder;
 *  `rows` sizes the editor (default 12). */
export default function EditableMarkdown(props: {
  content: string;
  onSave: (val: string) => void;
  status: SaveStatus;
  placeholder?: string;
  rows?: number;
}) {
  const [editing, setEditing] = createSignal(false);
  const [value, setValue] = createSignal(props.content || '');
  let textareaRef: HTMLTextAreaElement | undefined;

  createEffect(() => setValue(props.content || ''));

  const placeholder = () => props.placeholder ?? 'Click to add content...';

  return (
    <div>
      <div class="flex justify-between items-center mb-3">
        <div />
        <div class="flex items-center gap-2">
          <SaveIndicator status={props.status} />
          <Show when={editing()}>
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>Done</Button>
          </Show>
        </div>
      </div>
      <Show when={editing()} fallback={
        <div
          class="mt-2 cursor-text p-3 -m-3 transition-colors duration-150 hover:bg-base-700/30"
          onClick={() => {
            setEditing(true);
            requestAnimationFrame(() => textareaRef?.focus());
          }}
        >
          <Show when={value()} fallback={<span class="text-base-300 text-[13px] italic">{placeholder()}</span>}>
            <MarkdownRenderer content={value()} />
          </Show>
        </div>
      }>
        <textarea
          ref={textareaRef}
          class="input-vintage font-mono text-[12px] leading-relaxed mt-2"
          value={value()}
          placeholder={placeholder()}
          onInput={(e) => {
            const v = e.currentTarget.value;
            setValue(v);
            props.onSave(v);
          }}
          rows={props.rows ?? 12}
        />
      </Show>
    </div>
  );
}
