# Provisioning Session Guidance - 2026-06-26

User direction for this run:

- Use only the current repo: `/home/hcwilk/cram`.
- Use the CRAM provisioning API for deployment lifecycle work.
- Include both AWS and Proxmox deployments.
- Before lifecycle runs, ensure every PAN-OS VM-Series resource has deactivation API support so deprovisioning can reclaim credits.
- If deactivation support is missing from code/config, add it, restart the broker, and reseed the provisioning catalog.
- Do not ask further follow-up questions.
- For each deployment: deploy, verify case by case that machines/resources are up and the job succeeded, then deprovision.
- If a deployment fails, tear it down, inspect the failure, apply a fix if it is clearly needed, and retry once.
- If it still cannot work, move on and record the error.
- API access was confirmed with `GET /api/provisioning/deployments`.
- AWS CLI debugging access was confirmed with `aws sts get-caller-identity`.
