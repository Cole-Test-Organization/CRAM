import {
    createResource,
    createSignal,
    For,
    Show,
} from "solid-js";
import { api } from "../../lib/api";
import { STORAGE_KEY as THEME_STORAGE_KEY } from "../../lib/theme";
import Button from "../Button";

function fmtBytes(n: number) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
    return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

type Props = {
    flash: (kind: "ok" | "err", text: string) => void;
};

export default function BackupSettings(props: Props) {
    const [settings, { refetch: refetchSettings }] = createResource(() =>
        api.getBackupSettings(),
    );
    const [list, { refetch: refetchList }] = createResource(() =>
        api.listBackups(),
    );

    const [running, setRunning] = createSignal(false);
    const [restoring, setRestoring] = createSignal<string | null>(null);
    const [importing, setImporting] = createSignal(false);
    let fileInput: HTMLInputElement | undefined;

    const runNow = async () => {
        setRunning(true);
        try {
            const result = await api.runBackup();
            props.flash(
                "ok",
                `Backup created: ${result.filename} (${fmtBytes(result.size_bytes)})`,
            );
            await refetchList();
        } catch (err: any) {
            props.flash("err", `Backup failed: ${err.message || err}`);
        } finally {
            setRunning(false);
        }
    };

    const restore = async (filename: string) => {
        const ok = confirm(
            `Restore ${filename}?\n\n` +
                `This will DROP and recreate every object in the database. ` +
                `Any data not in this dump will be lost.\n\n` +
                `Type OK on the next prompt to proceed.`,
        );
        if (!ok) return;
        const confirmText = prompt(
            `Type "RESTORE" to confirm restoring ${filename}`,
        );
        if (confirmText !== "RESTORE") {
            props.flash("err", "Restore cancelled");
            return;
        }
        setRestoring(filename);
        try {
            await api.restoreBackup(filename);
            // The restore dropped and rebuilt the whole DB (themes, agent config,
            // memories, internal domains, …), so every cached client-side value is
            // now stale. Clear the cached theme and hard-reload to rebuild all state
            // from the freshly-restored database.
            props.flash("ok", `Restored from ${filename} — reloading…`);
            try {
                localStorage.removeItem(THEME_STORAGE_KEY);
            } catch {
                /* private mode etc. */
            }
            setTimeout(() => window.location.reload(), 800);
        } catch (err: any) {
            props.flash("err", `Restore failed: ${err.message || err}`);
            setRestoring(null);
        }
    };

    const onPickFile = async (e: Event) => {
        const target = e.currentTarget as HTMLInputElement;
        const file = target.files?.[0];
        // Always clear the input value so picking the same file twice still fires change.
        target.value = "";
        if (!file) return;
        setImporting(true);
        try {
            const result = await api.importBackup(file);
            props.flash(
                "ok",
                `Imported ${file.name} as ${result.filename} (${fmtBytes(result.size_bytes)})`,
            );
            await refetchList();
        } catch (err: any) {
            props.flash("err", `Import failed: ${err.message || err}`);
        } finally {
            setImporting(false);
        }
    };

    const remove = async (filename: string) => {
        if (!confirm(`Delete ${filename}?`)) return;
        try {
            await api.deleteBackup(filename);
            await refetchList();
        } catch (err: any) {
            props.flash("err", `Delete failed: ${err.message || err}`);
        }
    };

    return (
        <>
            <div class="panel panel-accent p-5">
                <h2 class="text-[15px] font-bold uppercase tracking-widest text-surf-300 mb-4 font-[family-name:var(--font-display)]">
                    Database Backups
                </h2>

                <Show
                    when={!settings.loading}
                    fallback={<div class="text-base-300 text-sm">Loading…</div>}
                >
                    <div class="flex flex-col gap-4">
                        <div class="border-2 border-base-600 bg-base-950 max-h-96 overflow-y-auto">
                            <For
                                each={list()?.backups || []}
                                fallback={
                                    <div class="text-base-300 text-center p-6 text-sm">
                                        No backups yet
                                    </div>
                                }
                            >
                                {(b) => (
                                    <div class="px-3 py-3 border-b border-base-700 last:border-b-0">
                                        <div class="flex items-start gap-2 flex-wrap">
                                            <span class="flex-1 min-w-0 text-sm text-base-50 break-all">
                                                {b.filename}
                                            </span>
                                            <span class="text-[11px] text-base-400 whitespace-nowrap">
                                                {fmtBytes(b.size_bytes)}
                                            </span>
                                        </div>
                                        <div class="text-[11px] text-base-400 mt-1">
                                            {new Date(
                                                b.created_at,
                                            ).toLocaleString()}
                                        </div>
                                        <div class="flex flex-wrap gap-2 mt-2">
                                            <a
                                                href={api.backupDownloadUrl(
                                                    b.filename,
                                                )}
                                                download={b.filename}
                                                class="press press-secondary press-sm"
                                            >
                                                Download
                                            </a>
                                            <button
                                                type="button"
                                                class="press press-danger press-sm"
                                                disabled={
                                                    restoring() === b.filename
                                                }
                                                onClick={() =>
                                                    restore(b.filename)
                                                }
                                            >
                                                {restoring() === b.filename
                                                    ? "Restoring…"
                                                    : "Restore"}
                                            </button>
                                            <button
                                                type="button"
                                                class="press press-ghost press-sm"
                                                onClick={() =>
                                                    remove(b.filename)
                                                }
                                            >
                                                Delete
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </For>
                        </div>

                        <div class="flex flex-wrap gap-3">
                            <Button
                                variant="secondary"
                                disabled={running()}
                                onClick={runNow}
                            >
                                {running() ? "Running…" : "Run backup now"}
                            </Button>
                            <Button
                                variant="secondary"
                                disabled={importing()}
                                onClick={() => fileInput?.click()}
                            >
                                {importing()
                                    ? "Importing…"
                                    : "Import from disk"}
                            </Button>
                            <input
                                ref={fileInput}
                                type="file"
                                accept=".dump,application/octet-stream"
                                class="hidden"
                                onChange={onPickFile}
                            />
                        </div>
                        <p class="text-[11px] text-base-400">
                            Import accepts a pg_dump custom-format file
                            (produced by{" "}
                            <code class="text-surf-300">pg_dump -Fc</code> or
                            downloaded above). It lands in the list as{" "}
                            <code class="text-surf-300">
                                crm-imported-&lt;timestamp&gt;.dump
                            </code>{" "}
                            and can then be restored like any other backup. A
                            full dump contains every tenant's data{" "}
                            <strong class="text-base-200">
                                including all settings tables
                            </strong>{" "}
                            (agent config, internal domains, memories, themes,
                            backup config).
                        </p>
                    </div>
                </Show>
            </div>
        </>
    );
}
