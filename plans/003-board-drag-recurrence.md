# Plan 003: Spawn the next occurrence when a recurring task is completed by board drag

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 3958dd6..HEAD -- src/lib/server/tasks.ts`
> If `src/lib/server/tasks.ts` changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.
>
> **IMPORTANT — uncommitted edits at planning time**: When this plan was written,
> `src/lib/server/tasks.ts` and `src/lib/components/TaskPanel.svelte` had
> UNCOMMITTED working-tree edits (an in-progress "sub-tasks inherit parent
> milestone" feature). Those edits touch `createTaskService` (~lines 79–118) and
> the `updateTaskService` re-parent branch (~line 480) ONLY — they do NOT touch
> any recurrence or move code this plan changes. Because the edits are
> uncommitted, `git diff --stat 3958dd6..HEAD` may show nothing while the working
> tree differs. Match the excerpts below by CODE CONTENT, not line number — line
> numbers may be shifted by the uncommitted edits.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `3958dd6`, 2026-07-12

## Why this matters

A task can carry a recurrence rule (`task.recurrence`, e.g. `weekly:1`). When such
a task is marked complete, the app is supposed to spawn the next occurrence (a
fresh backlog copy with its due date advanced). Two of the three completion code
paths do this — the status dropdown (`setTaskStatusService`) and the REST PATCH
(`updateTaskService` with `completeCascade`). The third path, completing a task
by **dragging it onto a Done column on the board** (`moveTaskService`), cascades
completion to sub-tasks and fires the `task.completed` integration event but
NEVER spawns the next occurrence. So whether a recurring task keeps recurring
depends on HOW the user completed it — a silent, surprising data-loss bug. This
plan extracts the spawn logic into one shared helper and calls it from all three
paths, fixing the board path and removing the duplication that let them drift.

## Current state

- `src/lib/server/tasks.ts` — the task service layer (ADR-049). All task mutation
  logic (validation, permissions, DB writes, side effects) lives here; the form
  actions in `src/routes/(app)/projects/[id]/+page.server.ts` and the REST
  handlers in `src/routes/api/tasks/**` are thin adapters that call these
  functions and map the returned `ServiceResult<T>` to a response.
- `src/lib/recurrence.ts` — pure recurrence helpers. Relevant exports:
  - `nextDueDate(from: Date | null | undefined, rule: string | null | undefined): Date | null`
    — advances a date by one recurrence step (clamps month overflow), returns
    `null` on an invalid rule / null `from`.
  - `isValidRecurrence(rule)`.

**Import already present** at the top of `tasks.ts`:

```ts
import { isValidRecurrence, nextDueDate } from '$lib/recurrence';
```

### Site A — `setTaskStatusService` (spawns correctly today). Current excerpt:

```ts
	void logActivity(projectId, taskId, actor.id, 'status', { to: statusId });

	// Recurring task: when it moves into a completed status, spawn the next
	// occurrence with its due date advanced by the recurrence rule (BASDEV-8).
	const wasCompleted =
		eligible.find((s) => s.id === existing.statusId)?.category === 'completed';
	if (target.category === 'completed' && !wasCompleted && existing.recurrence) {
		const nextDue = nextDueDate(existing.dueDate ?? new Date(), existing.recurrence);
		const backlog = eligible.find((s) => s.category === 'backlog') ?? eligible[0];
		if (backlog) {
			const spawnNow = new Date();
			await db.insert(task).values({
				id: crypto.randomUUID(),
				projectId: existing.projectId,
				parentId: existing.parentId,
				title: existing.title,
				description: existing.description,
				priority: existing.priority,
				statusId: backlog.id,
				assigneeId: existing.assigneeId,
				milestoneId: existing.milestoneId,
				locationId: existing.locationId,
				startDate: existing.startDate,
				dueDate: nextDue,
				recurrence: existing.recurrence,
				createdBy: actor.id,
				position: spawnNow.getTime(),
				createdAt: spawnNow,
				updatedAt: spawnNow
			});
		}
	}

	// Completing a parent completes its sub-tasks
	if (target.category === 'completed') {
		await db.update(task).set({ statusId, updatedAt: new Date() }).where(eq(task.parentId, taskId));
	}
```

### Site B — `moveTaskService` (THE BUG — no spawn). Current excerpt (the tail, after the position write):

```ts
	await db
		.update(task)
		.set({ statusId, position, updatedAt: new Date() })
		.where(eq(task.id, taskId));

	const wasDone = eligible.find((s) => s.id === existing.statusId)?.category === 'completed';
	if (target.category === 'completed') {
		await db.update(task).set({ statusId, updatedAt: new Date() }).where(eq(task.parentId, taskId));
	}
	if (target.category === 'completed' && !wasDone) {
		const [proj] = await db.select().from(project).where(eq(project.id, projectId));
		void dispatchEvent({
			type: 'task.completed',
			actor: actor.name ?? 'Unknown',
			projectName: proj?.name ?? 'Unknown project',
			taskTitle: existing.title
		});
	}

	broadcastProjectChange(projectId, actor.id);
	return ok(null);
}
```

### Site C — `updateTaskService`, inside `if (opts.completeCascade) { ... }` (spawns correctly today). Current excerpt:

```ts
	// Completing a parent completes its sub-tasks + recurrence spawn (REST PATCH).
	if (opts.completeCascade) {
		const wasDone = eligible.find((s) => s.id === existing.statusId)?.category === 'completed';
		if (targetStatus?.category === 'completed' && !wasDone) {
			if (existing.recurrence) {
				const nextDue = nextDueDate(existing.dueDate ?? new Date(), existing.recurrence);
				const backlog = eligible.find((s) => s.category === 'backlog') ?? eligible[0];
				if (backlog) {
					const spawnNow = new Date();
					await db.insert(task).values({
						id: crypto.randomUUID(),
						projectId: existing.projectId,
						parentId: existing.parentId,
						title: existing.title,
						description: existing.description,
						priority: existing.priority,
						statusId: backlog.id,
						assigneeId: existing.assigneeId,
						milestoneId: existing.milestoneId,
						locationId: existing.locationId,
						startDate: existing.startDate,
						dueDate: nextDue,
						recurrence: existing.recurrence,
						createdBy: actor.id,
						position: spawnNow.getTime(),
						createdAt: spawnNow,
						updatedAt: spawnNow
					});
				}
			}

			await db
				.update(task)
				.set({ statusId: targetStatus.id, updatedAt: new Date() })
				.where(eq(task.parentId, taskId));
			// ... dispatchEvent(task.completed) ...
		}
	}
```

Note Sites A and C insert **byte-identical** `task` value objects. The only inputs
that vary are `existing`, `eligible`, `actor`, and the completed-transition
condition. That is exactly what makes a shared helper safe.

## Commands you will need

| Purpose        | Command                     | Expected on success                    |
|----------------|-----------------------------|----------------------------------------|
| Typecheck      | `npm run check`             | exit 0, 0 errors, 0 warnings           |
| Unit tests     | `npm run test:unit`         | all pass (baseline: 416 tests)         |
| Integration    | `npm run test:integration`  | all pass (needs live server — see below)|
| Start dev srv  | `npm run dev`               | serves on `http://localhost:5173`      |
| Seed DB        | `npm run db:seed`           | seeds admin/demo + sample data         |

Integration + Playwright tests require a running dev server on `:5173` AND a
seeded DB. In one terminal run `npm run dev`; in another run `npm run db:seed`
once, then the test command.

## Scope

**In scope** (the only files you should modify):
- `src/lib/server/tasks.ts`
- `tests/integration/board-recurrence.test.ts` (create)

**Out of scope** (do NOT touch):
- `src/lib/recurrence.ts` — the spawn math is already correct; reuse it.
- The in-progress milestone-inheritance edits in `createTaskService` /
  `updateTaskService` re-parent branch — leave them exactly as you find them.
- Any form action or REST handler — they are thin adapters; the fix belongs in
  the service so all three callers inherit it (ADR-049).

## Git workflow

- Work on branch `dev` (already the current branch).
- Commit style: conventional commits (see `git log --oneline`), e.g.
  `fix(tasks): spawn next recurrence when completing via board drag`.
- Do NOT push or open a PR unless the operator instructs it.

## Steps

### Step 1: Add a shared recurrence-spawn helper

In `src/lib/server/tasks.ts`, add a private async helper. Place it just after the
`isPriority` function (near the top, before `createTaskService`). It encapsulates
the exact insert from Sites A and C, gated on the completed transition:

```ts
/**
 * When a task transitions INTO a completed-category status (and wasn't already
 * completed), and it has a recurrence rule, spawn the next occurrence as a fresh
 * backlog task with its due date advanced. No-op otherwise. Mirrors the inserts
 * that previously lived inline in setTaskStatusService / updateTaskService.
 */
