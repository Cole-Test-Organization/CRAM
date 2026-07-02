# Provisioning Run Summary - 2026-06-29-aws-gp-lab-trusted-users-retry-03

API: http://127.0.0.1:3200/api

| Deployment | Provider | Deploy | Retry | Deprovision | Error |
|---|---|---:|---:|---:|---|
| aws-gp-lab-trusted-users | aws | failed |  | not-run | Windows bootstrap failed on win-user-a: Application nodejs-lts failed: The remote server returned an error: (404) Not Found. Application log tail (C:\ProgramData\panw-broker\apps\nodejs-lts.log): >>> if (Get-Command node.exe -ErrorAction SilentlyContinue) { node --version; exit 0 } else { exit 1 } |

Detailed JSONL log: /home/hcwilk/cram/work/provisioning-run-report-2026-06-29-aws-gp-lab-trusted-users-retry-03.jsonl
