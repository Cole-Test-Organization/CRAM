import { createSignal, createEffect, type Signal } from 'solid-js';

// A createSignal whose value survives reloads via localStorage. Used for list
// filter toggles that would otherwise reset on every navigation.
export function createPersistentSignal<T>(key: string, fallback: T): Signal<T> {
  const [value, setValue] = createSignal<T>(read(key, fallback));

  createEffect(() => {
    const v = value();
    // Storage can be unavailable (Safari private mode, quota) — the signal must
    // keep working in-memory when it is.
    try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* non-fatal */ }
  });

  return [value, setValue] as Signal<T>;
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}