async function spawnRecurrenceIfCompleting(
	existing: typeof task.$inferSelect,
	eligible: Awaited<ReturnType<typeof listProjectStatuses>>,
	targetCategory: string,
	wasCompleted: boolean,
	actor: Actor
): Promise<void> {
	if (targetCategory !== 'completed' || wasCompleted || !existing.recurrence) return;
	const nextDue = nextDueDate(existing.dueDate ?? new Date(), existing.recurrence);
	const backlog = eligible.find((s) => s.category === 'backlog') ?? eligible[0];
	if (!backlog) return;
	const spawnNow = new Date();
	await db.insert(task).values({
		id: crypto.randomUUID(),
		projectId: existing.projectId,
		parentId: existing.parentId,
		title: existing.title,
		description: existing.description,
		priority: existing.priority,
		statusId: backlog.id,
		assigneeId: existing.assigneeId,
		milestoneId: existing.milestoneId,
		locationId: existing.locationId,
		startDate: existing.startDate,
		dueDate: nextDue,
		recurrence: existing.recurrence,
		createdBy: actor.id,
		position: spawnNow.getTime(),
		createdAt: spawnNow,
		updatedAt: spawnNow
	});
}
```

**Verify**: `npm run check` → exit 0, 0 errors, 0 warnings. (The helper is
unused so far; `check` treats an unused private function as OK. If it errors on
an unused symbol, proceed to Step 2 which uses it, then re-run.)

### Step 2: Call the helper from `setTaskStatusService` (Site A — behavior-preserving refactor)

Replace the inline `if (target.category === 'completed' && !wasCompleted && existing.recurrence) { ... }`
block (the whole `const nextDue ... }` shown in Site A) with a single call. Keep
the existing `wasCompleted` computation and the sub-task cascade that follows:

```ts
	const wasCompleted =
		eligible.find((s) => s.id === existing.statusId)?.category === 'completed';
	await spawnRecurrenceIfCompleting(existing, eligible, target.category, wasCompleted, actor);

	// Completing a parent completes its sub-tasks
	if (target.category === 'completed') {
		await db.update(task).set({ statusId, updatedAt: new Date() }).where(eq(task.parentId, taskId));
	}
