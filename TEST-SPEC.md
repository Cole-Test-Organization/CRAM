# TEST-SPEC.md

Testing strategy and roadmap for the SE Operating System. **Living document** — update it as phases land and decisions change.

_Last updated: 2026-06-02._

---

## 1. Why this exists

Two real regressions motivated this spec, and they're worth keeping as worked examples because each is caught by a *different* layer:

- **The reactivity bug (frontend).** The meeting-notes modal's init effect called `serialize()` (which reads every form signal) un-`untrack`ed, so the effect re-subscribed to all of them and re-ran — _resetting the form on every keystroke and every contact selection_. You couldn't type notes or keep a selected attendee. Invisible to `tsc` (types were fine) and to any pure-function unit test (the helpers were correct in isolation). Only a test that **renders the component and fires real input events** catches it.
- **The null-times 400 (backend).** The GUI correctly sent `starts_at: null` to mean "no time" (the documented contract), but the route's request schema typed it `string`-only. Fastify's ajv `coerceTypes` turned `null` → `""`, which failed the `date-time` format check → **400**. The frontend was right; the **server validation** was wrong. A frontend test that mocks the API _structurally cannot_ catch this — the `null` payload has to hit the real server.

**The lesson that drives everything below:** test at the layer where the defect can actually live. The frontend component test guards the frontend half of the client/server contract; the API integration test guards the server half. This bug fell in the gap between them — which is exactly why neither test existed.

---

## 2. Philosophy

We follow the **Testing Trophy** (not the old pyramid):

```
        E2E            ← thin cap: a few critical journeys (Playwright)
   ▓▓▓▓▓▓▓▓▓▓▓  integration / component  ← the fat middle (most ROI)
      unit          ← thin: tricky pure logic / primitives
   ───────────  static (types + lint)  ← the base (tsc)
```

Guiding principles:

- **Write tests that resemble how the software is used.** Query by placeholder/role/text and drive real events; don't assert on implementation details.
- **Lean on the fat middle.** Component + API-integration tests give the best confidence-per-cost. Most coverage lives here.
- **Keep E2E thin and deliberate.** Real-browser tests are slow and flaky; cover only critical journeys, run them pre-merge/nightly — never gate every push on the full E2E suite.
- **Don't chase 100%.** Test components/endpoints with real behavior, logic, reactivity, or contracts. Purely presentational components get exercised incidentally through their consumers.
- **"Regression" is a purpose, not a level.** A regression test (written to stop a known bug recurring) can live at any scope. Our `FormModals` tests (component level) and null-times tests (API level) are both regression tests.

---

## 3. Test types & layers

Two axes, often conflated: **scope** (how much is exercised) and **purpose** (e.g. regression). Here is every layer we use, lowest scope → highest:

| Layer | Tooling | Location | Hermetic? | Catches |
|---|---|---|---|---|
| **Static** | `tsc --noEmit` | `gui/`, `api/` | yes | Type errors, undefined refs. Not behavioral. |
| **Unit** | Vitest + Solid `createRoot` (no DOM) | colocated `*.test.ts` | yes | One isolated unit's logic/reactivity (e.g. the `unsavedGuard` primitive). |
| **Component / integration (FE)** | Vitest + `@solidjs/testing-library` + **jsdom**, API **mocked** | colocated `*.test.tsx` | yes | Component behavior, reactivity, wiring. The bug-catching workhorse. |
| **Integration (BE)** | Node `node --test` + `fetch` vs a **live** API | `api/test/*.test.js` | **needs a DB** (see §6) | Real routes, validation, contracts, cross-resource rules. |
| **E2E** | Playwright (real browser, full stack, no mocks) | `e2e/` (future) | needs live stack + seed | Critical user journeys end-to-end. |
| **Manual / exploratory** | `curl`, container logs, red→green flips | ad hoc | n/a | Root-causing, one-off confirmation, proving a test has teeth. A technique, not a deliverable. |

**jsdom is not a browser.** It gives `document`/`window`/`HTMLElement` as in-memory JS objects in Node, with **no rendering engine** (no layout, no paint). So component tests answer "does it *behave* correctly?" — not "does it *look* right." Visual/layout correctness is E2E's job.

---

## 4. Conventions

