import { Show } from 'solid-js';
import ExportActions from './ExportActions';
import type { Selection } from './createSelection';

type BuildResult = { text: string; filename: string };

type Props = {
  selection: Selection;
  buildExport: (ids: number[]) => Promise<BuildResult> | BuildResult;
  loading: () => boolean;
};

export default function SelectionToolbar(props: Props) {
  return (
    <div class="flex flex-col gap-3 mb-3 md:flex-row md:items-center md:justify-between">
      <div class="flex items-center gap-3 flex-wrap">
        <label class="flex items-center gap-2 cursor-pointer text-[11px] uppercase tracking-wider font-semibold text-base-200">
          <input
            type="checkbox"
            class="press-checkbox"
            checked={props.selection.allVisibleSelected()}
            onChange={props.selection.toggleAllVisible}
          />
          Select all
        </label>
        <span class="text-base-300 text-[11px] uppercase tracking-wider">
          {props.selection.count()} selected
        </span>
        <Show when={props.selection.count() > 0}>
          <button
            class="text-base-300 text-[11px] uppercase tracking-wider hover:text-base-50"
            onClick={props.selection.clear}
          >
            Clear
          </button>
        </Show>
      </div>
      <ExportActions ids={props.selection.idList} build={props.buildExport} disabled={props.loading} />
    </div>
  );
}
