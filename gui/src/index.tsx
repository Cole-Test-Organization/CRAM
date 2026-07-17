import { render } from 'solid-js/web';
import App from './App';
import './index.css';
import { applyCachedTheme, refreshActiveTheme } from './lib/theme';
import { initializeOfflineSupport } from './lib/offline';

// Synchronously apply the last-known theme from localStorage so the first
// paint matches the user's choice instead of flashing the baked-in default.
applyCachedTheme();
// Then fetch the live theme; if it differs from cache, the page re-flows on
// the next animation frame.
refreshActiveTheme();

render(() => <App />, document.getElementById('root')!);
initializeOfflineSupport();
