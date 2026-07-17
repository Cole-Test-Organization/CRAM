import { Show } from 'solid-js';
import {
  formatLastSyncTimestamp,
  hasOfflineCopy,
  isOffline,
  lastSyncAt,
  notice,
  syncError,
  syncNow,
  syncPhase,
} from '../lib/offline';

function statusLabel(compact: boolean): string {
  if (syncPhase() === 'syncing') return 'Syncing...';
  if (isOffline()) {
    return hasOfflineCopy()
      ? `Offline · ${formatLastSyncTimestamp(lastSyncAt(), true)}`
      : 'Offline · no copy';
  }
  if (syncPhase() === 'error') return compact ? 'Sync failed' : 'Offline sync failed';
  if (!lastSyncAt()) return compact ? 'Prepare offline' : 'Not ready offline';
  return compact
    ? `Synced ${formatLastSyncTimestamp(lastSyncAt(), true)}`
    : `Last sync ${formatLastSyncTimestamp(lastSyncAt())}`;
}

function title(): string {
  if (syncError()) return `${syncError()} Click to try again.`;
  if (isOffline()) {
    return lastSyncAt()
      ? `Offline and read-only. Last successful sync: ${new Date(lastSyncAt()!).toLocaleString()}.`
      : 'Offline and read-only. This device has not completed an offline sync yet.';
  }
  return lastSyncAt()
    ? `Last successful sync: ${new Date(lastSyncAt()!).toLocaleString()}. Click to sync now.`
    : 'Click to download the CRM data needed for offline access.';
}

export default function SyncStatus(props: { compact?: boolean }) {
  return (
    <button
      type="button"
      class={`sync-status ${isOffline() ? 'sync-status-offline' : ''} ${syncPhase() === 'error' ? 'sync-status-error' : ''}`}
      onClick={() => void syncNow()}
      title={title()}
      aria-label={title()}
      aria-live="polite"
    >
      <span class={`sync-status-dot ${syncPhase() === 'syncing' ? 'sync-status-dot-pulse' : ''}`} aria-hidden="true" />
      <span class="truncate">{statusLabel(Boolean(props.compact))}</span>
    </button>
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
