import { createSignal, createMemo, createEffect, onCleanup, untrack } from 'solid-js';

export interface UnsavedGuard {
  /** True once the serialized form state diverges from the last captured baseline. */
  dirty: () => boolean;
  /**
   * Re-capture the current state as the baseline (so `dirty()` reads false).
   * Call once the form is populated on open, and again after a successful save.
   *
   * `untrack` is baked in on purpose: `serialize()` reads many form signals, and
   * if `rebaseline()` ran *tracked* inside an effect (e.g. the modal's open/init
   * effect), that effect would subscribe to all of them and re-run on every
   * edit — resetting the form on each keystroke. That was the original bug; this
   * primitive exists so no caller can reintroduce it.
   */
  rebaseline: () => void;
  /**
   * Run `close` unless there are unsaved edits the user declines to discard.
   * Wire to every in-app dismissal (backdrop, Escape, ×, Cancel).
   */
  guardedClose: (close: () => void) => void;
}

export interface UnsavedGuardOptions {
  /** Snapshot the editable state into a comparable string (reads the form signals). */
  serialize: () => string;
  /** Whether the form is currently open — gates the beforeunload listener. */
  isOpen: () => boolean;
  /** Confirm copy shown on an in-app discard. */
  message?: string;
}

/**
 * Warn-only unsaved-changes guard for a form/modal. No autosave, no draft — it
 * only (a) confirms before an in-app close when there are unsaved edits, and
 * (b) raises the native browser "Leave site?" prompt on a real page unload
 * (refresh / tab close) while dirty.
 *
 * Must be created inside a reactive owner (a component body or `createRoot`).
 */
export function createUnsavedGuard(opts: UnsavedGuardOptions): UnsavedGuard {
  const { serialize, isOpen, message = 'You have unsaved changes — discard them?' } = opts;

  // Baseline starts at the current state, so dirty() is false until something
  // changes. Callers still rebaseline() once the form is populated on open.
  const [baseline, setBaseline] = createSignal(untrack(serialize));
  // A memo (not a bare derivation) so dependents re-run only when the boolean
  // flips — not on every keystroke, since serialize() changes constantly.
  const dirty = createMemo(() => serialize() !== baseline());
  const rebaseline = () => setBaseline(untrack(serialize));

  // Covers the one close path the in-app guard can't intercept: a genuine page
  // unload. Registered only while open AND dirty; torn down when either flips.
  createEffect(() => {
    if (!isOpen() || !dirty()) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    onCleanup(() => window.removeEventListener('beforeunload', handler));
  });

  const guardedClose = (close: () => void) => {
    if (dirty() && !confirm(message)) return;
    close();
  };

  return { dirty, rebaseline, guardedClose };
}
