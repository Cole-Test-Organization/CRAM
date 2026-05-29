import { createSignal, createEffect } from 'solid-js';
import { useLocation } from '@solidjs/router';

// In-app navigation history.
//
// The in-page "← Back" links used to hard-code a destination (always the list,
// e.g. /contacts), which is wrong when the user arrived from somewhere else
// (an account page, search, a meeting's attendee list). We want the in-page
// back button to mirror the browser's back button — return the user to wherever
// they actually came from.
//
// The browser doesn't expose its history index, so we keep our own stack of the
// paths visited *within the SPA*. A navigation that lands on the previous entry
// is treated as a back-navigation (pop); anything else is a forward navigation
// (push). `canGoBack()` is true whenever there's at least one in-app page behind
// the current one, which means `navigate(-1)` is guaranteed to stay inside the
// app. On a fresh deep-link or refresh the stack has a single entry, so callers
// fall back to a sensible list page instead of bouncing the user out of the app.

const [stack, setStack] = createSignal<string[]>([]);

export const canGoBack = () => stack().length > 1;

// Subscribe to route changes and keep the stack in sync. Call exactly once,
// from the Router root (Layout), so the effect lives for the app's lifetime.
export function useNavHistory() {
  const location = useLocation();
  createEffect(() => {
    const current = location.pathname + location.search;
    setStack((prev) => {
      // Same page (e.g. a state-only change) — leave the stack untouched.
      if (prev[prev.length - 1] === current) return prev;
      // Landed on the previous entry → this was a back navigation: pop.
      if (prev.length >= 2 && prev[prev.length - 2] === current) {
        return prev.slice(0, -1);
      }
      // Otherwise it's a forward navigation: push.
      return [...prev, current];
    });
  });
}
