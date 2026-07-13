# Plan 005: Collapse the per-task permission N+1 in bulk task ops

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If
> anything in "STOP conditions" occurs, stop and report — do not improvise. When
> done, update this plan's status row in `plans/README.md` if that file exists
> (do NOT create it if it does not).
>
> **Drift check (run first)**:
> `git diff --stat 3958dd6..HEAD -- src/lib/server/tasks.ts src/lib/server/permissions.ts "src/routes/(app)/projects/[id]/+page.server.ts"`
> NOTE: `src/lib/server/tasks.ts` had **uncommitted changes** at planning time;
> the excerpts below were read from the working tree, not the `3958dd6` commit.
> If the cited regions differ from the live code, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `3958dd6`, 2026-07-12

## Why this matters

`bulkAllowed` (in `src/lib/server/tasks.ts`) computes the editable subset of
selected task ids by **awaiting one permission check per task** in a sequential
loop. Each `canEditTask` call reduces to `canAccessProject`, which issues ~2–4
DB queries (project lookup + workspace access + grant checks). Selecting 50
tasks for a bulk status change fires on the order of 100–200 sequential queries.
But the loop already `continue`s on any task whose `projectId` differs from the
single `projectId` argument — so **every task that survives the filter shares
one project**, and its access is a single boolean. The per-task check is
entirely redundant: resolve project access ONCE, then keep every same-project
row. Per ADR-019 (inlined below) task-edit permission _is_ project access —
there is no finer-grained per-task gate to preserve.

## Current state

### `bulkAllowed` — `src/lib/server/tasks.ts:620–634`

```ts
/* -------------------------------- bulk ops -------------------------------- */

/**
 * Resolve the editable subset of `ids` scoped to `projectId`: only rows in this
 * project the actor can edit. Mirrors the form actions (project from params).
 */
async function bulkAllowed(ids: string[], projectId: string, actor: Actor): Promise<string[]> {
	const rows = await db.select().from(task).where(inArray(task.id, ids));
	const allowed: string[] = [];
	for (const t of rows) {
		if (t.projectId !== projectId) continue;
		if (await canEditTask(actor, t)) allowed.push(t.id);
	}
	return allowed;
}
```

`inArray` is already imported in this file (used on the first line of the
function). `canAccessProject` is imported here too (it backs `canEditTask`).
Confirm the import line near the top of `tasks.ts`:
`grep -n "canAccessProject\|canEditTask" src/lib/server/tasks.ts` — if
`canAccessProject` is not already imported, add it to the existing
`from './permissions'` (or `from '$lib/server/permissions'`) import.

### The permission relationship — `src/lib/server/permissions.ts:98–117`

```ts
export async function canAccessProject(user: SessionUser, projectId: string) {
	if (!user) return false;
	if (isAdmin(user)) return true;
	const [p] = await db.select().from(project).where(eq(project.id, projectId));
	if (!p) return false;
	if (p.workspaceId && (await canAccessWorkspace(user, p.workspaceId))) return true;
	return hasGrant(user.id, [{ type: 'project', id: projectId }]);
}

/**
 * Task editing (create/edit/move/status) is open to every member who can
 * ACCESS the project (ADR-019 narrows ADR-013's "any signed-in user").
 * Project/view STRUCTURE remains grant-gated via canEditProject/canEditView.
 */
export async function canEditTask(
	user: SessionUser,
	t: { id: string; parentId: string | null; projectId: string }
) {
	return canAccessProject(user, t.projectId);
}
```

`canEditTask(actor, t)` is **defined as** `canAccessProject(actor, t.projectId)`
— nothing task-specific. So for a fixed `projectId`, all rows have the same
answer. `Actor` is the type used by the service layer; `canAccessProject` takes
a `SessionUser`-shaped `{ id, role? }`, which `Actor` satisfies (it is already
passed to `canEditTask` today).

### The parallel per-view loop — `src/routes/(app)/projects/[id]/+page.server.ts:294–298`

