import { Show, onMount, onCleanup } from 'solid-js';
import { Portal } from 'solid-js/web';
import type { JSX } from 'solid-js';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: JSX.Element;
  size?: 'sm' | 'md' | 'lg';
  footer?: JSX.Element;
}

export default function Modal(props: ModalProps) {
  const widthClass = () => {
    switch (props.size) {
      case 'sm': return 'max-w-md';
      case 'lg': return 'max-w-3xl';
      default: return 'max-w-xl';
    }
  };

  onMount(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && props.open) props.onClose();
    };
    window.addEventListener('keydown', handler);
    onCleanup(() => window.removeEventListener('keydown', handler));
  });

  return (
    <Show when={props.open}>
      <Portal>
        <div
          class="fixed inset-0 z-[100] flex items-stretch justify-center bg-black/75 backdrop-blur-sm overflow-y-auto p-0 md:items-start md:p-8"
          onClick={(e) => { if (e.target === e.currentTarget) props.onClose(); }}
        >
          <div
            class={`mobile-modal md:flex-none w-full ${widthClass()} bg-base-900 md:border-2 md:border-base-300 md:shadow-[6px_6px_0_0_rgba(0,0,0,0.6)] md:my-auto md:block flex flex-col`}
            onClick={(e) => e.stopPropagation()}
          >
            <div class="flex items-center justify-between px-5 py-3 border-b-2 border-base-600 bg-base-800 shrink-0">
              <h2 class="text-[15px] font-bold text-surf-300 uppercase tracking-wider font-[family-name:var(--font-display)]">{props.title}</h2>
              <button
                class="bg-transparent border-2 border-base-500 text-base-300 text-xl cursor-pointer leading-none w-9 h-9 md:w-7 md:h-7 flex items-center justify-center transition-colors duration-150 hover:text-base-50 hover:border-base-300 hover:bg-base-700"
                onClick={props.onClose}
                aria-label="Close"
              >
                &times;
              </button>
            </div>
            <div class="p-5 flex-1 overflow-y-auto md:flex-none md:overflow-visible" style="overscroll-behavior: contain">
              {props.children}
            </div>
            <Show when={props.footer}>
              <div class="px-5 py-3 border-t-2 border-base-600 bg-base-800 flex justify-end gap-3 shrink-0">
                {props.footer}
              </div>
            </Show>
          </div>
        </div>
      </Portal>
    </Show>
  );
}

/* Shared button classes for modal footers — route through the press primitives. */
export const modalBtn = {
  primary: "press press-primary press-md",
  secondary: "press press-ghost press-md",
  danger: "press press-danger press-md",
};
