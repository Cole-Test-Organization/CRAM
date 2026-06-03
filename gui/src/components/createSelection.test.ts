// Unit tests for the createSelection primitive (multi-select state shared by the
// list views + bulk toolbars). Pure reactive logic, so it's exercised with
// createRoot and no DOM — same style as unsavedGuard.test.ts.

import { createRoot, createSignal } from 'solid-js';
import { describe, it, expect } from 'vitest';
import { createSelection } from './createSelection';

// The scope-reset behavior rides on a createEffect, which Solid runs on a
// microtask — let it drain before asserting.
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('createSelection', () => {
  it('toggles ids in and out, tracking membership and count', () => {
    createRoot((dispose) => {
      const sel = createSelection(() => [1, 2, 3]);
      expect(sel.count()).toBe(0);
      expect(sel.has(1)).toBe(false);

      sel.toggle(1);
      expect(sel.has(1)).toBe(true);
      expect(sel.count()).toBe(1);
      expect(sel.idList()).toEqual([1]);

      sel.toggle(1); // same id again → deselect
      expect(sel.has(1)).toBe(false);
      expect(sel.count()).toBe(0);

      dispose();
    });
  });

  it('remove() drops one id; clear() drops all', () => {
    createRoot((dispose) => {
      const sel = createSelection(() => [1, 2, 3]);
      sel.toggle(1);
      sel.toggle(2);
      sel.remove(1);
      expect(sel.has(1)).toBe(false);
      expect(sel.idList()).toEqual([2]);

      sel.clear();
      expect(sel.count()).toBe(0);
      dispose();
    });
  });

  it('toggleAllVisible selects every visible id, then clears them; allVisibleSelected tracks the current view', () => {
    createRoot((dispose) => {
      const [visible, setVisible] = createSignal([1, 2, 3]);
      const sel = createSelection(visible);
      expect(sel.allVisibleSelected()).toBe(false); // nothing selected

      sel.toggleAllVisible();
      expect(sel.allVisibleSelected()).toBe(true);
      expect([...sel.idList()].sort()).toEqual([1, 2, 3]);

      sel.toggleAllVisible(); // all were selected → second call clears the visible set
      expect(sel.count()).toBe(0);

      // allVisibleSelected only considers what's currently visible: select id 1,
      // then narrow the view to just [1] → "all visible" is now satisfied.
      sel.toggle(1);
      setVisible([1]);
      expect(sel.allVisibleSelected()).toBe(true);

      dispose();
    });
  });

  it('resets the selection when scopeKey changes (e.g. switching account/tab)', async () => {
    await createRoot(async (dispose) => {
      const [scope, setScope] = createSignal('a');
      const sel = createSelection(() => [1, 2, 3], scope);
      await flush(); // initial scope effect

      sel.toggle(1);
      expect(sel.count()).toBe(1);

      setScope('b'); // scope changed → selection is dropped
      await flush();
      expect(sel.count()).toBe(0);

      dispose();
    });
  });
});
