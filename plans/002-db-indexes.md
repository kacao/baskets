# Plan 002: Add explicit DB indexes on hot foreign-key columns

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan in
> `plans/README.md` if that file exists (do NOT create it if it does not).
>
> **Drift check (run first)**:
> `git diff --stat 3958dd6..HEAD -- src/lib/server/db/schema.sqlite.ts src/lib/server/db/schema.pg.ts`
> If either schema file changed since this plan was written, compare the
> "Current state" excerpts below against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `3958dd6`, 2026-07-12

## Why this matters

The schema declares **zero explicit indexes** — the only indexes that exist are
the implicit ones SQLite/Postgres create for PRIMARY KEYs and `.unique()`
constraints. Every hot foreign-key column queried on a project-page load
(`task.projectId`, `task.parentId`, `taskCustomValue.taskId`, `taskLabel.taskId`,
`comment.taskId`, `activity.taskId`, `notification.userId`, and the project-scoped
lists on `file`/`location`/`milestone`) is therefore resolved with a **full table
scan**. The realtime layer refetches the entire project `load()` on every
`changed` ping (by design — `invalidateAll()`), so each missing index's cost is
multiplied by refetch frequency. Adding non-unique B-tree indexes is a purely
additive, push-based change that turns those scans into index lookups. This is
the single biggest cheap scaling win available.

## Current state

- `src/lib/server/db/schema.sqlite.ts` — **canonical** multi-dialect schema
  (SQLite). Tables declared with `sqliteTable(name, columns, (t) => [...])`.
  The third-arg table-callback is already used for composite primary keys /
  unique constraints (see below) — the exact same callback is where indexes go.
- `src/lib/server/db/schema.pg.ts` — Postgres **mirror**. Table + column NAMES
  must stay byte-identical to the sqlite file; only column TYPES differ. Its
  header comment (lines 12–16) says: *"Keep the two files in lockstep."* You
  MUST edit BOTH files identically for this change.
- `src/lib/server/db/schema.ts` — thin facade re-exporting the active dialect's
  tables; **do not touch it**.

Confirmed there are zero indexes today:

```
$ grep -c "index(" src/lib/server/db/schema.sqlite.ts   → 0
$ grep -c "index(" src/lib/server/db/schema.pg.ts        → 0
```

**Drizzle index API (verified for the installed `drizzle-orm@^0.45.2`):**
Both dialects export `index(name)` returning a builder whose `.on(...columns)`
takes the table columns. SQLite import path `drizzle-orm/sqlite-core`, Postgres
`drizzle-orm/pg-core`. Shape: `index('idx_name').on(t.colName)`. Indexes are
returned from the table's third-arg callback in the SAME array as existing
`primaryKey(...)` / `unique(...)` entries.

### Existing table-callback pattern to mirror (sqlite)

`task` table has NO third-arg callback today — `sqliteTable('task', { ... })`
(schema.sqlite.ts:331–358). You will ADD a callback. Tables that already show
the callback pattern (copy this exact structure):

`schema.sqlite.ts:158–169` (`project_status`):
```ts
export const projectStatus = sqliteTable(
	'project_status',
	{
		projectId: text('project_id')
			.notNull()
			.references(() => project.id, { onDelete: 'cascade' }),
		statusId: text('status_id')
			.notNull()
			.references(() => status.id, { onDelete: 'cascade' })
	},
	(t) => [primaryKey({ columns: [t.projectId, t.statusId] })]
);
```

`schema.sqlite.ts:191–206` (`permission`) already has a `.unique().on(...)`
inside the callback:
```ts
	(t) => [unique().on(t.userId, t.resourceType, t.resourceId)]
```

### Current imports (top of each file)

`schema.sqlite.ts:1`:
```ts
import { sqliteTable, text, integer, real, primaryKey, unique } from 'drizzle-orm/sqlite-core';
```
`schema.pg.ts:1–10`:
```ts
import {
	pgTable,
	text,
	integer,
	boolean,
	timestamp,
	doublePrecision,
	primaryKey,
	unique
} from 'drizzle-orm/pg-core';
```
You must add `index` to BOTH import lists.

### Columns to index (target set)

Priority columns (add these — they are hit on every project-page load):

| Table (const)              | sqlite table name       | Column (prop → db col)          |
|----------------------------|-------------------------|---------------------------------|
| `task`                     | `task`                  | `projectId` → `project_id`      |
| `task`                     | `task`                  | `parentId` → `parent_id`        |
| `taskCustomValue`          | `task_custom_value`     | `taskId` → `task_id`            |
| `taskLabel`                | `task_label`            | `taskId` → `task_id`            |

