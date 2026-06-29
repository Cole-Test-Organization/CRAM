import { For, type JSX } from 'solid-js';

type Option<T extends string> = {
  value: T;
  label: JSX.Element;
  title?: string;
};

type Props<T extends string> = {
  value: T;
  options: readonly Option<T>[];
  onChange: (value: T) => void;
  size?: 'sm' | 'md';
  class?: string;
};

export default function SegmentedControl<T extends string>(props: Props<T>) {
  return (
    <div class={`inline-flex items-stretch border-2 border-base-600 bg-base-950 ${props.class || ''}`}>
      <For each={props.options}>
        {(option, index) => (
          <button
            type="button"
            title={option.title}
            aria-pressed={props.value === option.value}
            class={`${index() ? 'border-l-2 border-base-600' : ''} ${props.size === 'md' ? 'px-3 py-1.5 text-[12px]' : 'px-2 py-1 text-[11px]'} uppercase tracking-wider font-semibold transition-colors ${props.value === option.value ? 'bg-surf-300 text-base-950' : 'text-base-300 hover:text-base-50'}`}
            onClick={() => props.onChange(option.value)}
          >
            {option.label}
          </button>
        )}
      </For>
    </div>
  );
}
