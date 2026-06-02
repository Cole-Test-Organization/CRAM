import { Show } from 'solid-js';
import type { SaveStatus } from '../lib/editing';

/** Tiny "Saving… / Saved / Error" pill driven by a `createAutoSave` status.
 *  Renders nothing while idle. Shared by any surface with an autosaving field. */
export default function SaveIndicator(props: { status: SaveStatus }) {
  return (
    <Show when={props.status !== 'idle'}>
      <span class={`text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 border-2 ${
        props.status === 'saving' ? 'text-amber-300 border-amber-500/50 bg-amber-500/10' :
        props.status === 'saved' ? 'text-surf-300 border-surf-500/50 bg-surf-500/10' :
        'text-scarlet-300 border-scarlet-500/50 bg-scarlet-500/10'
      }`}>
        {props.status === 'saving' ? 'Saving...' : props.status === 'saved' ? 'Saved' : 'Error'}
      </span>
    </Show>
  );
}
