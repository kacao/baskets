# Plan 011: Wrap multi-write service operations in a dialect-safe transaction

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 3958dd6..HEAD -- src/lib/server/db/index.ts src/lib/server/tasks.ts src/lib/server/customFields.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.
>
> **IMPORTANT — uncommitted edits at planning time**: `src/lib/server/tasks.ts`
> had UNCOMMITTED working-tree edits when this plan was written (a milestone-
> inheritance feature) affecting `createTaskService` and the `updateTaskService`
> re-parent branch. The lines this plan touches (`updateTaskService`'s CF-write +
> task-update + completeCascade block) are NOT touched by those edits, but line
> numbers may be shifted. Match excerpts by code content, not line number.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `3958dd6`, 2026-07-12

## Why this matters

No service operation uses a DB transaction (`grep -rn "db.transaction" src/lib/server/`
returns nothing). Several ops perform multiple dependent writes as separate
statements, so a failure between them leaves partial, inconsistent state.
`updateTaskService` is the clearest case — it even has a comment admitting the
gap: it writes custom-field values, THEN updates the task row, THEN (on a
completing status change) cascades to sub-tasks and inserts a recurrence
occurrence, all un-atomically. If the process dies or a write throws mid-sequence,
the task can end up updated-but-not-cascaded, or CF-written-but-task-unchanged.
This plan introduces one dialect-safe `withTransaction` primitive and wraps the
highest-value op (`updateTaskService`) in it, keeping fire-and-forget side effects
outside. It deliberately scopes to that one op; the remaining ops are listed as
explicit follow-ons.

## Current state

### The two drivers have INCOMPATIBLE transaction signatures (verified)

The multi-dialect `db` (ADR-050) is one of two drizzle drivers depending on
`DB_DIALECT`. Their `transaction` types DIFFER:

- **better-sqlite3** (`node_modules/drizzle-orm/better-sqlite3/session.d.ts`):
  `transaction<T>(fn: (tx) => T, config?): T` — the callback is **synchronous**
  and returns `T` directly (NOT a Promise). better-sqlite3 forbids an async
  callback: awaiting inside would let the callback return a pending Promise, and
  the transaction would commit before the async work runs. So a sqlite
  transaction callback MUST be synchronous.
- **postgres-js / pg-core** (`node_modules/drizzle-orm/pg-core/db.d.ts`):
  `transaction<T>(fn: (tx) => Promise<T>, config?): Promise<T>` — the callback is
  **async** and awaited; queries must go through the `tx` handle to be captured.

Because the existing service layer is written with `await db.insert(...)` (async
style), a single `db.transaction(fn)` cannot serve both drivers. The dialect is
selected by `src/lib/server/db/dialect.ts`:

```ts
export const DIALECT: Dialect = resolveDialect(process.env.DB_DIALECT); // 'sqlite' (default) | 'postgres'
```

sqlite is the default and the only actively-used dialect; postgres is
"structure-ready / deferred" (ADR-050). The app is single-tenant and
single-user-oriented.

### `src/lib/server/db/index.ts` today (where the primitive goes)

```ts
type DB = BetterSQLite3Database<typeof sqliteSchema>;

function createDb(): DB {
	if (DIALECT === 'postgres') {
		// ...postgres-js instance cast to DB...
		return drizzlePg(client, { schema: pgSchema }) as unknown as DB;
	}
	const sqlite = new Database(env.DATABASE_URL ?? './data/baskets.db');
	// ...pragmas...
	sqlite.pragma('foreign_keys = ON');
	return drizzleSqlite(sqlite, { schema: sqliteSchema });
}

export const db = createDb();
```

There is currently NO `sql` import and NO `db.run(...)` usage anywhere in
`src/lib/server/` (`grep -rn "db.run(\|sql\`" src/lib/server/` → nothing) — the
manual-BEGIN path this plan adds is new to the codebase.

### The op to fix — `updateTaskService` (`src/lib/server/tasks.ts`), the un-atomic tail

```ts
	const cf = input.cf ?? [];
	if (Object.keys(set).length === 0 && cf.length === 0) return err(400, 'No fields to update');

	// Write custom values FIRST so a CF validation error doesn't leave the task
	// row partially updated with no rollback (no surrounding transaction).
	if (cf.length > 0) {
		const res = await writeTaskCustomValues(taskId, projectId, cf);
		if (res.error) return err(400, res.error);
	}

	const [updated] = await db
		.update(task)
		.set({ ...set, updatedAt: new Date() })
		.where(eq(task.id, taskId))
		.returning();

	// Completing a parent completes its sub-tasks + recurrence spawn (REST PATCH).
	if (opts.completeCascade) {
		const wasDone = eligible.find((s) => s.id === existing.statusId)?.category === 'completed';
		if (targetStatus?.category === 'completed' && !wasDone) {
			// ...recurrence insert + sub-task cascade update + (void) dispatchEvent...
		}
	}

	// ...logActivity (void), notifyMentions (void), notifyAssignee (void)...
	broadcastProjectChange(projectId, actor.id);
	return ok(updated);
```

