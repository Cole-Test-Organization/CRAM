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

### Running tests today

```bash
npm --prefix gui test          # frontend: vitest run (unit + component), hermetic
npm --prefix gui run test:watch
npm --prefix api test          # backend: node --test, needs the API + DB up (see §6)
```

A **root runner** (`npm test` at the repo root) that fans out to both is a Phase 1 deliverable.

---

## 5. Current state (as of 2026-06-02)

**Exists:**
- Frontend harness: `gui/vitest.config.ts` (Solid + jsdom), `gui/vitest.setup.ts` (auto-cleanup). Scripts `test` / `test:watch`.
- `gui/src/components/FormModals.test.tsx` — 2 component regression tests (notes persist; selected attendee persists).
- `gui/src/lib/unsavedGuard.ts` + `unsavedGuard.test.ts` — extracted primitive, 3 unit tests (incl. the `untrack`-is-untracked guarantee).
- `api/test/endpoints.test.js` — 17 tests (mostly smoke GETs) + 2 null-times regression tests. Runs via `node --test` against a live `localhost:3200`.
- `tsc --noEmit` passes for `gui`.
- Seed/reset tooling: `dev/scripts/seed-dev-data.js`, `dev/scripts/clear-db.js`, and a `seed` profile in `docker-compose.yml`.

**Missing (the gaps this roadmap closes):**
- ❌ No CI (`.github/workflows` absent), no root test runner, no git hooks — **nothing gates tests**.
- ❌ API tests are **not hermetic** — they run against whatever data is in the dev DB (this is why a partner test failed: none were seeded).
- ❌ No dedicated **test database**.
- ❌ Backend coverage is shallow (smoke GETs); writes, validation, and cross-resource rules are mostly untested across the ~20 route resources.
- ❌ No E2E.

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

### Phase 1 — Gate + test database (foundation) · effort: **M**
Make the existing suite run as one gated command, and stand up the seeded test DB in CI so API tests gate from day one.

- [ ] Root test runner (root `package.json` or Makefile): one `npm test` → `tsc` + `gui` vitest + `api` tests.
- [ ] CI workflow (assumed **GitHub Actions** — confirm) on PR/push:
  - [ ] `tsc` + `gui` vitest (hermetic, fast).
  - [ ] Stand up Postgres → migrate → seed (`clear-db.js` + `seed-dev-data.js`) → boot API → run `api/test` against the live seeded instance → tear down.
- [ ] (Optional) pre-push hook (lefthook/husky) running the fast hermetic subset locally.
- **Exit:** every PR gated; frontend + type layer green in CI; API suite green against a fresh seeded test DB.

### Phase 2 — Frontend coverage backfill · effort: **M** (incremental)
Apply the `FormModals.test.tsx` pattern to the stateful components. No new infra.

- [ ] Form modals: Account, Contact, Opportunity, Product, Vendor, VendorProduct (input persists, validation, submit calls the right API).
- [ ] Pickers: `AccountPicker`, `AttendeePicker`.
- [ ] Other stateful components: `EditableMarkdown`, `NotesPanel`, `SaveIndicator`, `createSelection`.
- [ ] Wire the `unsavedGuard` into other modals where unsaved-loss matters (guard is already unit-tested).
- **Exit:** every stateful component has smoke + key-behavior coverage.

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

- [ ] **CI platform** — assumed GitHub Actions; confirm the host (no CI exists today).
- [ ] **Test DB shape** — dedicated `crm_test` database vs a `test` docker-compose profile; per-run reset vs per-test transactions.
- [ ] **Playwright auth** — how to establish a Supabase test session deterministically (seeded test user + token, or a login step).
- [ ] **Coverage priorities** — rank components (Phase 2) and resources (Phase 3) by risk before backfilling.
- [ ] **Lint** — add ESLint (`eslint-plugin-solid`) to the static base? (Note: it would *not* have caught the reactivity bug — it targets under-reactivity, not over-subscription.)
