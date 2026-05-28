import { createSignal, createEffect } from 'solid-js';

export type Selection = {
  has: (id: number) => boolean;
  toggle: (id: number) => void;
  remove: (id: number) => void;
  clear: () => void;
  toggleAllVisible: () => void;
  allVisibleSelected: () => boolean;
  count: () => number;
  idList: () => number[];
};

export function createSelection(
  visibleIds: () => number[],
  scopeKey?: () => unknown,
): Selection {
  const [selectedIds, setSelectedIds] = createSignal<Set<number>>(new Set<number>());

  createEffect(() => {
    void scopeKey?.();
    setSelectedIds(new Set<number>());
  });

  const allVisibleSelected = () => {
    const ids = visibleIds();
    if (ids.length === 0) return false;
    const sel = selectedIds();
    return ids.every((id) => sel.has(id));
  };

  return {
    has: (id) => selectedIds().has(id),
    toggle: (id) =>
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    remove: (id) =>
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      }),
    clear: () => setSelectedIds(new Set<number>()),
    toggleAllVisible: () => {
      const ids = visibleIds();
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (allVisibleSelected()) ids.forEach((id) => next.delete(id));
        else ids.forEach((id) => next.add(id));
        return next;
      });
    },
    allVisibleSelected,
    count: () => selectedIds().size,
    idList: () => Array.from(selectedIds()),
  };
}
