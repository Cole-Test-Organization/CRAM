# api/ TypeScript Migration

Incremental JS→TS migration of the `api/` backend. Goal: type safety across the parity-heavy surfaces (HTTP ↔ MCP ↔ services bags ↔ instructions) and a clean target for bringing the (TypeScript) provisioning broker in. See `../broker.md`.

## Decisions

- **Runtime: `tsx` everywhere for now.** Dev (nodemon `--exec tsx`), tests (`run-api-tests.js` boots via api's local `tsx`), prod (`node --import tsx`). `tsx` is a runtime **dependency** (survives `npm ci --omit=dev`); `typescript` + `@types/*` are devDeps. Precompiling to `dist/` for prod is a later, optional hardening (add a `tsconfig.build.json` + a Docker build stage then).
- **`tsconfig.json` uses `NodeNext`, NOT `bundler`.** The API runs on Node directly, and NodeNext is the mode that expects the explicit `.js` import extensions already used throughout (199/199). Do not strip those extensions.
- **Coexistence via `allowJs:true` + `checkJs:false`.** `.js` and `.ts` interoperate; only `.ts` is type-checked, so unconverted files never error-wall the gate. Flip `allowJs:false` at the end.
- **Gate:** `tsc --noEmit` is api's `typecheck` script, chained into the root `typecheck` — so `npm test` and the pre-push hook now type-check the api too, exactly like the gui.
- **Out of scope:** migrations stay `.cjs` (node-pg-migrate runs them itself); `dev/scripts/*` stay host `.js`; `api/test/*.js` stay `.js` (mostly black-box HTTP clients) — but the api `test` runner now uses `node --import tsx` because `mcp.test.js` is **white-box**: it imports `src/` (the in-process MCP session + `closeDb`) directly.

## Status

- [x] **Phase 0 — Toolchain, no source renames** (2026-06-07). Added `tsconfig.json`; `tsx` + `typescript` + `@types/{node,pg,express,adm-zip}`; switched all three boot points (dev entrypoint, prod entrypoint, `run-api-tests.js`) to tsx; chained api typecheck into the root. **Verified green:** `npm run test:api` → 114 tests (API boots under tsx); `npm test` → gui+api typecheck + 61 gui tests. Zero `.js`→`.ts` renames — fully reversible.
- [x] **Phase 1 — Leaf/shared modules** (2026-06-07). Converted `db/connection.ts`, `lib/{http-error,logger}.ts`, and all 8 `services/_shared/*.ts`. Surfaced a **4th boot point**: the api `test` script now runs under `node --import tsx` (white-box `mcp.test.js` imports `src/`). One library-types gap handled with a `@ts-expect-error` (pg `setTypeParser` + the raw `_int8` array OID 1016). **Verified green:** `test:all` → 114 api + 61 gui.
- [x] **Phase 2 — Services (27), per resource** — DONE, 27/27 (2026-06-07), `test:all` green.
  - Done (20, first pass): todoist, internal-domains, product-categories, products, notes, search, vendor-heatmap, memories, account-details, agent-settings, outreach, vendors, agent-sessions, themes, export, events, threads, opportunities, vendor-products, backup.
  - Done (7, final batch — the largest files, converted in parallel one-agent-per-file): accounts, contacts, contact-enrichment, meetings, import-export, notes-import, calendar-import. Gate after the batch: `tsc --noEmit` green (0 errors) + `test:all` → 114 api + 61 gui. **Verified type-only**: each HEAD `.js` was diffed against its new `.ts` — every original-side change is a signature / declaration / accumulator / erased `as`-cast / guarded non-null assertion; no SQL, control-flow, or new `?.` was introduced (one `instanceof Error` the parallel agent emitted in import-export was re-aligned to the erased `(err as Error).message` cast to keep the original `err.message` runtime exactly).
  - Pattern that covers ~95% of errors: `userId: number`/`id: number`, explicit shapes on destructured option/`data` params, `PoolClient` on helper methods, typed accumulator objects (`Record<string, …>`), `catch (err)` → `(err as { code?: string })` / `(err as Error).message`. `pg` rows stay loosely typed (no `client.query<Row>()` yet — deferred polish). Job-queue services declare their instance fields + a job interface (`OutreachJob`, `ContactEnrichmentJob`, `NotesImportJob`); a few local data-shape interfaces were added where inference was too narrow (`AccountData`, `ContactData`, calendar-import's payload/attendee shapes). Injected cross-service deps are typed loosely (minimal `*Like` shapes or `any`) to avoid coupling — Phase 3 replaces these with the shared `services`-bag interface.
- [ ] **Phase 3 — Routes (25) + `mcp/tools` + `instructions` + `agent/*`:** type the `services` bag as an interface, so a service signature change breaks the route **and** the MCP tool that consume it (compiler-enforced four-surface parity).
- [ ] **Phase 4 — Entrypoints + glue:** `index`, `server`, `mcp/server`, `auth`; rename the boot entries to `.ts` (and update the 3 boot commands' entry to `.ts`); flip `allowJs:false`.
- [ ] **Phase 5 — Docs:** update `CLAUDE.md` (`api/src` is TS/NodeNext; migrations stay `.cjs`; dev still hot-reloads via tsx).

## To run the app in Docker under tsx

Host tests already pass (they boot on the host, which now has `tsx`). The **running containers** must be rebuilt to pick up the new `tsx` dep + changed entrypoints — a deps/entrypoint change, so `--build` is required. Verify `LOG_ENV_LABEL=dev` in `.env` first, then use the `dev/DEV.md` startup command with `--build` appended.

## Gotchas

- **NodeNext `.js` extensions** — keep them on relative imports even inside `.ts` files; that's correct, not a mistake.
- **Two entrypoints** (`index` + `mcp/server`) — every run context handles both.
- **`process.env.X` is `string | undefined`** under `strict` — a small typed `env.ts` is the clean fix as those sites get converted.
- **`pg` rows are `any`** — `client.query<Row>()` per service is where most of the real typing effort goes.
