# Plan 004: Add a GitHub Actions CI pipeline that runs check + unit tests on every push and PR

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 3958dd6..HEAD -- package.json .github/`
> If `package.json`'s scripts changed, re-verify the script names in the
> "Current state" excerpt before writing the workflow.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: plans/001-integration-skip-as-pass.md (only for the OPTIONAL heavier job)
- **Category**: dx
- **Planned at**: commit `3958dd6`, 2026-07-12

## Why this matters

There is NO CI: `ls .github` returns "No such file or directory". Nothing runs
`npm run check` or `npm run test:unit` when code is pushed or a PR is opened, so
type errors and unit-test regressions can land on `dev`/`main` unnoticed. The
fast, server-free subset (svelte-check + 416 unit tests across 17 files) runs
headless in seconds and is the highest-value first CI gate. This plan adds that
gate. The heavier integration/e2e jobs (which need a live seeded server) are
documented as a follow-up and depend on Plan 001 — otherwise the integration job
would pass vacuously (see that plan).

## Current state

- No `.github/` directory exists (verify: `ls .github` → error).
- Node version: 22 (the `.ts` seed script runs directly via `node --env-file`).
- Relevant `package.json` scripts (verbatim, `package.json:13-21`):

```json
"check": "svelte-kit sync && svelte-check --tsconfig ./tsconfig.json",
"db:push": "drizzle-kit push",
"db:seed": "node --env-file=.env scripts/seed.ts",
"start": "node --env-file=.env server.js",
"test": "vitest run",
"test:unit": "vitest run tests/unit",
"test:integration": "vitest run --config vitest.integration.config.ts",
"test:watch": "vitest",
"test:e2e": "playwright test"
```

- `prebuild` runs `node scripts/build-heroicons-sprite.mjs` (icons sprite). The
  `check` script runs `svelte-kit sync` first, which generates `.svelte-kit`
  types; it does NOT require the icon sprite, but a clean checkout has neither.
  To be safe, the workflow runs `npm run icons:build` before `check` (cheap,
  no side effects) so any component importing sprite output resolves.
- Unit tests need no DB/server: `vitest.config.ts` uses jsdom and includes
  `tests/unit/**` + `src/**/*.{test,spec}.ts`.
- Integration tests (`vitest.integration.config.ts`) and e2e
  (`playwright.config.ts`) both hit a live server on `:5173`;
  `playwright.config.ts` deliberately does NOT start a server
  (`// A dev server is ALREADY running on :5173 — do NOT start/kill one here.`).
- DB: default dialect is SQLite; `db:seed` and `start`/`dev` read `.env` via
  `--env-file=.env`. A CI SQLite run needs a minimal `.env`
  (`DB_DIALECT=sqlite`, `DATABASE_URL=./data/ci.db`) plus a seeded admin — the
  seed reads `SEED_ADMIN_PASSWORD` (env var; has a dev fallback in
  `scripts/seed.ts`). **Never hardcode a real secret in the workflow.**

Repo convention: conventional commits (see `git log`); branch `dev` is default,
`main` is the release branch.

## Commands you will need

| Purpose                | Command                                                                                | Expected on success                   |
| ---------------------- | -------------------------------------------------------------------------------------- | ------------------------------------- |
| Install (CI)           | `npm ci`                                                                               | exit 0                                |
| Icons sprite           | `npm run icons:build`                                                                  | exit 0, writes `static/heroicons.svg` |
| Typecheck              | `npm run check`                                                                        | exit 0, no errors                     |
| Unit tests             | `npm run test:unit`                                                                    | all pass                              |
| Validate workflow YAML | `npx --yes @action-validator/cli .github/workflows/ci.yml` (optional; skip if offline) | exit 0                                |

## Scope

**In scope** (create these):

- `.github/workflows/ci.yml`

**Out of scope** (do NOT touch):

- `package.json` — the scripts already exist; do not rename or add scripts here.
- `playwright.config.ts` / `vitest.integration.config.ts` — no changes.
- Any secret material — the workflow references env var NAMES only.

## Git workflow

