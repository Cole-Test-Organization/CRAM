# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial open-source release.
- `LICENSE` — Sustainable Use License (free for internal business / personal
  use; cannot be hosted as a paid service).

### Changed
- Genericized example/seed content (vendor catalog comments, default-catalog
  migration header, agent instruction copy, todoist docs) so the project
  doesn't read as bound to one specific employer's product lineup.

### Removed
- Local observability stack (Alloy / Loki / Grafana / Ollama log bridge) from
  `docker-compose.yml`. Use `docker compose logs -f app` for development, or
  drop a `docker-compose.override.yml` next to it to wire in your own log
  shipper — Compose auto-merges the override file if present.
- Operator-specific infrastructure configs under `observability/` (VM, LXC,
  inference-host alloy configs). Now gitignored.
- Migration `1000000000015_remove-panw-from-vendor-catalog.cjs` — was a
  corrective migration specific to the original author's setup (a PANW SE
  shouldn't have PANW in their global customer-tech-stack catalog). For
  everyone else, PANW belongs in the seeded vendor catalog like any other
  security vendor.
