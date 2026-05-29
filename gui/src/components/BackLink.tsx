import { useNavigate } from '@solidjs/router';
import { canGoBack } from '../lib/navigation';

const BASE_CLASS =
  'text-base-300 text-[12px] mb-4 inline-block hover:text-surf-300 uppercase tracking-wider font-semibold';

// In-page back link. When the user navigated here from somewhere else in the
// app, it behaves like the browser back button (returns to the previous page).
// On a fresh deep-link / refresh — when there's no in-app history behind us —
// it falls back to a fixed destination (usually the resource's list page) so
// the user never gets bounced out of the app.
//
// We render a real anchor pointed at the fallback so modified clicks
// (cmd/ctrl/middle-click "open in new tab") and "copy link" still do something
// sensible; a plain left-click is intercepted and routed client-side.
export default function BackLink(props: {
  fallbackHref: string;
  fallbackLabel: string;
  class?: string;
}) {
  const navigate = useNavigate();

  const onClick = (e: MouseEvent) => {
    if (
      e.defaultPrevented ||
      e.button !== 0 ||
      e.metaKey ||
      e.ctrlKey ||
      e.shiftKey ||
      e.altKey
    ) {
      return; // let the browser handle modified clicks via the href
    }
    e.preventDefault();
    if (canGoBack()) navigate(-1);
    else navigate(props.fallbackHref);
  };

  return (
    <a href={props.fallbackHref} onClick={onClick} class={props.class ?? BASE_CLASS}>
      &larr; {canGoBack() ? 'Back' : props.fallbackLabel}
    </a>
  );
}