The DB writes to make atomic: the CF write, the task `update`, and (inside
`completeCascade`) the recurrence `insert` + the sub-task cascade `update`. The
`void`-ed side effects (`logActivity`, `notifyMentions`, `createNotification`,
`dispatchEvent`, `broadcastProjectChange`) are fire-and-forget and MUST stay
OUTSIDE the transaction.

### `writeTaskCustomValues` (`src/lib/server/customFields.ts`) uses the module-global `db`

```ts
export async function writeTaskCustomValues(
	taskId: string,
	projectId: string,
	entries: { fieldId: string; raw: string | null }[]
): Promise<{ error?: string }> {
	// ...validation... then:
	for (const fieldId of clears)
		await db.delete(taskCustomValue).where(and(eq(taskCustomValue.taskId, taskId), eq(taskCustomValue.fieldId, fieldId)));
	for (const w of writes)
		await db
			.insert(taskCustomValue)
			.values({ taskId, fieldId: w.fieldId, value: w.value })
			.onConflictDoUpdate({ target: [taskCustomValue.taskId, taskCustomValue.fieldId], set: { value: w.value } });
	return {};
}
```

To include CF writes in the same transaction as the task update, this function
must run its writes against the transaction handle, not the global `db`.

## Commands you will need

| Purpose        | Command                     | Expected on success                    |
|----------------|-----------------------------|----------------------------------------|
| Typecheck      | `npm run check`             | exit 0, 0 errors, 0 warnings           |
| Unit tests     | `npm run test:unit`         | all pass (baseline: 416 tests)         |
| Integration    | `npm run test:integration`  | all pass (needs live server + seeded DB)|
| Start dev srv  | `npm run dev`               | serves on `http://localhost:5173`      |
| Seed DB        | `npm run db:seed`           | seeds admin/demo + sample data         |

## Scope

**In scope** (the only files you should modify):
- `src/lib/server/db/index.ts` (add `withTransaction`)
- `src/lib/server/customFields.ts` (accept an optional executor in `writeTaskCustomValues`)
- `src/lib/server/tasks.ts` (`updateTaskService` only)
- `ADR.md` (append one ADR record for the transaction decision)

**Out of scope** (do NOT touch — listed as explicit follow-ons, see Maintenance):
- `bulkUpdateTasks`, `moveTaskService`'s position-renumber loop,
  `setTaskStatusService`'s recurrence spawn, `createTaskService`'s compensating
  delete — DO NOT wrap these in this plan. One op at a time; prove the primitive
  first.
- `writeProjectCustomValues` — leave on the global `db`; not touched by this plan.
- Any schema file — no schema change.
- The side effects (`broadcastProjectChange`, `dispatchEvent`, `notifyMentions`,
  `logActivity`, `createNotification`) — they stay OUTSIDE the transaction.

## Git workflow

- Work on branch `dev` (already the current branch).
- Commit style: conventional commits, e.g.
  `refactor(tasks): make updateTaskService atomic via withTransaction`.
- Do NOT push or open a PR unless the operator instructs it.

## Steps

### Step 1: Add the dialect-safe `withTransaction` primitive

In `src/lib/server/db/index.ts`, after `export const db = createDb();`, add:

```ts
import { sql } from 'drizzle-orm';

/**
 * Run `fn` inside a single DB transaction, dialect-safely (ADR-050 / ADR-0NN).
 *
 * - postgres: uses the driver's native async transaction (a connection is
 *   reserved for the duration); `fn` MUST route its writes through the passed
 *   `tx` handle.
 * - sqlite (better-sqlite3): better-sqlite3's native transaction requires a
 *   SYNCHRONOUS callback, which is incompatible with the async service layer, so
 *   we drive a manual `BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK` on the single
 *   connection and pass the same `db` as `tx`. Correct for this single-tenant,
 *   low-concurrency app; see the ADR for the isolation caveat under heavy
 *   concurrent writes.
 *
 * Side effects (broadcast/dispatch/notify) must be performed by the CALLER after
 * this resolves — never inside `fn`.
 */
export async function withTransaction<T>(fn: (tx: DB) => Promise<T>): Promise<T> {
	if (DIALECT === 'postgres') {
		return (db as unknown as {
			transaction: (f: (tx: DB) => Promise<T>) => Promise<T>;
		}).transaction((tx) => fn(tx));
	}
	await db.run(sql`BEGIN IMMEDIATE`);
	try {
		const result = await fn(db);
		await db.run(sql`COMMIT`);
		return result;
	} catch (e) {
		try {
			await db.run(sql`ROLLBACK`);
		} catch {
			/* already rolled back / closed */
		}
		throw e;
	}
}
```

