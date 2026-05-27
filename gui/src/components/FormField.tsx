import type { JSX } from 'solid-js';
import { Show } from 'solid-js';

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
