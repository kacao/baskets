# Plan 014: Characterization unit tests for the server service layer against an isolated SQLite DB

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 3958dd6..HEAD -- src/lib/server/permissions.ts src/lib/server/tasks.ts src/lib/server/db/`
> These are high-churn files (the plan author noted uncommitted edits in
> `tasks.ts` at planning time). Re-read the excerpts below and reconcile before
> writing tests; on a signature mismatch, treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: L
- **Risk**: LOW–MED
- **Depends on**: none (but ENABLES safer refactors of tasks.ts / permissions.ts)
- **Category**: tests
- **Planned at**: commit `3958dd6`, 2026-07-12

## Why this matters

`tests/unit/` imports ONLY pure client modules — `grep -rl "lib/server"
tests/unit/` returns nothing. So the entire server service layer
(`tasks.ts` ~866 lines, `permissions.ts` 187 lines, `statuses.ts`,
`milestones.ts`, `labels.ts`, `views.ts`, `customFields.ts`, `comments.ts`) has
NO direct unit coverage. Its only automated check is the live-server integration
suite, which (per Plan 001) skips-as-passes without a running server. The
access-control matrix in `permissions.ts` and the mutation invariants in
`tasks.ts` (status cascade to sub-tasks, sub-task rules, bulk edits) are exactly
the logic where a silent regression is most dangerous. This plan stands up an
isolated per-run SQLite database and writes **characterization tests** (assert
CURRENT behavior) so future refactors have a fast, hermetic safety net. It is a
foundation plan: get the harness working, then cover the two highest-value
modules.

## Current state

### The crux: `db` is a module-level singleton built from env

`src/lib/server/db/index.ts` (verbatim, lines 18-39):

```ts
function createDb(): DB {
	if (DIALECT === 'postgres') {
		if (!env.DATABASE_URL) {
			throw new Error('DATABASE_URL (postgres:// connection string) is required when DB_DIALECT=postgres');
		}
		const client = postgres(env.DATABASE_URL, { max: 10 });
		return drizzlePg(client, { schema: pgSchema }) as unknown as DB;
	}
	const sqlite = new Database(env.DATABASE_URL ?? './data/baskets.db');
	// ...pragmas...
	return drizzleSqlite(sqlite, { schema: sqliteSchema });
}
export const db = createDb();
```

- `env` here is `$env/dynamic/private` (SvelteKit). Under vitest the SvelteKit
  plugin is loaded (`vitest.config.ts` uses `sveltekit()`), and
  `$env/dynamic/private` resolves from `process.env`. So **setting
  `process.env.DATABASE_URL` before the module is imported points `db` at a test
  DB** — no code change to `index.ts` needed.
- `DIALECT` comes from `src/lib/server/db/dialect.ts` reading
  `process.env.DB_DIALECT` (default `'sqlite'`). Leave it default → SQLite.
- Schema lives in `src/lib/server/db/schema.sqlite.ts` (canonical; e.g.
  `export const user = sqliteTable('user', {...})`, `session`, `account`, ...,
  plus app tables). `drizzle.config.ts` targets it for `npm run db:push`.
- The singleton is created **at import time** (`export const db = createDb()`),
  so the env var MUST be set before ANY `import ... from '$lib/server/...'`
  runs. In vitest, do this in a setup file (or at the very top of the test file
  BEFORE the service imports) — a per-file temp SQLite path via
  `process.env.DATABASE_URL`.

### The behavior to characterize

`permissions.ts` exports (permissions.ts:7,31,41,56,70,84,93,98,112,120,148,180):
`isAdmin`, `canEditWorkspace`, `canEditProject`, `canEditView`,
`accessibleWorkspaceIds`, `grantedProjectIds`, `canAccessWorkspace`,
`canAccessProject`, `canEditTask`, `listProjectGrants`, `projectAccessUserIds`,
`listWorkspaceGrants`. Key shape to pin down (permissions.ts:98-105):

```ts
export async function canAccessProject(user: SessionUser, projectId: string) {
	if (!user) return false;
	if (isAdmin(user)) return true;
	const [p] = await db.select().from(project).where(eq(project.id, projectId));
	if (!p) return false;
	if (p.workspaceId && (await canAccessWorkspace(user, p.workspaceId))) return true;
	return hasGrant(user.id, [{ type: 'project', id: projectId }]);
}
```

and (permissions.ts:112-119):

```ts
export async function canEditTask(user, t: { id; parentId; projectId }) {
	return canAccessProject(user, t.projectId); // editing == access (ADR-019)
}
```

`tasks.ts` (~866 lines) holds the service functions used by form actions AND
REST (per AGENTS.md: `createTask`, `patchTask`, `moveTask`, `bulkPatchTasks`,
etc.). Invariants to characterize (from AGENTS.md domain rules — verify against
the actual exports by reading the file):
- Sub-tasks are one level only: `parentId` set ⇒ no children; enforced in
  `createTask` AND `patchTask`'s re-parent branch.
- Moving/patching a parent to a `done`-category status cascades that status onto
  its direct sub-tasks (this is the exact behavior the integration test
  `task-mutations.test.ts` covers — mirror it as a unit test).
- Bulk edit (`bulkPatchTasks`) applies a field set across a selection.

Read `src/lib/server/tasks.ts` to get the EXACT exported function names and
signatures before writing — do not assume.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Apply schema to a test DB | `DB_DIALECT=sqlite DATABASE_URL=<path> npm run db:push` | "Changes applied" |
| Run the new unit tests | `npm run test:unit` | all pass, including new files |
| Run one file | `npx vitest run tests/unit/server-permissions.test.ts` | pass |
| Typecheck | `npm run check` | exit 0 |

## Scope

**In scope** (create):
- `tests/unit/helpers/testDb.ts` — the test-DB harness (create + migrate + seed
  helpers).
- `tests/unit/server-permissions.test.ts` — characterization tests for the
  access matrix.
- `tests/unit/server-tasks.test.ts` — characterization tests for task mutation
  invariants.

**Out of scope** (do NOT modify):
- `src/lib/server/db/index.ts` — do NOT add a test hook; the env-var approach
  needs no source change. If you believe it does, STOP and report.
- Any service module under `src/lib/server/` — characterization means observe,
  not change. If a test reveals a bug, RECORD it; do not fix it here.
- The integration suite — separate concern (Plan 001).

## Git workflow

- Branch: `advisor/014-service-layer-unit-tests`.
- Commit: `test(server): characterization tests for permissions + task mutations`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Build the isolated-DB harness

Create `tests/unit/helpers/testDb.ts`. Strategy (env-var isolation, no source
change):

1. Generate a unique temp file path per test run, e.g.
   `path.join(os.tmpdir(), \`baskets-test-${crypto.randomUUID()}.db\`)`.
   (Prefer a temp FILE over `:memory:` — `npm run db:push` and the app open
   separate connections, and file-backed SQLite is the closest match to prod.)
2. Set `process.env.DB_DIALECT = 'sqlite'` and
   `process.env.DATABASE_URL = <that path>` **before importing anything from
   `$lib/server`**.
3. Apply the schema by shelling out to drizzle-kit push against that path:
   run `npm run db:push` with the env vars set (via `execSync` with the env
   passed through), OR — if that proves flaky under vitest — import
   `schema.sqlite.ts` and create tables with `drizzle-orm`'s `better-sqlite3`
   migrator. **Recommended: `execSync('npm run db:push', { env: {...process.env,
   DB_DIALECT:'sqlite', DATABASE_URL: p }, stdio: 'pipe' })`** in a global setup,
   once, since the schema is static.
4. Export helpers to insert fixture rows (a user, an admin user, a workspace, a
   project, statuses) so each test arranges its own world. Reuse the table
   objects from `$lib/server/db/schema.sqlite` and the same `db` singleton the
   services use (import `db` from `$lib/server/db` AFTER the env is set).
5. Provide a `resetTables()` (delete rows in FK-safe order) called in
   `beforeEach` so tests are independent, OR create a fresh temp DB per file.

Because the `db` singleton is import-time, the cleanest arrangement is a vitest
**global setup / setup file** that sets the env vars and runs `db:push` ONCE,
before any test module imports `$lib/server`. Wire it via a dedicated config or
`setupFiles`. Note: `vitest.config.ts` already has
`setupFiles: ['./tests/setup.ts']` (which imports jest-dom). Do NOT remove that;
if you add DB setup, either append to a new setup file listed alongside it or use
`globalSetup` (which runs in a separate context — env set there won't reach test
workers, so prefer a `setupFiles` entry that runs in-worker and sets
`process.env` before the service import).

**Verify**: a throwaway smoke test that imports `db` from `$lib/server/db`,
inserts a `user` row, and selects it back:
`npx vitest run tests/unit/helpers/` (or a temporary `smoke.test.ts`) → passes,
and the temp DB file exists. Remove the smoke test once green.

### Step 2: Characterize `permissions.ts`

Create `tests/unit/server-permissions.test.ts`. Arrange fixtures and assert the
CURRENT behavior of the access matrix. Cover at minimum:
- `isAdmin` true for `role === 'admin'`, false otherwise, false for null user.
- `canAccessProject`: admin → true; owner of the project's workspace → true;
  a user with a direct `permission` grant on the project → true; an unrelated
  user → false; a missing project id → false. (Mirror the code path in the
  excerpt above.)
- `canEditTask` returns the same as `canAccessProject(user, task.projectId)`
  (ADR-019 equivalence) — assert edit == access.
- `canEditProject` / `canEditWorkspace`: admin/owner/grant → true; unrelated
  member with only ACCESS (not edit) → false.

Use Arrange-Act-Assert, one concept per test, sentence-style names
("returns 404-equivalent false for a project the user cannot reach").

**Verify**: `npx vitest run tests/unit/server-permissions.test.ts` → all pass.

### Step 3: Characterize `tasks.ts` mutation invariants

Create `tests/unit/server-tasks.test.ts`. First READ `src/lib/server/tasks.ts`
to confirm exact exported names/signatures (the AGENTS.md summary is a guide,
not a contract). Cover:
- **Status cascade**: create a parent + one sub-task, move the parent to a
  `completed`-category status, assert the sub-task's `statusId` now equals the
  parent's (the exact behavior in `tests/integration/task-mutations.test.ts`).
- **One-level nesting**: creating a task with a `parentId` that is itself a
  sub-task is rejected (or normalized) — assert whatever the code currently does.
- **Bulk edit**: `bulkPatchTasks` (or the actual name) applies a field to every
  task in the selection.
- (If present) sub-task milestone inheritance — the plan author flagged "new
  sub-task milestone inheritance" as recently added; characterize its current
  behavior only if the function exists.

If a service function requires a `SessionUser` and permission checks, seed an
admin user fixture and pass it so the guards pass.

**Verify**: `npx vitest run tests/unit/server-tasks.test.ts` → all pass;
`npm run test:unit` → the full unit suite still green.

## Test plan

- New files: `tests/unit/server-permissions.test.ts`,
  `tests/unit/server-tasks.test.ts`, backed by `tests/unit/helpers/testDb.ts`.
- Model the vitest structure after an existing unit spec (e.g.
  `tests/unit/statuses.test.ts`) for import/describe/it conventions.
- Characterization discipline: if current behavior looks buggy, still assert
  what it does today and NOTE the suspected bug in your report — do not "fix" it,
  or the safety net encodes an assumption instead of reality.
- Verification: `npm run test:unit` → all pass, including the new files.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `grep -rl "lib/server" tests/unit/` returns at least the two new files
      (server code is now unit-tested).
- [ ] `npm run test:unit` exits 0 with the new tests included.
- [ ] `npm run check` exits 0.
- [ ] `src/lib/server/db/index.ts` is unchanged (`git status` — no source hook
      added).
- [ ] The test DB is a temp/isolated path, NOT `./data/baskets.db` (grep the
      harness for `tmpdir`/a unique path; it must never touch the dev DB).
- [ ] `plans/README.md` status row updated.

## STOP conditions

Stop and report back (do not improvise) if:

- The env-var approach does NOT redirect `db` to the temp DB (e.g. the smoke
  test writes to `./data/baskets.db`) — the singleton is being constructed
  before the env is set; report the import-order problem rather than modifying
  `index.ts`.
- `npm run db:push` against the temp path fails or hangs under vitest — report;
  do not silently fall back to an untested migration path.
- `permissions.ts` or `tasks.ts` signatures differ materially from the excerpts
  (drift) — re-read and reconcile; if the difference is large, STOP.
- A test only passes by modifying a `src/lib/server/**` file — that violates the
  characterization mandate; STOP and report the coupling.

## Maintenance notes

- This harness is the enabler for any future refactor of `tasks.ts` /
  `permissions.ts` (the plan author flagged those as refactor candidates) — run
  these tests before and after such a change; a diff in assertions is a
  behavior change to review deliberately.
- Extend coverage to `statuses.ts`/`milestones.ts`/`labels.ts`/`views.ts` in
  follow-ups using the same harness.
- A reviewer should scrutinize the DB-isolation wiring (temp path, reset
  between tests) most — a leak into `./data/baskets.db` would corrupt local dev.