`DIALECT` is already imported in `index.ts`. `DB` is already defined there.

**Verify**: `npm run check` → exit 0, 0 errors / 0 warnings. If `db.run` is not a
method on the `DB` type (it should be — drizzle sqlite exposes `.run`), that is a
STOP condition (see below).

### Step 2: Let `writeTaskCustomValues` run on a transaction handle

In `src/lib/server/customFields.ts`, add an optional executor parameter that
defaults to the global `db`, and use it for the reads/writes inside. Also update
the private `encodeAndValidate` calls to use it if they perform DB lookups (they
do — select queries). Minimal change: add `exec: DB = db` as the LAST parameter
and replace `db.` with `exec.` inside the function body (and pass `exec` down to
`encodeAndValidate`).

Target signature:

```ts
import type { DB } from './db'; // if DB isn't exported, export it from db/index.ts (see note)

export async function writeTaskCustomValues(
	taskId: string,
	projectId: string,
	entries: { fieldId: string; raw: string | null }[],
	exec: DB = db
): Promise<{ error?: string }> {
	// ...use `exec` in place of `db` for every query in this function...
}
```

NOTE: `DB` is currently a local type in `db/index.ts` (`type DB = ...`), not
exported. Export it: change `type DB = ...` to `export type DB = ...` in
`db/index.ts` (in-scope file). Then import it here.

`encodeAndValidate(field, raw, projectId)` also runs selects — thread the same
`exec` into it (add `exec: DB` param, replace its `db.` with `exec.`). Callers
in this file (`writeTaskCustomValues` and `writeProjectCustomValues`) pass their
executor; `writeProjectCustomValues` passes the default `db` (unchanged behavior).

**Verify**: `npm run check` → exit 0. `npm run test:unit` → all pass. (Behavior
is unchanged when `exec` defaults to `db` — this step is preparatory.)

### Step 3: Make `updateTaskService`'s writes atomic

In `src/lib/server/tasks.ts`, import `withTransaction` from `$lib/server/db`
(alongside the existing `db` import). Wrap the CF write + task update +
completeCascade DB writes in ONE `withTransaction` call, returning the updated
task row. Keep ALL `void`-ed side effects and `broadcastProjectChange` AFTER the
transaction. Target shape:

```ts
	const cf = input.cf ?? [];
	if (Object.keys(set).length === 0 && cf.length === 0) return err(400, 'No fields to update');

	let updated: typeof task.$inferSelect;
	let cfError: string | null = null;
	try {
		updated = await withTransaction(async (tx) => {
			if (cf.length > 0) {
				const res = await writeTaskCustomValues(taskId, projectId, cf, tx);
				if (res.error) {
					cfError = res.error;
					throw new Error('cf-validation'); // rolls back; mapped to err(400) below
				}
			}
			const [row] = await tx
				.update(task)
				.set({ ...set, updatedAt: new Date() })
				.where(eq(task.id, taskId))
				.returning();

			if (opts.completeCascade) {
				const wasDone = eligible.find((s) => s.id === existing.statusId)?.category === 'completed';
				if (targetStatus?.category === 'completed' && !wasDone) {
					// move the recurrence insert + sub-task cascade update here, using `tx`
					// instead of `db` (the dispatchEvent side effect stays OUTSIDE — see below)
				}
			}
			return row;
		});
	} catch (e) {
		if (cfError) return err(400, cfError);
		throw e;
	}
```

Important details:
- Inside the transaction, replace `db.` with `tx.` for the CF write (passed as the
  4th arg), the task `update`, the recurrence `insert`, and the sub-task cascade
  `update`.
- The `dispatchEvent({ type: 'task.completed', ... })` currently inside
  `completeCascade` is a `void` fire-and-forget side effect — MOVE it to AFTER the
  transaction (guard it with the same `completeCascade` + completing-transition
  condition, recomputed or captured into a boolean before/after the tx). Do NOT
  call it inside `fn`.
- All the `void logActivity(...)`, `notifyMentions(...)`, `createNotification(...)`,
  and `broadcastProjectChange(...)` calls stay exactly where they were (after the
  transaction), operating on `updated`.
- Preserve the exact `err(400, res.error)` mapping for a CF validation failure —
  a CF error must still return the same 400 with the same message, and NOTHING
  must be persisted (the ROLLBACK guarantees it).