Secondary columns (add these too — same rationale, other hot lists):

| Table (const)              | sqlite table name       | Column (prop → db col)          |
|----------------------------|-------------------------|---------------------------------|
| `file`                     | `file`                  | `projectId` → `project_id`      |
| `location`                 | `location`              | `projectId` → `project_id`      |
| `milestone`                | `milestone`             | `projectId` → `project_id`      |
| `comment`                  | `comment`               | `taskId` → `task_id`            |
| `activity`                 | `activity`              | `taskId` → `task_id`            |
| `notification`             | `notification`          | `userId` → `user_id`            |

**STOP-check before adding each index**: skip any column that is already the
LEADING column of an existing composite `primaryKey(...)` / `.unique().on(...)`
in that table's callback — that composite already provides a usable index and a
duplicate is wasteful.

Verified NOT covered (safe to add, these are the ones in the tables above):
- `task.projectId`, `task.parentId` — `task` has no callback / no composite. ADD.
- `file.projectId`, `location.projectId`, `milestone.projectId` — those tables
  have no composite PK (single `id` PK). ADD.
- `comment.taskId`, `activity.taskId`, `notification.userId` — single `id` PK,
  no composite. ADD.
- `taskCustomValue.taskId`: its composite PK is
  `primaryKey({ columns: [t.taskId, t.fieldId] })` (schema.sqlite.ts:411) — `taskId`
  is the LEADING column, so that PK already indexes `taskId`. **DO NOT add a
  separate index on `taskCustomValue.taskId`** — it is redundant. (Kept in the
  priority list only to flag it; the composite covers it.)
- `taskLabel.taskId`: composite PK is
  `primaryKey({ columns: [t.taskId, t.labelId] })` (schema.sqlite.ts:302) — `taskId`
  leading, already indexed. **DO NOT add a separate index on `taskLabel.taskId`.**

Net indexes to actually create (8): `task.projectId`, `task.parentId`,
`file.projectId`, `location.projectId`, `milestone.projectId`, `comment.taskId`,
`activity.taskId`, `notification.userId`.

## Commands you will need

| Purpose        | Command                        | Expected on success                          |
|----------------|--------------------------------|----------------------------------------------|
| Typecheck      | `npm run check`                | exit 0, 0 errors / 0 warnings                |
| Apply schema   | `npm run db:push`              | prints "Changes applied" (or "No changes")   |
| Count indexes  | `grep -c "index(" src/lib/server/db/schema.sqlite.ts` | > 0               |
| Count indexes  | `grep -c "index(" src/lib/server/db/schema.pg.ts`     | > 0               |
| Unit tests     | `npm run test:unit`            | all pass (416 tests)                         |

## Scope

**In scope** (the only files you should modify):
- `src/lib/server/db/schema.sqlite.ts`
- `src/lib/server/db/schema.pg.ts`

**Out of scope** (do NOT touch):
- `src/lib/server/db/schema.ts` — facade; re-exports only.
- Any query code in `src/lib/server/*.ts` — indexes are transparent to callers;
  no query changes are needed or wanted.
- `taskCustomValue` / `taskLabel` index additions — already covered by their
  composite PKs (see Current state); adding them is a mistake.

## Git workflow

- Branch: `dev` is the working branch. Create `advisor/002-db-indexes` off `dev`
  if you branch; otherwise commit directly to `dev` per repo convention.
- Conventional commit, e.g.
  `perf(db): add indexes on hot foreign-key columns (both dialects)`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add `index` to both import statements

In `src/lib/server/db/schema.sqlite.ts:1`, add `index` to the named imports:
```ts
import { sqliteTable, text, integer, real, primaryKey, unique, index } from 'drizzle-orm/sqlite-core';
```
In `src/lib/server/db/schema.pg.ts:1–10`, add `index` to the named import list
(e.g. after `doublePrecision,`).

**Verify**: `npm run check` → still exit 0 (unused import is not yet an error;
if it warns, proceed — Step 2 uses it).

### Step 2: Add the 8 indexes in schema.sqlite.ts

For each table below, add a third-arg callback (or extend the existing array).
Use short, unique index names prefixed `idx_`.

- `task` (currently `sqliteTable('task', { ... })`, ends at line ~358) — add:
  ```ts
  }, (t) => [
  	index('idx_task_project').on(t.projectId),
  	index('idx_task_parent').on(t.parentId)
  ]);
  ```
  (i.e. change the closing `});` of the columns object to `}, (t) => [ ... ]);`)
