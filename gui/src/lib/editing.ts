import { createSignal, onCleanup } from 'solid-js';

export function debounce<T extends (...args: any[]) => any>(fn: T, ms: number): T & { cancel: () => void } {
  let timer: ReturnType<typeof setTimeout>;
  const debounced = ((...args: any[]) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  }) as T & { cancel: () => void };
  debounced.cancel = () => clearTimeout(timer);
  return debounced;
}

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export function createAutoSave(saveFn: (value: any) => Promise<any>, delayMs = 1000) {
  const [status, setStatus] = createSignal<SaveStatus>('idle');
  let timer: ReturnType<typeof setTimeout>;
  let savedTimer: ReturnType<typeof setTimeout>;

  onCleanup(() => {
    clearTimeout(timer);
    clearTimeout(savedTimer);
  });

  const save = (value: any) => {
    clearTimeout(timer);
    clearTimeout(savedTimer);
    setStatus('idle');
    timer = setTimeout(async () => {
      setStatus('saving');
      try {
        await saveFn(value);
        setStatus('saved');
        savedTimer = setTimeout(() => setStatus('idle'), 2000);
      } catch {
        setStatus('error');
        savedTimer = setTimeout(() => setStatus('idle'), 3000);
      }
    }, delayMs);
  };

  const saveNow = async (value: any) => {
    clearTimeout(timer);
    clearTimeout(savedTimer);
    setStatus('saving');
    try {
      await saveFn(value);
      setStatus('saved');
      savedTimer = setTimeout(() => setStatus('idle'), 2000);
    } catch {
      setStatus('error');
      savedTimer = setTimeout(() => setStatus('idle'), 3000);
    }
  };

  return { status, save, saveNow };
}