- Branch: `advisor/004-ci-pipeline`.
- Commit: `ci: add GitHub Actions workflow running check + unit tests`.
- Do NOT push or open a PR unless the operator instructed it. (Note: the
  workflow will only actually run once it reaches GitHub — that is expected and
  out of this executor's control.)

## Steps

### Step 1: Create the fast `check + unit` workflow

Create `.github/workflows/ci.yml` with a single job that runs on PRs and on
push to `dev`/`main`:

```yaml
name: CI

on:
  push:
    branches: [dev, main]
  pull_request:
    branches: [dev, main]

jobs:
  check-and-unit:
    name: check + unit tests
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - name: Install dependencies
        run: npm ci
      - name: Build icon sprite
        run: npm run icons:build
      - name: Type + Svelte check
        run: npm run check
      - name: Unit tests
        run: npm run test:unit
```

Use the exact script names from the "Current state" excerpt — do not invent
`lint`/`build` steps (no lint script exists yet; that is Plan 012).

**Verify locally (proves the steps are valid before CI ever runs)**:

- `npm ci` → exit 0
- `npm run icons:build` → exit 0
- `npm run check` → exit 0
- `npm run test:unit` → all pass

If all four pass locally, the workflow's steps are correct.

### Step 2 (OPTIONAL — only if Plan 001 is already merged): document/add the heavier job

Do this ONLY if `grep -rn "RUN_INTEGRATION" tests/integration/` shows Plan 001
has landed. Otherwise SKIP this step and instead add the follow-up note below.

If Plan 001 is present, append a SECOND job that boots a seeded SQLite app and
runs integration tests. It must:

1. Write a CI `.env` (`DB_DIALECT=sqlite`, `DATABASE_URL=./data/ci.db`,
   `SEED_ADMIN_PASSWORD=${{ secrets.SEED_ADMIN_PASSWORD }}` — a repo secret,
   NOT a literal).
2. `npm run db:push` then `npm run db:seed`.
3. Start the app in the background (`npm run start &` after `npm run build`, or
   `npm run dev &`), wait for `:5173` to answer, then run
   `RUN_INTEGRATION=1 npm run test:integration`.

Because this requires a repo secret and a booted server, if ANY of those pieces
is unavailable, do NOT block Step 1 — ship the check+unit job and record the
integration job as a documented follow-up (see STOP conditions).

**Verify**: if added, the YAML still validates (optional validator command) and
`npm run check` is unaffected.

### Step 3: Record the deferred heavier suites

If Step 2 was skipped, add a top-of-file YAML comment in `ci.yml`:

```yaml
# Follow-up (deferred): integration + e2e jobs need a live seeded server on :5173.
# They depend on plans/001 (RUN_INTEGRATION gating) so a broken env FAILS instead
# of passing vacuously. Add a job that: writes a CI .env, `npm run db:push` +
# `db:seed`, boots the app, then `RUN_INTEGRATION=1 npm run test:integration`
# and `npm run test:e2e`. Requires a SEED_ADMIN_PASSWORD repo secret.
```

**Verify**: `grep -n "Follow-up (deferred)" .github/workflows/ci.yml` → 1 match.

## Test plan

No product code changes; verification is the local reproduction of each CI step
(Step 1) plus YAML well-formedness. There are no new automated tests to write.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `.github/workflows/ci.yml` exists.
- [ ] Its steps run `npm ci`, `npm run check`, and `npm run test:unit` — verify
      the script names match `package.json`:
      `grep -E "run check|run test:unit" .github/workflows/ci.yml` → 2 matches.
- [ ] All four Step-1 local commands (`npm ci`, `icons:build`, `check`,
      `test:unit`) exit 0 / pass locally.
- [ ] The workflow triggers on `pull_request` and `push` to `dev`/`main`
      (present in the `on:` block).
- [ ] Either the integration job is added (Plan 001 merged) OR the deferred
      follow-up comment is present.
- [ ] No files outside `.github/` are modified (`git status`).
- [ ] `plans/README.md` status row updated.

## STOP conditions

Stop and report back (do not improvise) if:

- `npm run check` fails locally on a clean checkout for reasons unrelated to
  this plan (pre-existing type errors) — report the errors; do not "fix" source
  to make CI pass here.
- `npm run test:unit` has pre-existing failures — report; the CI job should
  reflect reality, not be weakened to hide it.
- The integration job (Step 2) would require secrets/services you cannot
  confirm exist — ship Step 1 only and record the follow-up (Step 3).
- `package.json` script names differ from the "Current state" excerpt — the
  repo drifted; re-derive the exact names before writing the YAML.

## Maintenance notes

- When Plan 012 (lint/format) lands, add `npm run lint` and
  `npm run format:check` steps to the `check-and-unit` job.
- When Plan 001 lands (if not already), wire the integration job per Step 2/3.
- Keep `node-version: 22` in sync with the repo's runtime (the seed script
  relies on Node 22 running `.ts` directly).
- A reviewer should confirm the workflow does not print secrets and uses
  `secrets.*` references (never literals) for any credential.
