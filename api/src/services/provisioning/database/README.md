# Database-Bound YAML

This folder holds the YAML records that are expected to become Postgres-backed
records when the broker is ported into the SE Operating System app.

YAML is the local/dev storage backend. It is not the long-term source-of-truth
contract.

## Folders

- `deployments/`
  - One desired deployment or lab topology per file.
  - Future DB shape: deployment row plus deployment resource rows or JSONB.

- `provider-profiles/`
  - Reusable cloud/provider defaults such as AWS region, profile env names,
    shared CIDR defaults, or Proxmox endpoint env references.
  - Future DB shape: reusable provider profile records.

- `resource-profiles/`
  - Reusable Terraform mapping recipes for provider/resource-kind pairs.
  - Future DB shape: reusable resource profile records that reference Terraform
    stacks/modules and store variable mappings.

- `legacy-firewalls/`
  - Old single-firewall YAML fixtures kept for compatibility with the original
    Proxmox VM-Series flow.
  - Future DB shape: migrate these into deployment/resource records, then retire
    this folder.

## Not Here

Terraform modules, generated Terraform state, and secret material are not
database config records. They stay under `terraform/`, `work/`, or
secret-management-specific locations.