```

**Verify**: `npm run check` → exit 0. `npm run test:unit` → all pass.

### Step 3: Call the helper from `updateTaskService` (Site C — behavior-preserving refactor)

Inside `if (opts.completeCascade) { ... if (targetStatus?.category === 'completed' && !wasDone) { ... } }`,
replace the inner `if (existing.recurrence) { ... }` block (the whole insert shown
in Site C) with a call. `wasDone` and `targetStatus` are already in scope here:

```ts
		if (targetStatus?.category === 'completed' && !wasDone) {
			await spawnRecurrenceIfCompleting(existing, eligible, targetStatus.category, wasDone, actor);

			await db
				.update(task)
				.set({ statusId: targetStatus.id, updatedAt: new Date() })
				.where(eq(task.parentId, taskId));

			// ...leave the existing dispatchEvent(task.completed) block unchanged...
		}
```

**Verify**: `npm run check` → exit 0. `npm run test:unit` → all pass.

### Step 4: Call the helper from `moveTaskService` (Site B — THE FIX)

In `moveTaskService`, after the `.set({ statusId, position, updatedAt })` write and
the existing `const wasDone = ...` line, add the spawn call BEFORE the sub-task
cascade. Final shape of that tail:

```ts
	await db
		.update(task)
		.set({ statusId, position, updatedAt: new Date() })
		.where(eq(task.id, taskId));

	const wasDone = eligible.find((s) => s.id === existing.statusId)?.category === 'completed';
	await spawnRecurrenceIfCompleting(existing, eligible, target.category, wasDone, actor);
	if (target.category === 'completed') {
		await db.update(task).set({ statusId, updatedAt: new Date() }).where(eq(task.parentId, taskId));
	}
	if (target.category === 'completed' && !wasDone) {
		const [proj] = await db.select().from(project).where(eq(project.id, projectId));
		void dispatchEvent({ /* ...unchanged... */ });
	}
