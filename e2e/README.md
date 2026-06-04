# E2E tests (Playwright)

The thin top of the Testing Trophy (see [`../TEST-SPEC.md`](../TEST-SPEC.md) §2):
a few **critical journeys** driven in a real browser against the **real, seeded**
stack. DOM/role-based assertions only — **no visual-regression** (`toHaveScreenshot`
is deliberately out of scope; failure traces/screenshots are kept only for debugging).

## Run it

```bash
# From the repo root — the whole isolated harness (needs Docker):
npm run test:e2e
```

That fans out to `dev/scripts/test/test-e2e.sh` → `dev/scripts/test/run-e2e-tests.js`, which:

1. **builds** the GUI (`vite build` → `api/public`),
2. brings up an **isolated tmpfs Postgres** (`db-test`, :55433) and **migrates** it,
3. **boots the real API** on `:3201` — which also serves the built GUI, so the
   browser hits **one prod-like origin** (no Vite, no proxy),
4. **seeds** the deterministic fixtures (`dev/scripts/seed-dev-data.js`),
5. runs **Playwright** (Chromium), then tears the API + DB down.

Your dev database is never touched. CI runs the identical `run-e2e-tests.js`
against a GitHub Actions Postgres service.

### Against an already-running stack

```bash
BASE_URL=http://localhost:80 npm --prefix e2e test   # e.g. the dev stack
```

Point `BASE_URL` at any running instance and Playwright drives it. (It will
**mutate that instance's data** — prefer the isolated harness above.)

First run needs the browser binary once: `npm --prefix e2e run install:browsers`.

## Layout & conventions

- `tests/*.spec.ts` — one file per journey; `tests/helpers.ts` — seed fixtures, a
  `createParkedNote` API-arrange helper, and dialog handling.
- **Serial** (`workers: 1`): every journey writes to one shared seeded DB —
  determinism over speed (mirrors the backend suite's `--test-concurrency=1`).
- Query by **role / text / placeholder**; reach for `getByTestId` only where
  there's no natural handle (today just `account-option`, `attendee-option`).
- **Arrange via API, act + assert via UI** where a precondition is awkward to
  click to (e.g. the triage tests `POST` a `needs_review` note, then triage it).

## CI cadence

`.github/workflows/e2e.yml` runs **nightly**, on **manual dispatch**, and on any
PR labeled **`e2e`** — never on an unlabeled PR or a bare push, so day-to-day PRs
stay fast (`TEST-SPEC.md` §7).
