# TEST-SPEC.md

Testing strategy and roadmap for the SE Operating System. **Living document** — update it as phases land and decisions change.

_Last updated: 2026-06-03._

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
| **Static** | `tsc --noEmit` | `gui/` | yes | Type errors, undefined refs. Not behavioral. (`api/` is plain JS/ESM — no `tsconfig`, not typechecked.) |
| **Unit** | Vitest + Solid `createRoot` (no DOM) | colocated `*.test.ts` | yes | One isolated unit's logic/reactivity (e.g. the `unsavedGuard` primitive). |
| **Component / integration (FE)** | Vitest + `@solidjs/testing-library` + **jsdom**, API **mocked** | colocated `*.test.tsx` | yes | Component behavior, reactivity, wiring. The bug-catching workhorse. |
| **Integration (BE)** | Node `node --test` + `fetch` vs a **live** API | `api/test/*.test.js` | **needs a DB** (see §6) | Real routes, validation, contracts, cross-resource rules. |
| **E2E** | Playwright (real browser, full stack, no mocks) | `e2e/` | needs live stack + seed | Critical user journeys end-to-end. |
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
npm run test:e2e  # E2E: same isolated-DB harness, but BUILDS the GUI, serves it from the
                  #   real API on one origin, seeds, then runs Playwright (Chromium). Needs
                  #   Docker + the Playwright browser. Heavy — nightly/on-demand, not in
                  #   test:all. (CI runs the same orchestration.)
npm run test:all  # the hermetic + API suites (NOT e2e — that's nightly/label-gated)