```

**Verify**: `npm run check` → exit 0. `grep -c "await db.insert(task).values" src/lib/server/tasks.ts`
should now be smaller than before by 2 (the two inline recurrence inserts are
gone; only the helper's insert plus `createTaskService`/`bulkReparentToNew`
inserts remain).

### Step 5: Add an integration test for the board-drag path

Create `tests/integration/board-recurrence.test.ts`, modeled structurally on
`tests/integration/task-mutations.test.ts` (copy its `beforeAll` sign-in, the
`api()` fetch wrapper, `ensureAuth()`, `createProject`, and `afterAll` cleanup
verbatim — same seeded admin creds, same skip-if-unreachable behavior).

The board drag goes through a **form action**, not REST. Add a helper to POST a
form action (SvelteKit needs `content-type: application/x-www-form-urlencoded`
and an `origin` header matching the server):

```ts
async function moveTask(projectId: string, id: string, statusId: string) {
	return fetch(`${BASE}/projects/${projectId}?/moveTask`, {
		method: 'POST',
		headers: {
			'content-type': 'application/x-www-form-urlencoded',
			origin: BASE,
			...(cookie ? { cookie } : {})
		},
		body: new URLSearchParams({ id, statusId }).toString()
	});
}
```

The test:

1. `createProject(...)` → projectId.
2. `GET /api/projects/{projectId}` → read `statuses`; find
   `completedId = statuses.find(s => s.category === 'completed').id`.
3. `POST /api/tasks` `{ projectId, title, dueDate: '2026-01-01' }` → task id.
4. `PATCH /api/tasks/{id}` `{ recurrence: 'weekly:1' }` → 200.
5. `moveTask(projectId, id, completedId)` → expect `res.status` 200.
6. `GET /api/projects/{projectId}` → among `tasks`, assert there are now **two**
   tasks with the chosen title: the original (now in the completed status) AND a
   spawned copy whose `recurrence === 'weekly:1'`, whose `statusId` is a
   `backlog`-category status, and whose `dueDate` is one week after `2026-01-01`
   (i.e. `2026-01-08`).

Use a unique title (`` `recur-${crypto.randomUUID()}` ``) so the count is exact.

**Verify**: with `npm run dev` running and the DB seeded,
`npm run test:integration` → all pass, including the new test. If the server is
not running, the test SKIPS with a clear message (same as the model test) — that
is acceptable but you should still run it against a live server at least once and
report the result.

## Test plan

- New file `tests/integration/board-recurrence.test.ts`:
  - Happy path / regression: completing a recurring task via the `moveTask` form
    action spawns exactly one next-occurrence copy in a backlog status with the
    advanced due date. (This is the bug this plan fixes — it would FAIL against
    the pre-fix code.)
- Structural pattern to copy: `tests/integration/task-mutations.test.ts`.
- Existing `npm run test:unit` (416 tests) must still pass — Steps 2 and 3 are
  refactors that must not change behavior.
- Verification: `npm run test:integration` → all pass including the new test.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `npm run check` exits 0 with 0 errors / 0 warnings
- [ ] `npm run test:unit` exits 0 (416 tests still pass)
- [ ] `npm run test:integration` passes with the new test present and passing
      against a live seeded server
- [ ] `spawnRecurrenceIfCompleting` is defined once and called from
      `setTaskStatusService`, `moveTaskService`, and `updateTaskService`
      (`grep -c "spawnRecurrenceIfCompleting" src/lib/server/tasks.ts` ≥ 4:
      1 definition + 3 calls)
- [ ] No `await db.insert(task).values(` remains inside `moveTaskService`,
      `setTaskStatusService`, or the `completeCascade` block (the only remaining
      recurrence insert is inside the helper)
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The excerpts in "Current state" don't match the live code (drift). Especially:
  if the uncommitted milestone-inheritance edits have been committed/reverted and
  the recurrence insert blocks look different from the excerpts.
- Sites A and C are NOT byte-identical inserts anymore (if they diverged, the
  shared helper may silently change behavior — report before proceeding).
- `npm run check` or `npm run test:unit` fails after Step 2 or Step 3 (a
  refactor step must be behavior-preserving; a failure means the extraction
  changed something).
- The `moveTask` form action returns a non-200 in the test for reasons unrelated
  to recurrence (e.g. CSRF/origin rejection) — report the response body.

## Maintenance notes

- If a fourth completion path is ever added (e.g. a new bulk-complete that should
  recur), it must also call `spawnRecurrenceIfCompleting`. `bulkUpdateTasks`
  today does NOT spawn recurrences — that is an intentional, separate decision;
  do not silently change it as part of this plan.
- A reviewer should confirm the helper is called with the correct
  `wasCompleted`/`wasDone` value at each site (passing the wrong prior-state flag
  would double-spawn or never spawn).
- Follow-on deferred: the check-then-act spawn has a theoretical double-spawn race
  under concurrent completes — tracked separately in
  `plans/020-recurrence-double-spawn-investigate.md`; out of scope here.
