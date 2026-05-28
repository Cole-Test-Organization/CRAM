import { For, Show, type JSX } from 'solid-js';
import { A } from '@solidjs/router';
import type { Selection } from './createSelection';

type Props<T> = {
  items: () => T[];
  loading: () => boolean;
  getId: (item: T) => number;
  getHref: (item: T) => string;
  renderRow: (item: T) => JSX.Element;
  selection: Selection;
  onDelete: (id: number) => void;
  deleteTitle: string;
  emptyState?: JSX.Element;
};

export default function ListRows<T>(props: Props<T>) {
  return (
    <Show when={!props.loading()} fallback={<div class="text-base-300 p-10 text-center">Loading...</div>}>
      <div class="panel panel-accent">
        <For
          each={props.items()}
          fallback={props.emptyState ?? <div class="text-base-300 text-center p-10 text-sm">No results found</div>}
        >
          {(item) => {
            const id = props.getId(item);
            return (
              <div class="flex items-center border-b border-base-700 last:border-b-0">
                <label class="flex items-center self-stretch pl-3 pr-1 cursor-pointer">
                  <input
                    type="checkbox"
                    class="press-checkbox"
                    checked={props.selection.has(id)}
                    onChange={() => props.selection.toggle(id)}
                  />
                </label>
                <A href={props.getHref(item)} class="press-row gap-4 flex-wrap flex-1 min-w-0">
                  {props.renderRow(item)}
                </A>
                <button
                  class="btn-x mr-2 md:mr-3 shrink-0"
                  onClick={() => props.onDelete(id)}
                  title={props.deleteTitle}
                >
                  ×
                </button>
              </div>
            );
          }}
        </For>
      </div>
    </Show>
  );
}
