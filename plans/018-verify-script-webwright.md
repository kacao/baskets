# Plan 018: Add a one-command `verify` gate and untrack the webwright scratch files

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 3958dd6..HEAD -- package.json .gitignore` and
> `git ls-files tests/webwright/`
> If the tracked webwright file set differs from the excerpt below, reconcile
> before running `git rm --cached`.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: dx
- **Planned at**: commit `3958dd6`, 2026-07-12

## Why this matters

Two small DX papercuts. (a) There is no single fast health-check command:
`npm test` runs unit only, while `check`, `test:integration`, and `test:e2e` are
separate and the latter two need a manually-started seeded server — so a
contributor has no obvious "is my change sane?" gate. (b) `tests/webwright/`
tracks three scratch/tooling artifacts in git — `README.md`, `final_script.py`,
`plan.md` — that are not product code; their RUN outputs are already gitignored,
but these source scratch files leak into the repo and every diff. This plan adds
a `verify` script (the fast, CI-safe gate) and untracks the webwright scratch.

## Current state

- `package.json` scripts (no aggregate gate; `package.json:13-21`):

```json
"check": "svelte-kit sync && svelte-check --tsconfig ./tsconfig.json",
"test": "vitest run",
"test:unit": "vitest run tests/unit",
"test:integration": "vitest run --config vitest.integration.config.ts",
"test:e2e": "playwright test"
```

- Tracked webwright files (`git ls-files tests/webwright/`):

```
tests/webwright/README.md
tests/webwright/final_script.py
tests/webwright/plan.md
```

- `.gitignore` ALREADY ignores the webwright RUN artifacts (verbatim,
  `.gitignore:23-27`):

```
# webwright run artifacts (screenshots/logs, regenerated)
tests/webwright/final_runs/
tests/webwright/screenshots/
tests/webwright/outputs/
tests/webwright/final_script_log.txt
```

So `final_runs/`, `screenshots/`, `outputs/`, and the log are already ignored;
the three SOURCE scratch files (`README.md`, `final_script.py`, `plan.md`) are
NOT ignored and remain tracked.

- `tests/integration/**` and `tests/e2e/**` both require a live seeded server on
  `:5173` (integration via `vitest.integration.config.ts`; e2e via
  `playwright.config.ts`, which does NOT start a server) — so they must NOT be
  in a "runs anywhere" verify gate.

Repo convention: conventional commits; branch `dev` is default.

## Commands you will need

| Purpose           | Command                         | Expected on success          |
| ----------------- | ------------------------------- | ---------------------------- |
| Run the new gate  | `npm run verify`                | runs check THEN unit; exit 0 |
| Confirm untracked | `git ls-files tests/webwright/` | fewer / zero entries         |
| Typecheck alone   | `npm run check`                 | exit 0                       |
| Unit alone        | `npm run test:unit`             | all pass                     |

## Scope

**In scope** (modify):

- `package.json` — add a `verify` script.
- `.gitignore` — add the three webwright scratch source files (so they stay
  untracked after removal).
- Git index — `git rm --cached` the three tracked webwright scratch files (the
  files stay on disk; they are only removed from version control).
- (Optional) a short note in `README.md` documenting the server-dependent suites
  (integration/e2e) — only if a `README.md` exists at repo root; do NOT create
  one solely for this.

**Out of scope** (do NOT touch):

- The webwright files' CONTENTS — untrack, don't edit or delete from disk.
- `tests/integration/` and `tests/e2e/` — the verify gate deliberately excludes
  them (they need a live server).
- Any product source.

## Git workflow

- Branch: `advisor/018-verify-script-webwright`.
- Commit: `chore(dx): add verify script; untrack webwright scratch files`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add the `verify` script

Add to `package.json` `scripts` (place it near the other test scripts):

```json
"verify": "npm run check && npm run test:unit"
```

This is the fast, server-free gate (svelte-check + unit suite). It deliberately
does NOT include integration/e2e (those need a live seeded server).

**Verify**: `npm run verify` → runs `check`, then `test:unit`; exits 0 when both
pass. (If `check` or `test:unit` has a pre-existing failure, see STOP conditions
— report it; the gate correctly reflects reality.)

### Step 2: Untrack the webwright scratch files

Add these three lines to `.gitignore`, under the existing webwright block
(after `.gitignore:27`):

```
# webwright scratch (tooling artifacts, not product code)
tests/webwright/README.md
tests/webwright/final_script.py
tests/webwright/plan.md
```

Then remove them from the git index (keeping them on disk):

```
git rm --cached tests/webwright/README.md tests/webwright/final_script.py tests/webwright/plan.md
```

**Verify**:

- `git ls-files tests/webwright/` → returns NOTHING (all three untracked).
- `ls tests/webwright/` → the three files STILL EXIST on disk (only untracked).
- `git status` → shows the three as deletions-from-index + `.gitignore` modified,
  and the files do NOT reappear as untracked (because now gitignored).

### Step 3 (OPTIONAL): document the server-dependent suites

Only if a root `README.md` exists (`test -f README.md`). Add a short "Testing"
note listing: `npm run verify` (fast gate), and that `npm run test:integration`
/ `npm run test:e2e` require a running seeded dev server
(`npm run dev` + `npm run db:seed`, then set `RUN_INTEGRATION=1` for integration
once Plan 001 lands). If no `README.md` exists, SKIP this step (do not create
one just for this — AGENTS.md discourages new doc files).

**Verify**: if done, `grep -n "npm run verify" README.md` → 1 match.

## Test plan

No product code changes; no new automated tests. Verification is the command
table above: `npm run verify` succeeds, and the webwright scratch is untracked
while remaining on disk.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `npm run verify` exists and runs `check` then `test:unit` (exit 0 when
      both pass).
- [ ] `git ls-files tests/webwright/` returns fewer entries than before (target:
      zero).
- [ ] The three webwright files still exist on disk (`ls tests/webwright/`).
- [ ] `.gitignore` now ignores the three scratch files (they don't show as
      untracked in `git status`).
- [ ] Only `package.json` and `.gitignore` are modified in the working tree
      (plus the index removals); no product source touched (`git status`).
- [ ] `plans/README.md` status row updated.

## STOP conditions

Stop and report back (do not improvise) if:

- `npm run check` or `npm run test:unit` fails for pre-existing reasons —
  report the failure; do NOT weaken the `verify` script to hide it.
- The tracked webwright file set differs from the excerpt (drift) — `git rm
--cached` only the files that are actually tracked; report the difference.
- `git rm --cached` would remove a file another change depends on (unexpected) —
  STOP.

## Maintenance notes

- Once Plan 001 (RUN_INTEGRATION gating) and Plan 004 (CI) land, consider a
  `verify:full` that also boots a seeded server and runs integration/e2e — but
  keep `verify` as the fast, no-server gate.
- If webwright tooling is later formalized, move it under a gitignored or
  `.agents/`-style path rather than re-tracking scratch files.
- A reviewer should confirm the untrack did not delete the files from disk and
  that `.gitignore` prevents their re-adding.
