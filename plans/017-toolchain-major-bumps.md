# Plan 017: Bump the lagging dev/build/test toolchain to current majors

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` if that file exists (a reviewer may own the index — if
> so, skip it).
>
> **Drift check (run first)**:
>
> ```bash
> git diff --stat 3958dd6..HEAD -- \
>   package.json package-lock.json vite.config.ts \
>   vitest.integration.config.ts tsconfig.json
> git diff 3958dd6..HEAD -- package.json
> ```
>
> If any of these changed since this plan was written, RE-READ the current
> versions before proceeding (this plan's version numbers may be stale).
>
> **Version freshness (run first, ALWAYS)**: the numbers below were captured on
> 2026-07-12 and WILL drift. Re-run `npm outdated` and use the `Latest` column
> as truth; the table here is orientation, not gospel.

## Status

- **Priority**: P3
- **Effort**: M
- **Risk**: MED
- **Category**: migration
- **Depends on**: plans/004-*.md (CI) recommended first — these bumps should be
  gated by an automated test matrix so any regression is caught by CI, not by
  hand. This plan is executable without 004 but riskier.
- **Planned at**: commit `3958dd6`, 2026-07-12

## Why this matters

The dev/build/test toolchain has drifted 1–2 majors behind while the app code
kept moving. Every one of these is a **devDependency** — zero runtime /
production exposure — and `npm audit` reports **0 vulnerabilities**, so there is
no security pressure. The cost is purely staying-current: the longer the lag,
the larger and riskier the eventual jump (Vite 6→8 is two majors; TypeScript
5→6 can surface stricter inference). Doing it now, in small independently-
verifiable steps, keeps each bump attributable and revertable. When this lands,
the toolchain is current and future bumps are incremental.

## Current state

All lagging packages are in `devDependencies` in `package.json`. Captured
2026-07-12 via `npm outdated` (Current → Latest):

| Package                        | Current | Latest | Notes                                 |
| ------------------------------ | ------- | ------ | ------------------------------------- |
| `vite`                         | 6.4.3   | 8.1.3  | 2 majors; config/plugin API surface   |
| `@sveltejs/vite-plugin-svelte` | 5.1.1   | 7.1.2  | coupled to Vite major                 |
| `vitest`                       | 3.2.6   | 4.1.9  | shares Vite peer                      |
| `@vitest/ui`                   | 3.2.6   | 4.1.9  | must match `vitest` major             |
| `jsdom`                        | 25.0.1  | 29.1.1 | 4 majors; test DOM env                |
| `typescript`                   | 5.9.3   | 6.0.3  | stricter inference may surface errors |

`npm audit` → **found 0 vulnerabilities** (no security-forced bump).

Config files that these tools read (the only files that may need edits):

- `vite.config.ts` — Vite + `@sveltejs/vite-plugin-svelte` config, plus the
  custom dev/preview WebSocket plugin (`src/lib/server/realtime/attach.js`).
- `vitest.integration.config.ts` — integration test config.
- `tsconfig.json` — TypeScript compiler options (TS 6 may reject options or
  tighten inference).
- Vitest unit config — check whether it lives in `vite.config.ts` (a `test:`
  block) or a separate `vitest.config.ts`; the unit test command is
  `npm run test:unit`. Read `package.json` `scripts` to confirm which config
  each command uses before editing.

Conventions:

- This is a SvelteKit 2 + Svelte 5 app. `@sveltejs/kit` and `svelte` themselves
  are NOT part of this plan (they're minor-behind only) — do not bump them here.
- Do not touch application/runtime code. Blast radius is the four config files
  and test files ONLY.

## Commands you will need

| Purpose        | Command                    | Expected on success           |
| -------------- | -------------------------- | ----------------------------- |
| Check versions | `npm outdated`             | shows Current/Latest          |
| Audit          | `npm audit`                | found 0 vulnerabilities       |
| Install        | `npm install`              | exit 0, lockfile updated      |
| Typecheck/lint | `npm run check`            | exit 0, 0 errors, 0 warnings  |
| Build          | `npm run build`            | exit 0, `build/` produced     |
| Unit tests     | `npm run test:unit`        | all pass                      |
| All tests      | `npm test`                 | all pass                      |
| Integration    | `npm run test:integration` | all pass (needs dev server)   |
| E2E            | `npx playwright test`      | all pass (needs :5173 + seed) |
| Seed DB        | `npm run db:seed`          | idempotent seed               |
| Dev server     | `npm run dev`              | serves on :5173               |

**Full test matrix** (referenced below as "the full matrix"): `npm run check`
&& `npm run build` && `npm run test:unit` && `npm run test:integration` &&
`npx playwright test`. Integration + e2e need a dev server on `:5173` and a
seeded DB (`npm run db:seed`).

## Scope

**In scope** (modify only these):

- `package.json` (devDependency version ranges)
- `package-lock.json` (regenerated by `npm install`)
- `vite.config.ts` (only if the bump requires a config/plugin API change)
- `vitest.integration.config.ts` (only if required)
- `vitest.config.ts` if it exists (only if required)
- `tsconfig.json` (only if TS 6 requires an option change)
- Test files under `tests/` (only if an API change in Vitest 4 requires it)

**Out of scope** (do NOT touch):

- Any `src/` application/runtime code. If a bump forces an app-code change, that
  is a STOP condition — report the specific breakage.
- `svelte` and `@sveltejs/kit` version bumps (out of this plan's charter).
- Any `dependencies` (production) entry.
- Removing or restructuring the custom WebSocket dev plugin in `vite.config.ts`
  — if it breaks under Vite 8, report; do not rewrite the realtime transport.

## Git workflow

- Branch: `advisor/017-toolchain-bumps`
- One commit per step so each major is attributable/revertable, e.g.
  `chore(deps): bump vite cluster to 8 / vitest 4`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

Order is chosen so each step is independently verifiable and revertable. Do NOT
combine steps — attributability is the whole point.

### Step 1: Bump the Vite cluster together (Vite + plugin-svelte + Vitest + @vitest/ui)

These four share Vite as a peer and must move as a unit.

1. Re-run `npm outdated`; note the current `Latest` for `vite`,
   `@sveltejs/vite-plugin-svelte`, `vitest`, `@vitest/ui`.
2. Update those four ranges in `package.json` `devDependencies` to the latest
   majors (e.g. `vite@^8`, `@sveltejs/vite-plugin-svelte@^7`, `vitest@^4`,
   `@vitest/ui@^4` — use the actual `Latest` values).
3. `npm install` → exit 0. If npm reports peer-dependency conflicts (ERESOLVE),
   read them: they usually mean the plugin/vitest majors don't match the Vite
   major you picked. Adjust to a compatible set per each package's release notes
   (Vitest 4 targets Vite 6/7/8; `@sveltejs/vite-plugin-svelte` 7 targets
   Vite 8). If you cannot resolve without `--force`, STOP and report.
4. Review `vite.config.ts` against the Vite 8 + plugin-svelte 7 migration notes.
   Likely touch points: plugin option renames, `server`/`preview` option shapes,
   and the custom WebSocket dev/preview plugin (it hooks
   `configureServer`/`configurePreviewServer` — confirm those hooks still exist
   and fire). Change ONLY what the new API requires.
5. Review `vitest.integration.config.ts` (and `vitest.config.ts` if present) for
   Vitest 4 config changes (e.g. `environment`, `deps`, `pool` option renames).

**Verify** (full matrix, all green):

- `npm run check` → exit 0, 0 errors, 0 warnings
- `npm run build` → exit 0, `build/` produced
- `npm run test:unit` → all pass
- (dev server up + `npm run db:seed`) `npm run test:integration` → all pass
- `npx playwright test` → all pass

### Step 2: Bump TypeScript 5→6 (isolated follow-up)

Kept separate so any type errors are attributable to TS, not the Vite cluster.

1. Set `typescript` to the latest `Latest` (e.g. `^6`) in `package.json`;
   `npm install` → exit 0.
2. `npm run check`. TS 6's stricter inference may surface NEW type errors in
   `src/`. **If it does**: these are pre-existing latent issues newly exposed.
   Per the out-of-scope rule, do NOT silently edit app code to appease them
   unless the fix is a trivial, obviously-correct type annotation at the error
   site. If more than a handful of errors appear, or any fix is non-obvious,
   STOP and report the full `npm run check` output — a broad TS 6 type
   remediation is its own plan, not this one.
3. Check `tsconfig.json` for any compiler option TS 6 removed/renamed (it will
   error on unknown options at `check` time).

**Verify**:

- `npm run check` → exit 0, 0 errors, 0 warnings
- `npm run build` → exit 0
- `npm run test:unit` → all pass

### Step 3: Bump jsdom 25→29 (isolated)

jsdom only affects the test DOM environment.

1. Set `jsdom` to the latest `Latest` (e.g. `^29`); `npm install` → exit 0.
2. Run the tests that use jsdom (the unit suite and any component tests using
   `@testing-library/svelte`).

**Verify**:

- `npm run test:unit` → all pass
- `npm test` → all pass
- `npm run check` → exit 0

### Step 4: Confirm clean tree

1. `npm audit` → **found 0 vulnerabilities** (bumps introduced nothing).
2. `npm outdated | grep -Ei "vite|svelte|vitest|jsdom|typescript"` — the bumped
   packages should now show Current == Latest (except `svelte`/`@sveltejs/kit`,
   which are out of scope and may still show a minor gap).

**Verify**: full matrix green (repeat Step 1's five verify commands).

## Test plan

- No NEW tests — this is a dependency migration. The EXISTING suites are the
  regression gate; each step's "Verify" runs the full matrix.
- The definitive gate is: `npm run check` + `npm run build` + `npm run test:unit`
  - `npm run test:integration` + `npx playwright test` all green after every
    step. If plan 004's CI exists, the same matrix runs there.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `npm outdated` shows `vite`, `@sveltejs/vite-plugin-svelte`, `vitest`,
      `@vitest/ui`, `typescript`, `jsdom` at their latest majors (Current == Latest)
- [ ] `npm audit` → found 0 vulnerabilities
- [ ] `npm run check` exits 0 with 0 errors and 0 warnings
- [ ] `npm run build` exits 0 and produces `build/`
- [ ] `npm run test:unit`, `npm run test:integration`, and `npx playwright test`
      all pass
- [ ] No `src/` application code was modified (`git status` shows only config +
      `package*.json` + possibly `tests/`)
- [ ] `plans/README.md` status row updated (if that file exists)

## STOP conditions

Stop and report back (do not improvise) if:

- The drift check shows `package.json` already changed these versions since
  planning — re-read current state first.
- `npm install` cannot resolve peers without `--force` / `--legacy-peer-deps`.
  Report the ERESOLVE tree; do not force-install.
- A major bump breaks the build or a test and the fix is NOT an obvious,
  documented config/API rename — report the specific breakage (exact error +
  file). In particular: the custom WebSocket dev plugin in `vite.config.ts`
  failing under Vite 8, or `configureServer`/`configurePreviewServer` hooks no
  longer firing.
- TypeScript 6 surfaces more than a handful of type errors, or any error whose
  fix requires non-trivial `src/` changes — report the full `npm run check`
  output; broad TS 6 remediation is a separate plan.
- Any fix would require editing `src/` runtime code, `svelte`, or
  `@sveltejs/kit`.
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

- Bump `svelte` and `@sveltejs/kit` (and adapter-node, tailwind vite plugin,
  svelte-check, @testing-library/svelte — all currently minor-behind) in a
  SEPARATE routine dependency pass; deliberately excluded here to keep the major
  jumps isolated.
- Best executed AFTER plan 004 (CI) so the matrix runs automatically on the PR.
- Reviewer should scrutinize: (a) `vite.config.ts` diff, especially the custom
  realtime WebSocket plugin still attaches in dev + preview; (b) whether any TS 6
  "fix" changed runtime behavior vs just types; (c) that `package-lock.json`
  changes are limited to the bumped packages and their transitive deps.
- Each step is its own commit — if a later step regresses, revert just that
  commit.