- **Frontend tests are colocated** next to source: `Foo.tsx` → `Foo.test.tsx`; `bar.ts` → `bar.test.ts`. No mirrored test tree. (Backend tests live in `api/test/`, matching the existing Node `--test` convention. It's fine for FE and BE to differ — different runners.)
- **Not 1:1 with files.** Test components/modules with real behavior; one test file may cover several exports (e.g. `FormModals.test.tsx` covers multiple modals). Skip purely presentational components.
- **Mock the network in FE tests:** `vi.mock('../lib/api')`. Component tests must stay hermetic.
- **Share tricky logic in a tested primitive.** The unsaved-changes guard lives in `gui/src/lib/unsavedGuard.ts` (with `untrack` baked into `rebaseline()`), so the reactivity footgun can't be reintroduced per-modal. Extend this pattern for other cross-cutting form logic.
- **Flush async reactivity** before asserting in FE tests (`await new Promise(r => setTimeout(r, 0))`) — the buggy reset happened asynchronously, so asserting too early would let a broken version pass.
- **Prove regression tests have teeth.** When adding a regression test, confirm it fails against the pre-fix code (revert the fix, watch it go red), then restore.

### Running tests

```bash
# From the repo root (the root runner — landed in Phase 1):
npm test          # hermetic gate: tsc (gui) + gui vitest. Fast, no DB.
                  #   ↑ also what the husky pre-push hook and CI's hermetic job run.
npm run test:api  # API integration: brings up an ISOLATED throwaway Postgres, migrates +
                  #   seeds it, boots the API, runs api/test, tears it down. Needs Docker.
                  #   Never touches your dev data. (CI runs the same orchestration.)
npm run test:all  # both of the above

# Lower-level targets the root scripts fan out to:
npm --prefix gui test           # frontend: vitest run (unit + component), hermetic
npm --prefix gui run test:watch
npm --prefix gui run typecheck  # tsc --noEmit
npm --prefix api test           # backend: node --test against an ALREADY-RUNNING API (API_URL=…)
```

`npm test` is intentionally the **hermetic subset** (no DB, safe to run anywhere); the API suite is `npm run test:api` and gates every PR in CI. The orchestration shared by local + CI lives in `dev/scripts/run-api-tests.js` (migrate → boot → seed → test → teardown); `dev/scripts/test-api.sh` wraps it locally with the `db-test` compose service.

---

## 5. Current state (as of 2026-06-02)

**Exists:**
- Frontend harness: `gui/vitest.config.ts` (Solid + jsdom), `gui/vitest.setup.ts` (auto-cleanup). Scripts `test` / `test:watch` / `typecheck`.
- `gui/src/components/FormModals.test.tsx` — 2 component regression tests (notes persist; selected attendee persists).
- `gui/src/lib/unsavedGuard.ts` + `unsavedGuard.test.ts` — extracted primitive, 3 unit tests (incl. the `untrack`-is-untracked guarantee).
- `api/test/endpoints.test.js` — 17 tests (mostly smoke GETs) + 2 null-times regression tests. Runs via `node --test` against a live API (`API_URL`).
- `tsc --noEmit` passes for `gui`.
- Seed/reset tooling: `dev/scripts/seed-dev-data.js`, `dev/scripts/clear-db.js`, and a `seed` profile in `docker-compose.yml`.
- **(Phase 1)** Root runner — `package.json` with `test` (hermetic), `test:api`, `test:all`.
- **(Phase 1)** CI — `.github/workflows/ci.yml`: a hermetic job (tsc + vitest) and an api-integration job (ephemeral Postgres → migrate → seed → boot → `api/test`), both gating PRs + pushes to `main`.
- **(Phase 1)** Isolated test DB — `db-test` (tmpfs Postgres, port 55433) under a `test` compose profile; orchestrated by `dev/scripts/run-api-tests.js` (shared by local + CI) and `dev/scripts/test-api.sh`.
- **(Phase 1)** Husky pre-push hook (`.husky/pre-push`) running the hermetic subset.

**Missing (the gaps this roadmap closes):**
- ❌ Backend coverage is shallow (smoke GETs); writes, validation, and cross-resource rules are mostly untested across the ~20 route resources. *(Phase 3 — now builds on the Phase 1 test DB.)*
- ❌ No E2E. *(Phase 4.)*

**Resolved by Phase 1:** ~~no CI / root runner / git hooks~~; ~~API tests not hermetic~~ (they now run against a fresh, isolated, seeded DB); ~~no dedicated test database~~.

**Resolved by Phase 2:** ~~frontend coverage stops at two regression tests~~ — every stateful component (7 form modals, both pickers, `EditableMarkdown`, `NotesPanel`, `SaveIndicator`, `createSelection`) now has smoke + key-behavior tests, and `unsavedGuard` is wired into the multi-field modals. Frontend suite is **44 tests across 8 files**.

---

## 6. Test database & environment strategy

**Decision: integration/E2E tests run against a _live instance with deterministic seed data_, not mocks — and the test database is part of the CI/CD pipeline from Phase 1.**

- **Dedicated test DB**, separate from dev/prod (e.g. a `crm_test` database or a `test` compose profile), so runs never clobber real data and always start from a known state.
- **Reset + seed before the suite**, reusing the existing tooling: `clear-db.js` then `seed-dev-data.js` (pointed at the test DB via `DATABASE_URL`). The same seed data the dev environment uses becomes the fixture set.
- **Boot the real API** (real Fastify + real Postgres, no mocks) against the test DB; run `api/test` (and later Playwright) against it; tear down.
- **CI/CD pipeline** (Phase 1): stand up Postgres → run migrations (`node-pg-migrate`) → seed → boot the API → run the suite → tear down. Per-run ephemeral so it's deterministic and isolated.

**Payoff:** with a known seed, assertions can be **exact** instead of loose. E.g. the partner test that we had to soften to "don't assume partners exist" can re-tighten to "the seed has N partners" once it runs against the seeded test DB. Deterministic data is what makes the backend suite trustworthy.

---

## 7. The phased plan

Confirmed shape: **4 phases**, E2E last. Because we chose to **spin up the stack in CI now**, the test-database infrastructure lands in **Phase 1** (not deferred); Phase 3 is then pure backend coverage expansion on top of it.

### Phase 1 — Gate + test database (foundation) · effort: **M** · ✅ **DONE (2026-06-02)**
Make the existing suite run as one gated command, and stand up the seeded test DB in CI so API tests gate from day one.

- [x] Root test runner (root `package.json`): `npm test` → `tsc` (gui) + `gui` vitest. **Decision:** `npm test` is the **hermetic** subset; the `api` suite is split into `npm run test:api` (+ CI) rather than folded into `npm test`, so the one-command gate is always fast and safe to run anywhere.
- [x] CI workflow (**GitHub Actions** — confirmed) on PR/push — `.github/workflows/ci.yml`:
  - [x] `tsc` + `gui` vitest (hermetic, fast) — the `hermetic` job.
  - [x] Stand up Postgres → migrate → seed (`seed-dev-data.js`) → boot API → run `api/test` against the live seeded instance → tear down — the `api-integration` job. **Note:** `clear-db.js` isn't needed in the pipeline — each run gets a brand-new empty DB (tmpfs locally / ephemeral service in CI), so there's nothing to clear.
- [x] Pre-push hook (**husky**) running the fast hermetic subset locally — `.husky/pre-push` runs `npm test`.
- **Exit:** ✅ every PR gated; frontend + type layer green in CI; API suite green (17/17) against a fresh seeded test DB.

### Phase 2 — Frontend coverage backfill · effort: **M** (incremental) · ✅ **DONE (2026-06-02)**
Apply the `FormModals.test.tsx` pattern to the stateful components. No new infra.

- [x] Form modals: Account, Contact, Opportunity, Product, **ProductCategory**, Vendor, VendorProduct (input persists, validation blocks the API, a valid submit calls the right `api.*` and closes) — all in `FormModals.test.tsx`.
- [x] Pickers: `AccountPicker` (list / filter / pick → onChange / excludePartner / inline create) and `AttendeePicker` (account-gating, toggle → onChange, chip remove) — colocated `*.test.tsx`.
- [x] Other stateful components: `EditableMarkdown`, `NotesPanel`, `SaveIndicator`, `createSelection` — colocated `*.test.tsx` / `*.test.ts`.
- [x] Wired the `unsavedGuard` into the multi-field modals (Account, Contact, Opportunity, Vendor, VendorProduct): confirm-on-dirty-close + a regression test. The trivial Product / ProductCategory modals are intentionally left unguarded.
- **Exit:** ✅ every stateful component has smoke + key-behavior coverage. Frontend suite: **44 tests / 8 files**, hermetic, green via `npm test` + CI. The reactivity-regression tests were proven to have teeth (a re-subscription probe turns them red).

### Phase 3 — Backend coverage expansion · effort: **L**
Deepen `api/test` from smoke GETs to real coverage, against the Phase 1 test DB. Tighten assertions to the known seed.

- [ ] Write paths (POST/PUT/DELETE) for each of the ~20 resources.
- [ ] Validation/contract tests (the null-times pattern) — null/omit/format semantics, required fields, enums.
- [ ] Cross-resource invariants: cascade-on-contact-delete, `reassign_account`, merge behavior, `internal_domains` self-account guard.
- [ ] HTTP ↔ MCP parity checks (every service op reachable on both surfaces).
- [ ] Re-tighten loosened assertions to exact seeded counts.
- **Exit:** backend writes + validation + key invariants covered, green in CI.

### Phase 4 — E2E · effort: **M** (last)
A thin Playwright layer over the live seeded stack. Reuses the Phase 1 seed for fixtures.

- [ ] Playwright setup + auth handling (Supabase session).
- [ ] 3–5 critical journeys: login → create meeting (manual) → type notes → save; from-emails flow; account creation; internal-note triage.
- [ ] Run pre-merge/nightly, not on every push.
- **Exit:** critical paths covered end-to-end in a real browser.

**Dependencies:** Phase 1 unblocks/protects everything → Phase 2 starts immediately after (no new infra) → Phase 3 builds on Phase 1's DB → Phase 4 last (reuses the seed harness).

---

## 8. Decisions log

| Decision | Choice | Rationale |
|---|---|---|
| Phasing | **4 phases**, E2E last | Each phase ships standalone value; isolates the heavy work. |
| API tests in CI | **Spin up the stack now** (not deferred) | Gate the backend contract from day one; the test DB is foundational, so it moves into Phase 1. |
| Test data | **Live instance + reused seed data** (`seed-dev-data.js`) | Deterministic fixtures → exact assertions; mirrors how the app actually runs. No mocked DB for integration/E2E. |
| FE test placement | Colocated `*.test.tsx` | Stays in sync, discoverable, short imports — the Vitest/frontend norm. |
| FE test stack | Vitest + `@solidjs/testing-library` + jsdom | Vite-native (reuses `vite-plugin-solid`); already used in the sibling `full-automation/browser` project. |
| Shared form logic | Extracted `lib/unsavedGuard.ts` primitive | Encapsulates the `untrack` footgun once; tested in isolation. |
| E2E tool | **Playwright** (over Puppeteer/Cypress) | Purpose-built for testing, cross-browser, auto-waiting; free/open (Apache-2.0). |

---

## 9. Open questions / TODO

- [x] **CI platform** — ✅ **GitHub Actions** (`.github/workflows/ci.yml`); the repo's origin is on GitHub.
- [x] **Test DB shape** — ✅ **dedicated isolated Postgres**, not the dev DB: a `test` compose profile (`db-test`, tmpfs, port 55433) locally and an ephemeral `postgres:16` service in CI. **Per-run reset by recreation** (a fresh empty DB each run), not per-test transactions — simplest, and the seed is the deterministic fixture set. Note auth needs no Supabase: `getCurrentUserId` resolves to the migration-seeded default user (`api/src/auth.js`), so the pipeline is just migrate → seed → test.
- [ ] **Playwright auth** — how to establish a session deterministically (seeded test user + token, or a login step). *(Phase 4. Today auth is stubbed to the default user, so a real session story is only needed once auth lands.)*
- [ ] **Coverage priorities** — rank components (Phase 2) and resources (Phase 3) by risk before backfilling.
- [ ] **Lint** — add ESLint (`eslint-plugin-solid`) to the static base? (Note: it would *not* have caught the reactivity bug — it targets under-reactivity, not over-subscription.) *(Not in Phase 1; still open.)*