# Lower-level targets the root scripts fan out to:
npm --prefix gui test           # frontend: vitest run (unit + component), hermetic
npm --prefix gui run test:watch
npm --prefix gui run typecheck  # tsc --noEmit
npm --prefix api test           # backend: node --test against an ALREADY-RUNNING API (API_URL=…)
```

`npm test` is intentionally the **hermetic subset** (no DB, safe to run anywhere); the API suite is `npm run test:api` and gates every PR in CI. The orchestration shared by local + CI lives in `dev/scripts/run-api-tests.js` (migrate → boot → seed → test → teardown); `dev/scripts/test-api.sh` wraps it locally with the `db-test` compose service. The **E2E** suite mirrors this exactly — `dev/scripts/run-e2e-tests.js` (build GUI → migrate → boot → seed → **playwright** → teardown) + `dev/scripts/test-e2e.sh` — but is **not** on the every-PR path: its `.github/workflows/e2e.yml` runs nightly, on manual dispatch, and on PRs carrying the `e2e` label.

---

## 5. Current state (as of 2026-06-03)

**Exists:**
- Frontend harness: `gui/vitest.config.ts` (Solid + jsdom), `gui/vitest.setup.ts` (auto-cleanup). Scripts `test` / `test:watch` / `typecheck`.
- `gui/src/components/FormModals.test.tsx` — component tests for all 8 form modals: the 2 original meeting reactivity regressions, plus input-persists / validation / correct-`api.*`-on-submit for the rest, plus the unsaved-guard wiring. **(Expanded in Phase 2.)**
- `gui/src/lib/unsavedGuard.ts` + `unsavedGuard.test.ts` — extracted primitive, 3 unit tests (incl. the `untrack`-is-untracked guarantee).
- `api/test/*.test.js` — **backend integration suite (Phase 3): 104 tests / 17 files**, run serially (`node --test --test-concurrency=1 'test/*.test.js'`) against a live, seeded API (`API_URL`). Per-resource CRUD + validation + contracts, cross-resource invariants, an in-process HTTP↔MCP parity/wiring check (`mcp.test.js`), and validation-only smoke for the LLM/external resources (`external-smoke.test.js`). Shared HTTP client + exact seed-count constants live in `api/test/helpers.js`. (`endpoints.test.js` was split into these; the null-times regression now lives in `meetings.test.js`.)
- `tsc --noEmit` passes for `gui`.
- Seed/reset tooling: `dev/scripts/seed-dev-data.js`, `dev/scripts/clear-db.js`, and a `seed` profile in `docker-compose.yml`.
- **(Phase 1)** Root runner — `package.json` with `test` (hermetic), `test:api`, `test:all`.
- **(Phase 1)** CI — `.github/workflows/ci.yml`: a hermetic job (tsc + vitest) and an api-integration job (ephemeral Postgres → migrate → seed → boot → `api/test`), both gating PRs + pushes to `main`.
- **(Phase 1)** Isolated test DB — `db-test` (tmpfs Postgres, port 55433) under a `test` compose profile; orchestrated by `dev/scripts/run-api-tests.js` (shared by local + CI) and `dev/scripts/test-api.sh`.
- **(Phase 1)** Husky pre-push hook (`.husky/pre-push`) running the hermetic subset.
- **(Phase 2)** Component/unit tests for the stateful FE — `AccountPicker`, `AttendeePicker`, `EditableMarkdown`, `NotesPanel`, `SaveIndicator`, `createSelection` (colocated `*.test.tsx` / `*.test.ts`), plus the expanded `FormModals.test.tsx`. Full FE suite: **44 tests / 8 files**.
- **(Phase 3)** Backend coverage — `api/test` deepened from smoke GETs to **104 tests / 17 files**: write paths + validation + contracts for every deterministic resource (accounts, account-details, contacts, meetings, opportunities, products, product-categories, vendors, vendor-products, notes, memories, events, themes, search, import-export); cross-resource invariants (contact-delete cascade, `reassign_account`, `internal_domains` guard); HTTP↔MCP parity + in-process services-bag wiring (`mcp.test.js`); and validation-only smoke for the LLM/external/side-effecting resources (`external-smoke.test.js`). Loosened assertions re-tightened to exact seed counts (15 accounts / 32 contacts / 10 opps / 34 meetings / 10 details / 7 partnerships; 24 products / 5 categories / 5 themes / 75 vendors / 180 vendor-products).

- **(Phase 4)** E2E — `e2e/` Playwright suite (Chromium, serial `workers:1`) driving the **real GUI against a live, seeded API on one origin** (the API serves the built GUI; no Vite/proxy): **6 tests / 4 journey files + `helpers.ts`** — manual meeting → notes → save (incl. an Edit→Save that re-guards the null-times contract end-to-end), from-emails resolve → create, account creation (+ a validation block), internal-note triage (assign-account + keep-internal). DOM/role-based selectors, **no visual-regression**. Two `data-testid`s added (AccountPicker + AttendeePicker option rows). Orchestrated by `dev/scripts/run-e2e-tests.js` + `dev/scripts/test-e2e.sh`; run via `npm run test:e2e`.

**Missing (the gaps this roadmap closes):**
- ✅ Nothing outstanding — all four phases have shipped. Optional follow-ups remain in §9 (ESLint on the static base; cross-browser / mobile-viewport E2E).

**Resolved by Phase 1:** ~~no CI / root runner / git hooks~~; ~~API tests not hermetic~~ (they now run against a fresh, isolated, seeded DB); ~~no dedicated test database~~.

**Resolved by Phase 2:** ~~frontend coverage stops at two regression tests~~ — every stateful component (7 form modals, both pickers, `EditableMarkdown`, `NotesPanel`, `SaveIndicator`, `createSelection`) now has smoke + key-behavior tests, and `unsavedGuard` is wired into the multi-field modals. Frontend suite is **44 tests across 8 files**.

**Resolved by Phase 3:** ~~backend coverage is shallow (smoke GETs)~~ — write paths, validation, contracts, and cross-resource invariants now cover every deterministic resource, with HTTP↔MCP parity/wiring and validation smoke for the un-hermetic ones; the null-times regression was proven to have teeth and loosened assertions re-tightened to exact seed counts. Backend suite: **104 tests across 17 files**, green via `npm run test:api` + CI.

**Resolved by Phase 4:** ~~no E2E~~ — a thin Playwright cap now covers the 4 critical journeys end-to-end against the live seeded stack, asserted at the DOM level (no screenshots). The manual-meeting Edit→Save step was proven to have teeth (reverting the meetings PUT schema to string-only `starts_at` turns exactly that journey red). Suite: **6 tests / 4 files**, green via `npm run test:e2e` + the nightly/`e2e`-label-gated CI job.

---

## 6. Test database & environment strategy

**Decision: integration/E2E tests run against a _live instance with deterministic seed data_, not mocks — and the test database is part of the CI/CD pipeline from Phase 1.**

- **Dedicated test DB**, separate from dev/prod — built as the `test` compose profile's `db-test` (tmpfs Postgres, port 55433) locally and an ephemeral `postgres:16` service in CI, so runs never clobber real data and always start from a known state.
- **Fresh DB per run, then seed** — each run gets a brand-new empty database, so `migrate → seed-dev-data.js` is the whole pipeline (no `clear-db.js` step — there's nothing to clear). The same seed data the dev environment uses becomes the fixture set.
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

### Phase 3 — Backend coverage expansion · effort: **L** · ✅ **DONE (2026-06-03)**
Deepened `api/test` from smoke GETs to real coverage against the Phase 1 test DB. **104 tests / 17 files**, serial (`--test-concurrency=1`), with self-cleaning writes (namespaced `zzz-test-…` rows deleted in `t.after`) so the exact seed counts hold regardless of file order.

- [x] Write paths (POST/PUT/PATCH/DELETE) for every deterministic resource (accounts, account-details, contacts, meetings, opportunities, products, product-categories, vendors, vendor-products, notes, memories, events, themes, import-export).
- [x] Validation/contract tests (the null-times pattern) — null/omit/format semantics, required fields, enums, status codes (201/400/404/409).
- [x] Cross-resource invariants: contact-delete cascade (links drop, meeting + account survive), `reassign_account` (in-place link move, others preserved), `internal_domains` self-account guard. *(No literal merge endpoint exists — `find_or_create` dedupe + reassign is the "merge" path; both covered.)*
- [x] HTTP ↔ MCP parity + wiring — `mcp.test.js` builds the in-process MCP client (`buildMcpSession`), asserts the exact tool set + key action enums, drives every tool's read action so a service missing from the in-process bag is caught (the `Cannot read properties of undefined` class), and confirms the accounts status filter is reachable over MCP.
- [x] Re-tighten loosened assertions to exact seeded counts — `seed-invariants.test.js`.
- [x] LLM/external/side-effecting resources (agent, outreach, notes-import, backup, export) smoke-tested at the validation/shape boundary only — no real model / LinkedIn / file calls (`external-smoke.test.js`).
- **Exit:** ✅ **104/104 green** against the fresh seeded test DB; the null-times regression proven to have teeth (reverting the schema to string-only turns exactly that test red).

### Phase 4 — E2E · effort: **M** (last) · ✅ **DONE (2026-06-03)**
A thin Playwright layer over the live seeded stack. Reuses the Phase 1 seed for fixtures. Assertions are **DOM/role-based** (`getByRole` / `getByText` / `getByPlaceholder` / `getByTestId`, driven with `.click()` / `.fill()`) — the same query style as the Phase 2 component tests, just in a real browser against the real API. **No pixel / visual-regression diffing** (`toHaveScreenshot` is deliberately out of scope — that's the brittle, flaky kind; failure traces/screenshots are kept for debugging only). Where there's no natural role/label to grab, a small `data-testid` was added (only two: AccountPicker + AttendeePicker option rows).

- [x] Playwright setup — **no auth/login step needed**: the app has no authentication (every request resolves to the migration-seeded default user, see `api/src/auth.js`), so a test just loads the app and is already "signed in". The suite lives in `e2e/` (own package: `@playwright/test`, Chromium, serial `workers:1`); the GUI is **built and served by the real API on one origin** (`@fastify/static` + SPA fallback in `api/src/index.js`), so there's no Vite/proxy in the loop. Orchestrated by `dev/scripts/run-e2e-tests.js` (build → migrate → boot → seed → playwright → teardown), wrapped locally by `dev/scripts/test-e2e.sh` (the `db-test` tmpfs Postgres) — the same caller-owns-the-DB contract as `run-api-tests.js`.
- [x] 4 critical journeys: create meeting (manual) → type notes → save (+ an Edit→Save round that re-guards the null-times contract end-to-end); from-emails resolve → create; account creation (+ a validation-block case); internal-note triage (assign-account + keep-internal). Triage fixtures are arranged via the API (`POST /api/meetings {internal,needs_review}`) then driven in the browser. **6 tests / 4 files** (`e2e/tests/*.spec.ts`) + `helpers.ts`.
- [x] Run pre-merge/nightly, not on every push — `.github/workflows/e2e.yml` runs nightly (cron) + on manual dispatch + on any PR labeled `e2e` (an opt-in pre-merge gate for risky PRs). An unlabeled PR / a bare push never triggers it, so day-to-day PRs stay fast.
- **Exit:** ✅ **6/6 green** via `npm run test:e2e` (build GUI → fresh seeded test DB → real API+GUI on one origin → Playwright). DOM-level assertions, no screenshots. The manual-meeting Edit→Save journey was proven to have teeth (reverting the meetings PUT `starts_at` to string-only turns exactly that journey red, leaving the other 5 green).

**Dependencies:** Phase 1 unblocked/protected everything → Phase 2 followed (no new infra) → Phase 3 built on Phase 1's DB → Phase 4 (E2E) reused the same seed harness. **All four phases shipped.**

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
| E2E stack under test | **Build the GUI + serve it from the real API on one origin**, against an isolated tmpfs Postgres (the `test:api` harness shape + a `vite build`) | Hermetic, deterministic, prod-like (no Vite/proxy); reuses the Phase 1 seed and the caller-owns-DB orchestration. |
| E2E CI cadence | **Nightly + manual dispatch + opt-in `e2e` PR label** | Honors "never gate every push" while keeping a pre-merge gate available for risky PRs; real-browser flake stays off day-to-day PRs. |

---

## 9. Open questions / TODO

- [x] **CI platform** — ✅ **GitHub Actions** (`.github/workflows/ci.yml`); the repo's origin is on GitHub.
- [x] **Test DB shape** — ✅ **dedicated isolated Postgres**, not the dev DB: a `test` compose profile (`db-test`, tmpfs, port 55433) locally and an ephemeral `postgres:16` service in CI. **Per-run reset by recreation** (a fresh empty DB each run), not per-test transactions — simplest, and the seed is the deterministic fixture set. Note there's **no authentication** in the app yet — `api/src/auth.js` resolves every request to the migration-seeded default user (a placeholder until real auth lands), so the pipeline is just migrate → seed → test, with no login/session story to stand up.
- [x] **Playwright auth** — ✅ **N/A for now**: the app has no authentication (every request runs as the migration-seeded default user — `api/src/auth.js`), so E2E needs no login or session handling; Playwright just loads the app. A real session story only becomes a question if/when auth is actually built.
- [x] **Coverage priorities (Phase 3)** — ✅ resolved by covering every deterministic resource fully (CRUD + validation + invariants) and smoke-testing the LLM/external/side-effecting ones (agent, outreach, notes-import, backup, export) at the validation boundary only. See `external-smoke.test.js`.
- [ ] **Lint** — add ESLint (`eslint-plugin-solid`) to the static base? (Note: it would *not* have caught the reactivity bug — it targets under-reactivity, not over-subscription.) *(Not in Phase 1; still open.)*
- [ ] **Cross-browser / mobile-viewport E2E** — the Phase 4 cap is Chromium-desktop only (deliberately thin). Adding a Firefox/WebKit project or a 375px mobile project is a future expansion if a real cross-browser / mobile journey bug warrants it. *(Not in Phase 4.)*
