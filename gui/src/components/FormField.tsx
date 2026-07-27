import type { JSX } from 'solid-js';
import { Show } from 'solid-js';
import { modalBtn } from './Modal';

/* Re-exported strings so existing callers pick up the new vintage styling
   without touching their call sites. */
export const formInputClass = "input-vintage";
export const formTextareaClass = "input-vintage font-mono text-[12px] leading-relaxed";
export const formSelectClass = "input-vintage cursor-pointer";

interface FormFieldProps {
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;
  children: JSX.Element;
}

export default function FormField(props: FormFieldProps) {
  return (
    <div class="mb-3">
      <label class="block text-[10px] text-surf-300 mb-1 font-bold uppercase tracking-widest">
        {props.label}
        <Show when={props.required}>
          <span class="text-scarlet-400 ml-0.5">*</span>
        </Show>
      </label>
      {props.children}
      <Show when={props.hint && !props.error}>
        <div class="text-[11px] text-base-400 mt-1">{props.hint}</div>
      </Show>
      <Show when={props.error}>
        <div class="text-[11px] text-scarlet-400 mt-1 font-semibold">{props.error}</div>
      </Show>
    </div>
  );
}

export function FormRow(props: { children: JSX.Element }) {
  return <div class="flex gap-3 flex-wrap">{props.children}</div>;
}

// Form-level (as opposed to field-level) error — a failed submit or a
// cross-field validation message. Renders nothing when there's no message, so
// callers don't need to wrap it in <Show>.
export function FormError(props: { message?: string | null }) {
  return (
    <Show when={props.message}>
      <div class="text-[12px] text-scarlet-400 mt-2 font-semibold">{props.message}</div>
    </Show>
  );
}

interface ModalFooterProps {
  saving: boolean;
  onCancel: () => void;
  onSave: () => void;
  // Truthy when editing rather than creating — drives the default save label.
  existing?: unknown;
  // Override the default 'Save'/'Create' label (e.g. 'Save and Confirm').
  saveLabel?: string;
  // Extra reason to block save beyond `saving` (e.g. a required picker is empty).
  saveDisabled?: boolean;
}

// The Cancel + save pair every form modal passes to <Modal footer={...}>.
export function ModalFooter(props: ModalFooterProps) {
  return (
    <>
      <button class={modalBtn.secondary} onClick={props.onCancel} disabled={props.saving}>Cancel</button>
      <button
        class={modalBtn.primary}
        onClick={props.onSave}
        disabled={props.saving || !!props.saveDisabled}
      >
        {props.saving ? 'Saving...' : (props.saveLabel ?? (props.existing ? 'Save' : 'Create'))}
      </button>
    </>
  );
}
