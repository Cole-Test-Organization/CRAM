import { Show } from 'solid-js';
import {
  formatLastSyncTimestamp,
  hasOfflineCopy,
  isOfflineMode,
  lastSyncAt,
  notice,
  serverUnreachable,
  setConnectionMode,
  syncError,
  syncNow,
  syncPhase,
} from '../lib/offline';
import { queuedWriteCount, replaying } from '../lib/writeQueue';

function queuedSuffix(): string {
  const pending = queuedWriteCount();
  return pending ? ` · ${pending} queued` : '';
}

function statusLabel(compact: boolean): string {
  if (replaying()) return 'Syncing queue...';
  if (syncPhase() === 'syncing') return 'Syncing...';
  if (isOfflineMode()) {
    return (hasOfflineCopy()
      ? `Offline · ${formatLastSyncTimestamp(lastSyncAt(), true)}`
      : 'Offline · no copy') + queuedSuffix();
  }
  if (serverUnreachable()) return `Unreachable${queuedSuffix()}`;
  if (syncPhase() === 'error') return compact ? 'Sync failed' : 'Offline sync failed';
  if (!lastSyncAt()) return compact ? 'Prepare offline' : 'Not ready offline';
  return (compact
    ? `Synced ${formatLastSyncTimestamp(lastSyncAt(), true)}`
    : `Last sync ${formatLastSyncTimestamp(lastSyncAt())}`) + queuedSuffix();
}

function title(): string {
  const queued = queuedWriteCount()
    ? ` ${queuedWriteCount()} change(s) are queued and will sync when you go back online.`
    : '';
  if (isOfflineMode()) {
    return (lastSyncAt()
      ? `Offline mode. Reads come from the copy synced ${new Date(lastSyncAt()!).toLocaleString()}; edits are queued.`
      : 'Offline mode. This device has not completed a sync yet.') + queued;
  }
  if (syncError()) return `${syncError()} Click to try again.${queued}`;
  if (serverUnreachable()) {
    return `The last request could not reach the server. Still in Online mode — click to retry.${queued}`;
  }
  return (lastSyncAt()
    ? `Last successful sync: ${new Date(lastSyncAt()!).toLocaleString()}. Click to sync now.`
    : 'Click to download the CRM data needed for offline access.') + queued;
}

export default function SyncStatus(props: { compact?: boolean }) {
  const offline = () => isOfflineMode();
  const toggleTitle = () => (offline()
    ? 'Switch to Online mode — resume live requests and sync any queued changes.'
    : 'Switch to Offline mode — stop all network requests and queue your edits.');

  return (
    <div class="sync-status-group">
      <button
        type="button"
        class={`sync-status ${offline() ? 'sync-status-offline' : ''} ${
          !offline() && (syncPhase() === 'error' || serverUnreachable()) ? 'sync-status-error' : ''
        }`}
        onClick={() => void syncNow()}
        title={title()}
        aria-label={title()}
        aria-live="polite"
      >
        <span
          class={`sync-status-dot ${syncPhase() === 'syncing' || replaying() ? 'sync-status-dot-pulse' : ''}`}
          aria-hidden="true"
        />
        <span class="truncate">{statusLabel(Boolean(props.compact))}</span>
      </button>
      <button
        type="button"
        class="sync-status-toggle"
        onClick={() => void setConnectionMode(offline() ? 'online' : 'offline')}
        title={toggleTitle()}
        aria-label={toggleTitle()}
        aria-pressed={offline()}
      >
        {offline() ? 'Go online' : 'Go offline'}
      </button>
    </div>
  );
}

export function OfflineNotice() {
  return (
    <Show when={notice()}>
      <div class="offline-notice" role="status" aria-live="polite">
        {notice()}
      </div>
    </Show>
  );
}
