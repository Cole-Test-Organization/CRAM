# Provisioning Run Summary - 2026-06-29-aws-gp-lab-trusted-users-retry-04

API: http://127.0.0.1:3200/api

| Deployment | Provider | Deploy | Retry | Deprovision | Error |
|---|---|---:|---:|---:|---|
| aws-gp-lab-trusted-users | aws | failed |  | not-run | Windows bootstrap failed on win-user-a: Application claude-code failed: npm warn allow-scripts 1 package has install scripts not yet covered by allowScripts: Application log tail (C:\ProgramData\panw-broker\apps\claude-code.log): >>> if (Get-Command claude -ErrorAction SilentlyContinue) { claude --version; exit 0 } else { exit 1 } >>> New-Item -ItemType Directory -Force -Path 'C:\ProgramData\npm' \| Out-Null npm config set prefix 'C:\ProgramData\npm' $MachinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine') if ($MachinePath -notlike '*C:\ProgramData\npm*') {   [Environment]::SetEnvironmentVariable('Path', ($MachinePath + ';C:\ProgramData\npm'), 'Machine') } $env:Path = ([Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')) npm install -g @anthropic-ai/claude-code@latest |

Detailed JSONL log: /home/hcwilk/cram/work/provisioning-run-report-2026-06-29-aws-gp-lab-trusted-users-retry-04.jsonl
