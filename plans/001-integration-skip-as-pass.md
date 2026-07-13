# Plan 001: Make the integration suite fail loudly instead of passing while asserting nothing

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 3958dd6..HEAD -- tests/integration/`
> If any file under `tests/integration/` changed since this plan was written,
> compare the "Current state" excerpts against the live code before proceeding;
> on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `3958dd6`, 2026-07-12

## Why this matters

The 6-file, 83-test integration suite is the ONLY automated coverage of the
server service layer and the ADR-019 authorization rules. Today, when the dev
server or seeded DB is absent — exactly the state a CI runner starts in — every
test returns before reaching a single `expect(...)`, and **a vitest test that
returns before asserting counts as PASSED**. So `npm run test:integration`
reports green while verifying nothing. This makes the suite worse than useless
in CI: it gives false confidence. The fix is to make "not run" an explicit,
flag-gated state (genuinely SKIPPED, not vacuously passed), and to make a
flag-on-but-broken environment FAIL loudly.

## Current state

Six files under `tests/integration/` all guard against a missing server, but in
two structural families:

**Family A — `skipReason` + `ensureAuth()`** (4 files):
`task-mutations.test.ts`, `api-projects-tasks.test.ts`, `export-injection.test.ts`,
`templates-scope.test.ts`. They share this exact shape (from
`tests/integration/task-mutations.test.ts`):

```ts
// tests/integration/task-mutations.test.ts:28-30
let cookie = '';
let skipReason = '';
const createdProjectIds = new Set<string>();
```

```ts
// tests/integration/task-mutations.test.ts:49-61 (beforeAll — the skip paths RETURN)
beforeAll(async () => {
	// 1) Is the server up at all?
	let reachable = false;
	try {
		const ping = await fetch(`${BASE}/api/me`);
		reachable = ping.status !== undefined;
	} catch {
		reachable = false;
	}
	if (!reachable) {
		skipReason = `dev server not reachable at ${BASE} — start it with \`npm run dev\``;
		return;
	}
	// ... more `skipReason = ...; return;` paths at lines 73, 77, 83 ...
```

```ts
// tests/integration/task-mutations.test.ts:109-117 + per-test guard
function ensureAuth() {
	if (!cookie) {
		console.warn(`[task-mutations] SKIPPED: ${skipReason}`);
		return false;
	}
	return true;
}
// ...and every test starts with:  if (!ensureAuth()) return;   (lines 131, 149)
```

The `describe(...)` wrapper for this family looks like:
`describe('REST API task mutations (regression)', () => {` (task-mutations.ts:129)
and `describe('REST API: /api/projects + /api/tasks (integration)', () => {`
(api-projects-tasks.ts:127).

**Family B — `serverUp` + cookie booleans** (2 files):
`api-authz.test.ts`, `api-security.test.ts`. They use `serverUp` +
`adminCookie`/`demoCookie`/`sessionCookie` and guard each test inline:

```ts
// tests/integration/api-authz.test.ts:99-104 (beforeAll — skip paths RETURN)
beforeAll(async () => {
	serverUp = await ping();
	if (!serverUp) return;
	adminCookie = await signIn(ADMIN_EMAIL, ADMIN_PASSWORD);
	demoCookie = await signIn(DEMO_EMAIL, DEMO_PASSWORD);
	if (!adminCookie) return;
	// ...
```

```ts
// per-test guards, e.g. api-authz.test.ts:184,196,207 ...
if (!serverUp || !adminCookie) return;
```

`api-authz.test.ts` also reads env-overridable creds (lines 22-26):
`const ADMIN_EMAIL = process.env.TEST_ADMIN_EMAIL ?? 'admin@baskets.local'` etc.
`api-security.test.ts` uses `serverUp` + `sessionCookie` (lines 30-32) with a
top-level `describe(...)` and inline `if (!serverUp ...) return;` guards.

Common facts:

- Every file reads `BASE` from `process.env.TEST_BASE_URL` with a
  `'http://localhost:5173'` default, so **presence of `TEST_BASE_URL` cannot be
  used as the run flag** (it has a default). Introduce a dedicated
  `RUN_INTEGRATION` flag instead.
- vitest is configured for these via `vitest.integration.config.ts`
  (`include: ['tests/integration/**/*.{test,spec}.ts']`, node env). `globals: true`
  is set, so `describe`/`it`/`beforeAll` are available and `describe.skipIf` exists.

Repo convention: tabs for indentation, single quotes (see any file above).

## Commands you will need

| Purpose                             | Command                                      | Expected on success                             |
| ----------------------------------- | -------------------------------------------- | ----------------------------------------------- |
| Typecheck                           | `npm run check`                              | exit 0, no errors                               |
| Integration (no server, flag unset) | `npm run test:integration`                   | exits 0; tests reported **skipped**, not passed |
| Integration (flag on, no server)    | `RUN_INTEGRATION=1 npm run test:integration` | **non-zero exit** (suite FAILS)                 |
| Unit (unaffected)                   | `npm run test:unit`                          | all pass                                        |

## Scope

**In scope** (modify only these):

- `tests/integration/task-mutations.test.ts`
- `tests/integration/api-projects-tasks.test.ts`
- `tests/integration/export-injection.test.ts`
- `tests/integration/templates-scope.test.ts`
- `tests/integration/api-authz.test.ts`
- `tests/integration/api-security.test.ts`

**Out of scope** (do NOT touch):

- `vitest.integration.config.ts` — the include/env is correct; no change needed.
- Any `src/` file — this plan changes test harness behavior only.
- The actual test assertions/bodies — do not weaken or rewrite what they check.

## Git workflow

- Branch: `advisor/001-integration-skip-as-pass` (repo default branch is `dev`).
- Commit style: conventional commits, e.g.
  `test(integration): gate suite on RUN_INTEGRATION and fail loudly when env is broken`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add the run flag + fail-loud logic to every file's `beforeAll`

For EACH of the 6 files, do two edits.

**(a)** Near the top of the file (right after the `BASE`/creds constants, before
`beforeAll`), add:

```ts
// Explicit opt-in: integration tests need a live, seeded dev server. When
// RUN_INTEGRATION is unset the whole suite is SKIPPED (see describe.skipIf
// below). When it IS set, a broken/unseeded env must FAIL loudly, not skip.
const RUN_INTEGRATION = !!process.env.RUN_INTEGRATION;
```

**(b)** In `beforeAll`, replace each skip-path `return;` so that a broken env
throws when the flag is on. For **Family A** files
(`task-mutations`, `api-projects-tasks`, `export-injection`, `templates-scope`),
each skip path currently reads:

```ts
skipReason = `...message...`;
return;
```

Change each to:

```ts
skipReason = `...message...`;
if (RUN_INTEGRATION) throw new Error(skipReason);
return;
```

(Leave the `skipReason = ...` message text exactly as-is; only insert the
`if (RUN_INTEGRATION) throw ...` line before each `return;` inside `beforeAll`.
Do NOT alter the `afterAll` `if (!cookie) return;` line or the `ensureAuth()`
`return false;`.)

For **Family B** files (`api-authz`, `api-security`), the `beforeAll` skip paths
have no `skipReason`. Change:

```ts
serverUp = await ping();
if (!serverUp) return;
```

to

```ts
serverUp = await ping();
if (!serverUp) {
	if (RUN_INTEGRATION) throw new Error(`dev server not reachable at ${BASE}`);
	return;
}
```

and change (api-authz):

```ts
if (!adminCookie) return;
```

to

```ts
if (!adminCookie) {
	if (RUN_INTEGRATION)
		throw new Error('admin sign-in failed — is the DB seeded (npm run db:seed)?');
	return;
}
```

Apply the analogous change to `api-security.test.ts`'s post-sign-in guard (the
one that leaves `sessionCookie` empty): wrap its `return` with the same
`if (RUN_INTEGRATION) throw new Error('admin sign-in failed — is the DB seeded?')`.

**Verify**: `npm run check` → exit 0, no errors.

### Step 2: Make "flag unset" a genuine SKIP (not a vacuous pass)

In EACH of the 6 files, find the top-level `describe(` call (there is at least
one per file; `api-projects-tasks`, `api-authz`, `api-security` may have nested
`describe`s — change only the OUTERMOST `describe(` in each file) and change:

```ts
describe('<title unchanged>', () => {
```

to

```ts
describe.skipIf(!RUN_INTEGRATION)('<title unchanged>', () => {
```

This makes vitest report the tests as **skipped** (not passed) when the flag is
unset, which is the correct signal. The existing per-test `if (!ensureAuth())
return;` / `if (!serverUp ...) return;` guards stay as harmless belt-and-braces.

**Verify (no server running, flag unset)**: `npm run test:integration`
→ exit 0, and the summary shows the integration tests as **skipped**
(e.g. `Tests  N skipped`), NOT `N passed`.

### Step 3: Confirm the flag-on path fails loudly

With NO dev server running (or an unseeded one), run:

`RUN_INTEGRATION=1 npm run test:integration`

**Verify**: the command exits **non-zero** and the failure message is the
thrown reason (server unreachable / not seeded) — the suite FAILS instead of
silently passing.

## Test plan

This plan hardens the harness rather than adding assertions. Verification is
purely the three run-mode behaviors:

1. flag unset, no server → all integration tests SKIPPED, exit 0.
2. flag set, no server → suite FAILS (non-zero exit) with a clear message.
3. flag set, live seeded server (optional, only if one is available) →
   tests actually run and their existing `expect(...)` assertions execute.
   To sanity-check locally if you have a server: `npm run dev` in one shell,
   `npm run db:seed` once, then `RUN_INTEGRATION=1 npm run test:integration`
   → tests pass with real assertions.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `npm run check` exits 0.
- [ ] `npm run test:integration` (no server, flag unset) exits 0 and reports the
      integration tests as **skipped**, not passed.
- [ ] `RUN_INTEGRATION=1 npm run test:integration` (no server) exits non-zero.
- [ ] `grep -rn "RUN_INTEGRATION" tests/integration/ | grep -c "describe.skipIf"`
      returns `6` (one guarded outer describe per file).
- [ ] No files outside the in-scope list are modified (`git status`).
- [ ] `plans/README.md` status row updated.

## STOP conditions

Stop and report back (do not improvise) if:

- The `beforeAll`/`describe`/`ensureAuth` shapes in any file don't match the
  "Current state" excerpts (the tests drifted since this plan was written).
- After the changes, `RUN_INTEGRATION=1 npm run test:integration` still exits 0
  with no server — the throw isn't taking effect; report rather than patch
  around it.
- A file has NO top-level `describe(` to guard (unexpected structure).
- `describe.skipIf` is not a function at runtime (vitest version mismatch) —
  report; do not substitute a different skip mechanism.

## Maintenance notes

- Plan 004 (CI pipeline) depends on this: its integration job must set
  `RUN_INTEGRATION=1` (plus a live seeded server) so a broken env fails the
  build instead of passing vacuously. Without this plan, the CI integration job
  would be green-but-empty.
- Any NEW integration file must copy this pattern: `const RUN_INTEGRATION =
!!process.env.RUN_INTEGRATION;`, `describe.skipIf(!RUN_INTEGRATION)(...)`, and
  a throwing `beforeAll` when the flag is on but setup fails.
- A reviewer should confirm no assertion bodies were weakened — only the
  skip/throw plumbing changed.
