# Plan 020: Investigate a possible double-spawn of recurring tasks under concurrent completes

> **Executor instructions**: This is an INVESTIGATE plan, not a fix plan. Your job
> is to determine whether the race described below is real in this codebase, and
> to report your findings. Only proceed to a code change if Step 2 reproduces the
> bug — and even then, follow the guarded fix exactly. Run every verification
> command. If anything in "STOP conditions" occurs, stop and report. When done,
> update the status row for this plan in `plans/README.md` — unless a reviewer
> dispatched you and told you they maintain the index.
>
> **Drift check (run first)**: `git diff --stat 3958dd6..HEAD -- src/lib/server/tasks.ts`
> If `src/lib/server/tasks.ts` changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a mismatch,
> treat it as a STOP condition.
>
> **IMPORTANT — uncommitted edits at planning time**: `src/lib/server/tasks.ts`
> had UNCOMMITTED working-tree edits when this plan was written (a milestone-
> inheritance feature) affecting `createTaskService` and the `updateTaskService`
> re-parent branch — NOT the recurrence-spawn blocks this plan inspects. Match
> excerpts by code content, not line number.
>
> **Interaction with Plan 003**: `plans/003-board-drag-recurrence.md`, if executed
> first, extracts the recurrence-spawn insert into a shared
> `spawnRecurrenceIfCompleting` helper. If that plan has landed, the two inline
> blocks quoted below will instead be single calls to that helper — the race
> (check-then-act across an `await`) is UNCHANGED and the analysis still applies;
> just reason about the helper call site instead of the inline insert.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: `plans/011-service-transactions.md` (provides the
  `withTransaction` mechanism the guarded fix would use — do NOT hand-roll a
  transaction here if 011 hasn't landed; see Step 3)
- **Category**: bug
- **Planned at**: commit `3958dd6`, 2026-07-12
- **Confidence**: LOW — this may not reproduce in a single-tenant, single-user app.

## Why this matters

When a recurring task is completed, the code spawns the next occurrence only if
the task "was not already completed." That decision is **check-then-act**: it
reads the task's current status, decides `wasCompleted`, then — across an `await`
— inserts the next occurrence. There is no transaction, lock, or conditional
guard tying the read to the insert. Two nearly-simultaneous "complete" requests
(a double-click, a client retry, or a REST call racing a realtime-triggered
re-submit) could BOTH read `wasCompleted === false` and BOTH spawn a copy —
producing duplicate recurring tasks that quietly accumulate. Because the app is
single-tenant and single-user-oriented, the probability is low, which is why this
is an INVESTIGATE plan: first prove (or disprove) the race, and only then apply
the minimal guard.

## Current state

Two mirror sites in `src/lib/server/tasks.ts` share the same check-then-act shape.

### Site 1 — `setTaskStatusService`:

```ts
await db.update(task).set({ statusId, updatedAt: new Date() }).where(eq(task.id, taskId));

void logActivity(projectId, taskId, actor.id, 'status', { to: statusId });

// Recurring task: when it moves into a completed status, spawn the next
// occurrence with its due date advanced by the recurrence rule (BASDEV-8).
const wasCompleted = eligible.find((s) => s.id === existing.statusId)?.category === 'completed';
if (target.category === 'completed' && !wasCompleted && existing.recurrence) {
	const nextDue = nextDueDate(existing.dueDate ?? new Date(), existing.recurrence);
	const backlog = eligible.find((s) => s.category === 'backlog') ?? eligible[0];
	if (backlog) {
		const spawnNow = new Date();
		await db.insert(task).values({/* ...next occurrence... */});
	}
}
```

Note `existing` was read at the TOP of the function (via `getTask(taskId)`),
BEFORE the `db.update` that marks this task completed. So `wasCompleted` is
derived from a snapshot taken before the write — two concurrent calls each read
the pre-completion snapshot and each see `wasCompleted === false`.

### Site 2 — `updateTaskService`, inside `if (opts.completeCascade)`:

```ts
if (opts.completeCascade) {
	const wasDone = eligible.find((s) => s.id === existing.statusId)?.category === 'completed';
	if (targetStatus?.category === 'completed' && !wasDone) {
		if (existing.recurrence) {
			const nextDue = nextDueDate(existing.dueDate ?? new Date(), existing.recurrence);
			const backlog = eligible.find((s) => s.category === 'backlog') ?? eligible[0];
			if (backlog) {
				const spawnNow = new Date();
				await db.insert(task).values({/* ...next occurrence... */});
			}
		}
		// ...sub-task cascade update + (void) dispatchEvent...
	}
}
```

Same structure: `existing` is a snapshot read before the task's own update; the
spawn is gated on the snapshot's `wasDone`.

The reachable completion entry points (for constructing a concurrent test):

- `PATCH /api/tasks/[id]` `{ status: 'Completed' }` → `updateTaskService` with
  `completeCascade: true` (see `src/routes/api/tasks/[id]/+server.ts`).
- Board drag form action `?/moveTask` → `moveTaskService` (only spawns after Plan
  003 lands).
- Status dropdown form action → `setTaskStatusService`.

The cleanest way to fire two truly concurrent completes is two parallel
`PATCH /api/tasks/[id]` requests with `{ status: 'Completed' }`.

## Commands you will need

| Purpose       | Command                    | Expected on success                      |
| ------------- | -------------------------- | ---------------------------------------- |
| Typecheck     | `npm run check`            | exit 0, 0 errors, 0 warnings             |
| Unit tests    | `npm run test:unit`        | all pass (baseline: 416 tests)           |
| Integration   | `npm run test:integration` | all pass (needs live server + seeded DB) |
| Start dev srv | `npm run dev`              | serves on `http://localhost:5173`        |
| Seed DB       | `npm run db:seed`          | seeds admin/demo + sample data           |

## Scope

**In scope**:

- Step 1–2 (investigation): a throwaway repro test under
  `tests/integration/recurrence-race.test.ts` (create). This may be KEPT as a
  regression test if the bug reproduces, or DELETED if it does not (report which).
- Step 3 (only if reproduced): a minimal guard in `src/lib/server/tasks.ts` at the
  two sites.

**Out of scope**:

- Any change to the recurrence math (`src/lib/recurrence.ts`).
- Wrapping unrelated ops in transactions (that is Plan 011).
- Building a distributed lock or job queue — the guard, if needed, is a single
  conditional write, nothing more.

## Git workflow

- Work on branch `dev` (already the current branch).
- If a fix lands: conventional commit, e.g.
  `fix(tasks): guard recurrence spawn against concurrent completes`.
- If NO fix (didn't reproduce): commit nothing OR commit the repro test as a
  documented regression guard with a message like
  `test(tasks): concurrent-complete recurrence race does not reproduce`.
- Do NOT push or open a PR unless the operator instructs it.

## Steps

### Step 1: Read both sites and confirm the check-then-act shape

Open `src/lib/server/tasks.ts`, locate `setTaskStatusService` and
`updateTaskService`, and confirm both match the excerpts above: `existing` is read
once at the top, the completing-transition decision uses that snapshot, and the
spawn `insert` happens after an `await` with no re-read of the current status.

**Verify**: quote back the two `wasCompleted`/`wasDone` lines and the guarding
`if (... && !wasCompleted && existing.recurrence)` conditions in your report.

### Step 2: Attempt to reproduce the double-spawn

Create `tests/integration/recurrence-race.test.ts`, modeled structurally on
`tests/integration/task-mutations.test.ts` (copy its `beforeAll` sign-in, `api()`
wrapper, `ensureAuth()`, `createProject`, `afterAll`). The test:

1. `createProject(...)` → projectId.
2. `POST /api/tasks` `{ projectId, title: unique, dueDate: '2026-01-01' }` → task id.
3. `PATCH /api/tasks/{id}` `{ recurrence: 'weekly:1' }` → 200.
4. Fire TWO completes concurrently:
   ```ts
   const [a, b] = await Promise.all([
   	api(`/api/tasks/${id}`, { method: 'PATCH', json: { status: 'Completed' } }),
   	api(`/api/tasks/${id}`, { method: 'PATCH', json: { status: 'Completed' } })
   ]);
   ```
5. `GET /api/projects/{projectId}` → count tasks whose title equals the unique
   title. Correct behavior = exactly **2** (the original, now completed, + ONE
   spawned occurrence). A double-spawn = **3** (two spawned copies).
6. Assert the count. Run the test several times (recurrence races are
   probabilistic): wrap the fire-and-count in a loop of, say, 10 iterations (fresh
   task each iteration) and assert the count is 2 every time.

**Verify**: with `npm run dev` running and DB seeded, run the new test:
`npx vitest run tests/integration/recurrence-race.test.ts`.

- If the count is ALWAYS 2 across all iterations → the race does NOT reproduce
  (better-sqlite3's synchronous single-connection execution likely serializes the
  two completes so the second sees the first's committed status). **Report this
  result, DELETE the throwaway test (or keep it as a passing regression guard —
  your call, state which), and STOP. Do not make a code change.**
- If any iteration yields 3 → the race reproduces. Keep the test and proceed to
  Step 3.

### Step 3 (ONLY if Step 2 reproduced): Apply the minimal guard

Prefer the **conditional-write** guard — it needs no transaction and is dialect-
safe. The idea: make the status-completing UPDATE itself the gate, and only spawn
when THAT update actually transitioned the row (i.e. the row was not already in a
completed status). Concretely, re-read the row's status inside the same critical
section, or use an UPDATE whose WHERE clause requires the current status to be
non-completed, then key the spawn on `rowsAffected > 0`.

If Plan 011 (`withTransaction`) has landed, wrap the [re-read current status →
decide → update → spawn] sequence in a single `withTransaction` so the two
requests serialize on the write. Sketch (adapt to each site; do NOT change the
spawned-row shape):

```ts
await withTransaction(async (tx) => {
	// re-read the CURRENT status inside the tx (not the top-of-function snapshot)
	const [fresh] = await tx
		.select({ statusId: task.statusId })
		.from(task)
		.where(eq(task.id, taskId));
	const freshlyCompleted = eligible.find((s) => s.id === fresh?.statusId)?.category === 'completed';
	if (freshlyCompleted) return; // another request already completed it — do not spawn
	await tx.update(task).set({ statusId, updatedAt: new Date() }).where(eq(task.id, taskId));
	if (target.category === 'completed' && existing.recurrence) {
		// ...the existing spawn insert, via tx...
	}
});
```

If Plan 011 has NOT landed, DO NOT hand-roll a transaction here. Instead use a
conditional UPDATE and gate on its result — e.g. only mark completed when the
current status isn't already completed, and only spawn if that UPDATE changed a
row. Confirm how to read "rows affected" for the active driver before relying on
it (better-sqlite3 returns `changes`; drizzle surfaces it differently per driver)
— if you cannot determine this reliably, STOP and report rather than guessing.

Apply the SAME guard at BOTH Site 1 and Site 2. Keep side effects
(`dispatchEvent`, `broadcast`, `logActivity`) outside the critical section.

**Verify**: re-run the Step 2 repro test 10+ iterations → count is ALWAYS 2.
`npm run check` → exit 0. `npm run test:unit` → all pass.
`npm run test:integration` → all pass (existing recurrence + cascade tests
unaffected).

## Test plan

- `tests/integration/recurrence-race.test.ts` (create): fires two concurrent
  `PATCH ... { status: 'Completed' }` at a recurring task, asserts exactly one
  next occurrence is spawned (total 2 tasks with the title), looped ≥10×.
- If the race does not reproduce: the test passes as-is and documents the
  non-reproduction (keep it as a guard OR delete it — state which in your report).
- If a fix lands: the same test is the regression proof (fails pre-fix at the
  reproduced iteration, passes post-fix).
- Structural pattern to copy: `tests/integration/task-mutations.test.ts`.

## Done criteria

This is an investigation; "done" = a clear, evidence-backed report. ALL must hold:

- [ ] Step 1 confirmed (or refuted) that both sites are check-then-act, quoted in
      the report
- [ ] Step 2 repro test written and run ≥10 iterations against a live server; the
      observed task-count outcome (always 2, or sometimes 3) is reported
- [ ] IF reproduced: the guard is applied at BOTH sites, the repro test now always
      yields 2, `npm run check` exits 0, `npm run test:unit` + `test:integration`
      pass
- [ ] IF NOT reproduced: no code change to `tasks.ts`; report states the race did
      not reproduce and why (e.g. better-sqlite3 serialization), and the disposition
      of the throwaway test
- [ ] `plans/README.md` status row updated (DONE if fixed; DONE/REJECTED with a
      one-line "did not reproduce" note if not)

## STOP conditions

Stop and report back (do not improvise) if:

- The two sites don't match the "Current state" excerpts (drift), or Plan 003 has
  restructured them in a way you can't map to the analysis.
- You cannot reliably fire two genuinely concurrent completes (e.g. the test
  harness serializes requests) — report the limitation; the investigation is
  inconclusive rather than "no bug."
- The repro reproduces but you cannot determine the driver's "rows affected"
  semantics for a conditional-UPDATE guard AND Plan 011's `withTransaction` is not
  available — STOP; do not ship an unverified guard.
- Applying the guard changes any existing recurrence/cascade test's outcome — a
  guard must only prevent the DUPLICATE spawn, never suppress the legitimate one.

## Maintenance notes

- If this is fixed, the same check-then-act pattern may exist wherever a "spawn on
  first transition" decision is made — a reviewer should grep for other
  `!wasCompleted`/`!wasDone`-gated inserts.
- If NOT reproduced now, note that adopting postgres (ADR-050) or any future
  multi-connection/multi-process deployment would REMOVE better-sqlite3's implicit
  serialization and could make this race real — re-open this investigation if the
  deployment model changes.
- This plan intentionally does not add locking infrastructure; the guard is a
  single conditional write. Keep it that way.