```ts
// Per-view edit rights (project grant covers all views); hidden views are never rendered
const editableViews: Record<string, boolean> = {};
for (const v of views.filter((v) => !v.hidden)) {
	editableViews[v.id] = canEditProj || (await canEditView(locals.user, v.id));
}
```

`canEditView(user, viewId)` (`permissions.ts:56–63`) is:
`admin OR view-grant OR canEditProject(user, v.projectId)`. Here `canEditProj`
is already computed once and OR-ed in, so when the user IS a project editor the
`await` never fires (no queries). The N+1 only bites a user who is _not_ a
project editor but holds per-view grants: each iteration then re-runs
`canEditProject` (returning false) plus a view-grant lookup. The clean collapse
is to fetch that user's `view` grants for this project's views in ONE query and
membership-test locally.

## Commands you will need

| Purpose           | Command                                               | Expected on success       |
| ----------------- | ----------------------------------------------------- | ------------------------- |
| Typecheck         | `npm run check`                                       | exit 0, 0 errors/warnings |
| Grep (loop gone)  | `grep -n "await canEditTask" src/lib/server/tasks.ts` | no output                 |
| Unit tests        | `npm run test:unit`                                   | all pass (416 tests)      |
| Integration tests | `npm run test:integration`                            | all pass (needs a DB)     |

Integration tests need `.env` + a seeded DB (`npm run db:seed`); if the harness
is unavailable, rely on `npm run check` + the grep gate and note that
integration was not run.

## Scope

**In scope**:

- `src/lib/server/tasks.ts` — Step 1 (the primary fix).
- `src/routes/(app)/projects/[id]/+page.server.ts` — Step 2 (parallel collapse).

**Out of scope** (do NOT touch):

- `src/lib/server/permissions.ts` — its functions are correct as-is; only the
  callers over-invoke them. Do not weaken any guard.
- The public `ServiceResult` shape / any REST or form-action signatures.
- The behavior contract: a task in a _different_ project must still be excluded.

## Git workflow

- Branch `dev` (or `advisor/005-bulk-permission-n1` off it).
- Conventional commit, e.g. `perf(tasks): collapse per-task permission N+1 in bulk ops`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Resolve project access once in `bulkAllowed`

Replace the body of `bulkAllowed` (`src/lib/server/tasks.ts:626–634`) so it
checks access a single time and keeps every same-project row:

```ts
async function bulkAllowed(ids: string[], projectId: string, actor: Actor): Promise<string[]> {
	if (ids.length === 0) return [];
	// Task-edit permission == project access (ADR-019); resolve it once, not per row.
	if (!(await canAccessProject(actor, projectId))) return [];
	const rows = await db.select({ id: task.id }).from(task).where(inArray(task.id, ids));
	return rows.filter((t) => t.projectId === projectId).map((t) => t.id);
}
```

Wait — the `.select({ id: task.id })` projection drops `projectId`, which the
filter needs. Use this instead (select both columns):

```ts
async function bulkAllowed(ids: string[], projectId: string, actor: Actor): Promise<string[]> {
	if (ids.length === 0) return [];
	// Task-edit permission == project access (ADR-019); resolve it once, not per row.
	if (!(await canAccessProject(actor, projectId))) return [];
	const rows = await db
		.select({ id: task.id, projectId: task.projectId })
		.from(task)
		.where(inArray(task.id, ids));
	return rows.filter((t) => t.projectId === projectId).map((t) => t.id);
}
```

Ensure `canAccessProject` is imported in `tasks.ts` (add it to the existing
permissions import if absent). Leave the `canEditTask` import in place only if
it is still used elsewhere in the file; if this was its sole use and it now
triggers an unused-import error, remove it from the import.

**Verify**:

- `grep -n "await canEditTask" src/lib/server/tasks.ts` → no output (the loop is gone).
- `npm run check` → exit 0, 0 errors/warnings (fix any unused-import fallout).

