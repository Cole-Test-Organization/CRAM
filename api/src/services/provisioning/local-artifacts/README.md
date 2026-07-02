# Provisioning Local Artifacts

Files here are resolved relative to the provisioning project root
(`api/src/services/provisioning` by default) and can be copied or inlined into
endpoint bootstraps.

For Windows endpoints:

- Koi scripts belong under `local-artifacts/windows/` and should be referenced
  from a deployment resource with `koi.scriptPath`, for example
  `local-artifacts/windows/koi.py`.
- Local installers belong under `local-artifacts/windows/` and should be
  referenced from Windows app profiles with `sourcePath`.

For Ubuntu/Linux endpoints (see `local-artifacts/linux/README.md`):

- Koi's **Linux** enrollment artifact belongs under `local-artifacts/linux/`
  (default `local-artifacts/linux/koi.sh`) and is referenced the same way with
  `koi.scriptPath`. The Windows `koi.py` is a PowerShell shim and does **not**
  run on Linux — use Koi's Linux installer.

Do not put secrets in these files or in `koi.environment`; the Koi payload is
inlined into the Terraform/SSM bootstrap path.
