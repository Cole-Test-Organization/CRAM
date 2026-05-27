import {
    createEffect,
    createResource,
    createSignal,
    For,
    Show,
} from "solid-js";
import { api } from "../../lib/api";
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

    // Working copy of the editable fields. Initialized once settings resolve.
    const [enabled, setEnabled] = createSignal(false);
    const [cronExpr, setCronExpr] = createSignal("0 2 * * *");
    const [retention, setRetention] = createSignal(30);
    const [targetDir, setTargetDir] = createSignal("/backups");

    // Sync working copy whenever settings load/reload.
    createEffect(() => {
        const s = settings();
        if (!s) return;
        setEnabled(s.enabled);
        setCronExpr(s.cron);
        setRetention(s.retention_count);
        setTargetDir(s.target_dir);
    });

    const [saving, setSaving] = createSignal(false);
    const [running, setRunning] = createSignal(false);
    const [restoring, setRestoring] = createSignal<string | null>(null);
    const [importing, setImporting] = createSignal(false);
    let fileInput: HTMLInputElement | undefined;

    const save = async () => {
        setSaving(true);
        try {
            await api.updateBackupSettings({
                enabled: enabled(),
                cron: cronExpr(),
                retention_count: retention(),
                target_dir: targetDir(),
            });
            await refetchSettings();
            props.flash("ok", "Settings saved");
        } catch (err: any) {
            props.flash("err", `Save failed: ${err.message || err}`);
        } finally {
            setSaving(false);
        }
    };

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
            props.flash("ok", `Restored from ${filename}`);
        } catch (err: any) {
            props.flash("err", `Restore failed: ${err.message || err}`);
        } finally {
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
            {/* === BACKUP CONFIG === */}
            <div class="panel panel-accent p-5">
                <h2 class="text-[15px] font-bold uppercase tracking-widest text-surf-300 mb-4 font-[family-name:var(--font-display)]">
                    Database Backups
                </h2>

                <p class="text-base-300 text-[12px] mb-4">
                    Scheduled <code class="text-surf-300">pg_dump</code>{" "}
                    snapshots of every tenant's data. The target directory is
                    bind-mounted from the host — set{" "}
                    <code class="text-surf-300">BACKUP_HOST_DIR</code> in your{" "}
                    <code class="text-surf-300">.env</code> to point the host
                    side at any absolute path (e.g.{" "}
                    <code class="text-surf-300">/Volumes/Backups/crm</code>).
                    Inside the container, backups land in the path below.
                </p>

                <Show
                    when={!settings.loading}
                    fallback={
                        <div class="text-base-300 text-sm">Loading…</div>
                    }
                >
                    <div class="flex flex-col gap-4">
                        <label class="flex items-center gap-3 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={enabled()}
                                onChange={(e) =>
                                    setEnabled(e.currentTarget.checked)
                                }
                                class="accent-surf-400"
                            />
                            <span class="text-sm text-base-50">
                                Enabled (run on cron schedule)
                            </span>
                        </label>

                        <label class="flex flex-col gap-1">
                            <span class="text-[11px] uppercase tracking-wider text-base-300">
                                Cron schedule
                            </span>
                            <input
                                type="text"
                                value={cronExpr()}
                                onInput={(e) =>
                                    setCronExpr(e.currentTarget.value)
                                }
                                placeholder="0 2 * * *"
                                class="input-vintage"
                            />
                            <span class="text-[11px] text-base-400">
                                Standard 5 fields: minute hour day-of-month
                                month day-of-week. Example:{" "}
                                <code class="text-surf-300">0 2 * * *</code> =
                                daily at 02:00.
                            </span>
                        </label>

                        <label class="flex flex-col gap-1">
                            <span class="text-[11px] uppercase tracking-wider text-base-300">
                                Retention (number of dumps to keep)
                            </span>
                            <input
                                type="number"
                                min="0"
                                value={retention()}
                                onInput={(e) =>
                                    setRetention(
                                        parseInt(
                                            e.currentTarget.value || "0",
                                            10,
                                        ),
                                    )
                                }
                                class="input-vintage"
                            />
                            <span class="text-[11px] text-base-400">
                                0 keeps every dump (no pruning).
                            </span>
                        </label>

                        <label class="flex flex-col gap-1">
                            <span class="text-[11px] uppercase tracking-wider text-base-300">
                                Target directory (in-container path)
                            </span>
                            <input
                                type="text"
                                value={targetDir()}
                                onInput={(e) =>
                                    setTargetDir(e.currentTarget.value)
                                }
                                placeholder="/backups"
                                class="input-vintage"
                            />
                            <span class="text-[11px] text-base-400">
                                Must be absolute and inside the{" "}
                                <code class="text-surf-300">/backups</code>{" "}
                                bind mount. Sub-paths like{" "}
                                <code class="text-surf-300">
                                    /backups/daily
                                </code>{" "}
                                work too.
                            </span>
                        </label>

                        <div class="flex flex-wrap gap-3">
                            <Button
                                variant="primary"
                                disabled={saving()}
                                onClick={save}
                            >
                                {saving() ? "Saving…" : "Save settings"}
                            </Button>
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
                            backup schedule).
                        </p>
                    </div>
                </Show>
            </div>

            {/* === BACKUP LIST === */}
            <div class="panel panel-accent p-5">
                <h2 class="text-[15px] font-bold uppercase tracking-widest text-surf-300 mb-4 font-[family-name:var(--font-display)]">
                    Existing Backups
                </h2>

                <Show
                    when={!list.loading}
                    fallback={
                        <div class="text-base-300 text-sm">Loading…</div>
                    }
                >
                    <div class="text-[11px] text-base-400 mb-3">
                        <span class="uppercase tracking-wider text-base-300">
                            Target:
                        </span>{" "}
                        <code class="text-surf-300">{list()?.target_dir}</code>
                    </div>

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
                                            onClick={() => restore(b.filename)}
                                        >
                                            {restoring() === b.filename
                                                ? "Restoring…"
                                                : "Restore"}
                                        </button>
                                        <button
                                            type="button"
                                            class="press press-ghost press-sm"
                                            onClick={() => remove(b.filename)}
                                        >
                                            Delete
                                        </button>
                                    </div>
                                </div>
                            )}
                        </For>
                    </div>
                </Show>
            </div>
        </>
    );
}