### Step 2: Collapse the per-view `canEditView` loop

In `src/routes/(app)/projects/[id]/+page.server.ts:294–298`, replace the loop
so a non-editor's view grants are fetched once. Pattern:

```ts
// Per-view edit rights (project grant covers all views); hidden views are never rendered.
const editableViews: Record<string, boolean> = {};
const visibleViews = views.filter((v) => !v.hidden);
if (canEditProj) {
	for (const v of visibleViews) editableViews[v.id] = true;
} else {
	const grantedViewIds = new Set(
		(
			await db
				.select({ id: permission.resourceId })
				.from(permission)
				.where(
					and(
						eq(permission.userId, locals.user.id),
						eq(permission.resourceType, 'view'),
						inArray(
							permission.resourceId,
							visibleViews.map((v) => v.id)
						)
					)
				)
		).map((r) => r.id)
	);
	for (const v of visibleViews) editableViews[v.id] = grantedViewIds.has(v.id);
}
```

Before writing this, confirm the imports available in that `+page.server.ts`:
`grep -n "^import\|from 'drizzle-orm'\|permission" src/routes/\(app\)/projects/\[id\]/+page.server.ts`.
You will likely need `permission` from the schema and `and, eq, inArray` from
`drizzle-orm`, plus `db`. If any are missing, add them to the existing imports.
Also confirm `locals.user` is non-null here (the route guards it) — if the type
requires it, the existing `canEditProj`/`canEditView(locals.user, …)` calls
already prove it is usable.

If the surrounding code differs materially from the excerpt (e.g. `views` or
`canEditProj` are named differently), treat Step 2 as an **out-of-scope
follow-up**: leave the loop unchanged, complete Step 1 only, and note this in
your report.

**Verify**: `npm run check` → exit 0, 0 errors/warnings.

### Step 3: Run the test suites

**Verify**:

- `npm run test:unit` → all pass (416 tests).
- `npm run test:integration` → all pass (if the DB harness is available). The
  existing bulk-task integration tests must still pass — they assert that a bulk
  update touches only same-project, accessible tasks. If you cannot run
  integration, say so explicitly in your report.

## Test plan

- No new tests required — the behavior is unchanged (same allowed set, fewer
  queries). Existing integration coverage of `bulkUpdateTasks` / `bulkDeleteTasks`
  is the regression gate.
- If integration tests for bulk ops don't obviously exist, grep for them:
  `grep -rln "bulk" tests/` and confirm they exercise the allowed-subset path.
  Do NOT add new tests unless a gap is found and the operator asks.

## Done criteria

ALL must hold:

- [ ] `grep -n "await canEditTask" src/lib/server/tasks.ts` → no output
- [ ] `bulkAllowed` calls `canAccessProject` exactly once (no per-row await)
- [ ] `npm run check` exits 0, 0 errors/warnings
- [ ] `npm run test:unit` passes (416 tests)
- [ ] `npm run test:integration` passes (or is documented as un-runnable here)
- [ ] Only in-scope files modified (`git status --short`)

## STOP conditions

Stop and report if:

- The `bulkAllowed` excerpt does not match the live code (drift — remember
  `tasks.ts` had uncommitted changes at planning time).
- `canEditTask` turns out to contain task-specific logic beyond
  `return canAccessProject(...)` (it would mean per-task checks are NOT
  redundant — do not collapse).
- Step 2's surrounding code differs from the excerpt — complete Step 1 only and
  report Step 2 as deferred.
- Any bulk integration test fails after the change (a real behavior regression).

## Maintenance notes

- If per-task permission grants (`resourceType: 'task'`) ever become meaningful
  for editing (today they don't gate task edits — access is project-level per
  ADR-019), `bulkAllowed` must go back to a per-task check. The single-project
  collapse is valid ONLY while `canEditTask ⇒ canAccessProject`.
- Reviewer should confirm the excluded-set semantics are unchanged: a
  different-project id in the input is still dropped by the `projectId` filter.