- `milestone` — `}, (t) => [index('idx_milestone_project').on(t.projectId)]);`
- `location` — `}, (t) => [index('idx_location_project').on(t.projectId)]);`
- `file` — `}, (t) => [index('idx_file_project').on(t.projectId)]);`
- `comment` — `}, (t) => [index('idx_comment_task').on(t.taskId)]);`
- `activity` — `}, (t) => [index('idx_activity_task').on(t.taskId)]);`
- `notification` — `}, (t) => [index('idx_notification_user').on(t.userId)]);`

Do NOT add anything to `taskCustomValue` or `taskLabel` (composite PK covers
their `taskId`).

**Verify**:
- `grep -c "index(" src/lib/server/db/schema.sqlite.ts` → `8`
- `npm run check` → exit 0, 0 errors / 0 warnings

### Step 3: Mirror the exact same 8 indexes in schema.pg.ts

Apply the identical changes to `src/lib/server/db/schema.pg.ts` — **same index
names, same table constants, same columns**. The Postgres tables use `pgTable`
but the column props (`t.projectId`, `t.parentId`, `t.taskId`, `t.userId`) have
the same names, so the callback bodies are byte-identical to Step 2.

**Verify**:
- `grep -c "index(" src/lib/server/db/schema.pg.ts` → `8`
- `grep -o "idx_[a-z_]*" src/lib/server/db/schema.sqlite.ts | sort` **equals**
  `grep -o "idx_[a-z_]*" src/lib/server/db/schema.pg.ts | sort`
  (the two files declare the identical set of index names)
- `npm run check` → exit 0

### Step 4: Push the schema to the active-dialect DB

The active dialect is read from `.env` (`DB_DIALECT`, default `sqlite`, DB file
`./data/baskets.db`). Back up the DB file first if it exists:
```
cp ./data/baskets.db ./data/baskets.db.bak 2>/dev/null || true
```
Then:
```
npm run db:push
```

**Verify**: output contains `Changes applied` (or, if run twice, `No changes
detected` on the second run). The 8 `CREATE INDEX` statements are additive — no
table rebuild, so the `db:push` INSERT…SELECT gotcha from AGENTS.md does NOT
apply here. If `db:push` errors, see STOP conditions.

### Step 5: Full check + unit tests

**Verify**:
- `npm run check` → exit 0, 0 errors / 0 warnings
- `npm run test:unit` → all pass (416 tests). (These are pure-module tests; they
  do not touch the DB, so they should be unaffected — this is a regression gate.)

## Test plan

- No new tests. Indexes are transparent to application behavior; the query
  results are identical, only faster. The gate is that `npm run check` and
  `npm run test:unit` remain green and `db:push` applies cleanly.
- Optional manual sanity (SQLite): after `db:push`, the indexes exist —
  `sqlite3 ./data/baskets.db ".indexes task"` lists `idx_task_project` and
  `idx_task_parent` (only if `sqlite3` CLI is available; skip if not).

## Done criteria

ALL must hold:

- [ ] `grep -c "index(" src/lib/server/db/schema.sqlite.ts` → `8`
- [ ] `grep -c "index(" src/lib/server/db/schema.pg.ts` → `8`
- [ ] The `idx_*` name sets in the two files are identical (Step 3 verify)
- [ ] `npm run check` exits 0 with 0 errors / 0 warnings
- [ ] `npm run db:push` reported "Changes applied" (or "No changes" on rerun)
- [ ] `npm run test:unit` passes (416 tests)
- [ ] No files outside the in-scope list modified (`git status --short`)

## STOP conditions

Stop and report (do not improvise) if:

- The "Current state" excerpts don't match the live schema files (drift).
- `db:push` errors with anything about rebuilding a table or a broken
  `INSERT … SELECT` — indexes should be pure `CREATE INDEX`; a table rebuild
  means something else changed. Restore `./data/baskets.db.bak` and report.
- A column you were about to index turns out to already be the leading column of
  an existing composite PK/unique in that table (beyond the two already flagged)
  — skip it and note it, don't add a duplicate.
- `npm run check` reports errors you cannot resolve by fixing the import/callback
  syntax within two attempts.
- `DB_DIALECT` in `.env` is `postgres` and you lack a reachable `DATABASE_URL`
  — the schema-file edits are still correct; report that `db:push` could not run
  and leave Step 4 for the operator.

## Maintenance notes

- If a new hot query pattern appears (e.g. filtering tasks by `assigneeId` or
  `statusId` at scale), add the corresponding index in BOTH schema files and
  `db:push`.
- Any future composite PK/unique added on one of these columns as the leading
  column makes the standalone index here redundant — drop the standalone one.
- Reviewer should confirm the two schema files stayed byte-identical in index
  names/columns (the lockstep rule) and that `taskCustomValue`/`taskLabel` were
  NOT given redundant indexes.
