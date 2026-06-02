import { createRoot, createSignal, createComputed } from 'solid-js';
import { describe, it, expect, vi } from 'vitest';
import { createUnsavedGuard } from './unsavedGuard';

describe('createUnsavedGuard', () => {
  it('dirty() tracks divergence from the baseline', () => {
    createRoot((dispose) => {
      const [field, setField] = createSignal('a');
      const guard = createUnsavedGuard({ serialize: () => field(), isOpen: () => false });

      expect(guard.dirty()).toBe(false); // starts clean
      setField('b');
      expect(guard.dirty()).toBe(true); // diverged
      guard.rebaseline();
      expect(guard.dirty()).toBe(false); // baseline re-captured

      dispose();
    });
  });

  it('rebaseline() is untracked — it never subscribes the calling reactive scope', () => {
    // The whole reason this primitive exists. In MeetingFormModal the baseline is
    // captured inside the open/init effect; if rebaseline subscribed to the form
    // signals, that effect would re-run on every edit and reset the form (the
    // original bug). createComputed re-runs *synchronously* when a tracked dep
    // changes, so if rebaseline tracked `field`, `runs` would climb past 1.
    createRoot((dispose) => {
      const [field, setField] = createSignal('a');
      const guard = createUnsavedGuard({ serialize: () => field(), isOpen: () => false });

      let runs = 0;
      createComputed(() => {
        runs++;
        guard.rebaseline();
      });
      expect(runs).toBe(1);

      setField('b'); // would re-run the computation iff rebaseline tracked field()
      expect(runs).toBe(1); // unchanged → untracked

      dispose();
    });
  });

  it('guardedClose proceeds when clean, and respects the confirm when dirty', () => {
    createRoot((dispose) => {
      const [field, setField] = createSignal('a');
      const guard = createUnsavedGuard({ serialize: () => field(), isOpen: () => false });

      let closed = 0;
      guard.guardedClose(() => closed++);
      expect(closed).toBe(1); // clean → closes straight through

      setField('b'); // now dirty
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
      guard.guardedClose(() => closed++);
      expect(closed).toBe(1); // user cancelled → blocked

      confirmSpy.mockReturnValue(true);
      guard.guardedClose(() => closed++);
      expect(closed).toBe(2); // user confirmed → closes

      confirmSpy.mockRestore();
      dispose();
    });
  });
});