**Verify**: `npm run check` → exit 0, 0 errors / 0 warnings. `npm run test:unit`
→ all pass. Then, with a live seeded server, `npm run test:integration` → all pass
(the existing `task-mutations.test.ts` exercises PATCH + completeCascade — it must
still pass, proving the transactional path is behavior-equivalent).

### Step 4: Add an ADR record

Append a new `ADR-0NN` (next free number — check the last number in `ADR.md`) to
`ADR.md` documenting: the two drivers' incompatible transaction signatures, the
decision to use native async transactions for postgres and manual
`BEGIN IMMEDIATE`/`COMMIT`/`ROLLBACK` for better-sqlite3, the single-tenant
isolation caveat, side-effects-stay-outside rule, and that only
`updateTaskService` is wrapped so far (follow-ons listed).

**Verify**: `git diff ADR.md` shows one new ADR record; `npm run check` still
exits 0.

## Test plan

- No NEW test file is strictly required — the existing
  `tests/integration/task-mutations.test.ts` already exercises
  `PATCH /api/tasks/[id]` including the completeCascade path and the
  assignee-validation reject, which now runs through the transaction. It must
  still pass unchanged.
- OPTIONAL (recommended): add one integration assertion that a CF validation
  failure leaves the task row unchanged (atomicity): PATCH a task with a VALID
  title change AND an INVALID custom-field value in the same request; expect 400
  AND that the title did NOT change (rollback). Add to a new
  `tests/integration/tx-atomicity.test.ts` modeled on `task-mutations.test.ts`.
  (Setting up an invalid CF value requires a field to exist — reuse the
  custom-field creation flow; if that is too involved, skip this optional test and
  rely on the existing suite.)
- Verification: `npm run test:unit` (416 pass) + `npm run test:integration`
  (all pass) + `npm run check` (0/0).

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `npm run check` exits 0 with 0 errors / 0 warnings
- [ ] `npm run test:unit` exits 0 (416 tests still pass)
- [ ] `npm run test:integration` passes (existing `task-mutations` tests pass
      through the new transactional path)
- [ ] `withTransaction` exists in `src/lib/server/db/index.ts` and is called by
      `updateTaskService` (`grep -rn "withTransaction" src/lib/server/` shows the
      definition + one call)
- [ ] Inside the `withTransaction` callback in `updateTaskService`, writes use
      `tx.` (not `db.`); `dispatchEvent`/`broadcast`/`notify`/`logActivity` are
      OUTSIDE the callback
- [ ] `ADR.md` has one new ADR record for the transaction decision
- [ ] No out-of-scope service op was wrapped (`bulkUpdateTasks`,
      `moveTaskService`, `setTaskStatusService`, `createTaskService` still use the
      sequential `db.` writes)
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `db.run(sql\`BEGIN IMMEDIATE\`)` is not available on the `DB` type or throws at
  runtime under sqlite (the manual-transaction approach depends on it) — report
  the exact type/runtime error; do NOT fall back to a broken async
  `db.transaction(async ...)` under sqlite (it silently loses atomicity).
- The postgres `db.transaction` cast does not typecheck cleanly — report the type
  error rather than sprinkling `any` beyond the single documented cast in Step 1.
- Wrapping `updateTaskService` changes the observable behavior of any existing
  `task-mutations.test.ts` assertion (e.g. the completeCascade no longer cascades,
  or the assignee-reject 400 changes) — a refactor here must be behavior-preserving
  aside from atomicity.
- Threading `exec`/`tx` through `writeTaskCustomValues` + `encodeAndValidate`
  turns out to require touching `writeProjectCustomValues`' behavior or other
  callers — report; the default `exec = db` must keep every other caller identical.
- You discover the assumption "sqlite is the active dialect and postgres is
  deferred" is false (the deployment actually runs postgres under real concurrency)
  — the isolation caveat then matters more and a reviewer should weigh in.

## Maintenance notes

- **Follow-on ops (deliberately deferred from this plan)** — apply the same
  `withTransaction` pattern, one PR each, once the primitive is proven:
  `bulkUpdateTasks` (status update + sub-task cascade + label add/remove),
  `moveTaskService` (position-renumber loop + status/position write + recurrence),
  `setTaskStatusService` (status write + recurrence insert + cascade),
  `createTaskService` (insert + CF write, replacing the manual compensating
  delete). Each must keep side effects outside the transaction.
- A reviewer should scrutinize: (a) no `await` on real I/O (fetch/network) happens
  inside `fn` — only DB writes — otherwise the sqlite manual transaction holds the
  single connection across the event loop; (b) every side effect is outside `fn`;
  (c) the CF-error 400 still rolls back and returns the same message.
- If postgres becomes the primary dialect under real concurrency, revisit the
  sqlite manual-BEGIN isolation caveat and confirm the pg native path reserves a
  connection correctly (it does via `db.transaction`).
