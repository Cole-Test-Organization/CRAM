# Linux Local Artifacts

Place Ubuntu/Linux endpoint payloads here.

## Koi enrollment

The Windows `local-artifacts/windows/koi.py` is a **PowerShell shim** (it shells out to
`powershell` and runs a .NET/RSA-signed payload) and will **not** run on Linux. Ubuntu needs
Koi's own **Linux enrollment artifact**, obtained the same way as the Windows one — from the Koi
console. It is typically a shell installer; a Python script also works.

Drop it here (default: `local-artifacts/linux/koi.sh`) and reference it from a deployment resource
with `koi.scriptPath`:

```ts
"koi": {
  "scriptPath": "local-artifacts/linux/koi.sh",
  "arguments": [],
  "environment": {},
  // Optional. Inferred from the extension when omitted: .py -> python3, otherwise bash.
  "interpreter": "bash",
  // Optional. Passed to the script on teardown to unregister the host. Defaults to ["--rollback"].
  "rollbackArguments": ["--rollback"],
  // Optional. Make a failed teardown rollback fatal instead of best-effort.
  "requireRollbackOnDestroy": false
}
```

The broker inlines this file into the Terraform/cloud-init bootstrap (base64) and runs it once at
first boot, after the CLIs install and internet egress is confirmed. It writes a
`koi.success`/`koi.failed` marker under `/var/lib/panw-broker/` that the broker polls over SSM. On
teardown the broker re-runs the on-box script with `rollbackArguments` (best-effort) before the
instance is destroyed.

The ready-made `aws-ubuntu-koi-endpoint` deployment expects this file. Until it is present, that
deployment will fail at prepare time with a "no such file" error for `koi.scriptPath`.

## Notes

- **Interpreter / rollback assumptions.** The default interpreter is `bash` and the default
  teardown argument is `--rollback`, mirroring the Windows flow. If Koi's Linux installer is a
  one-shot enroller with a different uninstall path, set `interpreter` / `rollbackArguments`
  accordingly (or `rollbackArguments: []` to run it with no extra flags).
- **Dependencies.** A `bash` installer needs only coreutils (already present). A Python installer
  runs under `python3`; add any Python packages it needs (for example `requests`) to the resource's
  `bootstrap.packages` or the `codex-claude` app profile so they are installed before Koi runs.
- **No secrets** in these files or in `koi.environment`; the payload is inlined into the
  Terraform/cloud-init bootstrap path and transits Terraform state.
