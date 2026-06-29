# Provisioning Run Summary - 2026-06-26

API: http://127.0.0.1:3200/api

| Deployment | Provider | Deploy | Retry | Deprovision | Error |
|---|---|---:|---:|---:|---|
| aws-panorama-lan | aws | succeeded |  | succeeded |  |
| aws-s3-bootstrap | aws | succeeded |  | succeeded |  |
| aws-single-firewall | aws | failed | failed | not-run | Failed to fetch VM-Series license for single-fw-1: Failed to install licenses. NOV-021 - Insufficient credits to create/update Consumption record. |
| aws-ubuntu-behind-firewall | aws | failed | failed | not-run | Failed to fetch VM-Series license for ubuntu-egress-fw-1: Failed to install licenses. NOV-021 - Insufficient credits to create/update Consumption record. |
| aws-ubuntu-server | aws | succeeded |  | succeeded |  |
| aws-windows-endpoint | aws | failed | failed | not-run | Windows bootstrap failed on hcwilk-broker-test: Traceback (most recent call last): |
| proxmox-fw-lab | proxmox | failed | failed | not-run | spawn mkisofs ENOENT |

Detailed JSONL log: /home/hcwilk/cram/work/provisioning-run-report-2026-06-26.jsonl
