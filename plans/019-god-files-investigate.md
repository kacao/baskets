# Plan 019 (INVESTIGATE): Shrink the four "god files" — start with the server load's pure helpers

> **Executor instructions**: This is an INVESTIGATE plan, not a mechanical
> refactor. The first slice (Step 1) is concrete and shippable; Steps 2+ are a
> guided investigation whose output is a recommendation, not necessarily a big
> refactor. Run every verification command and confirm the expected result. If
> anything in "STOP conditions" occurs, stop and report. When done, update the
> status row in `plans/README.md` if that file exists (a reviewer may own the
> index — if so, skip it).
>
> **Drift check (run first)**:
>
> ```bash
> git diff --stat 3958dd6..HEAD -- \
>   "src/routes/(app)/projects/[id]/+page.server.ts" \
>   "src/routes/(app)/projects/[id]/+page.svelte" \
>   src/lib/components/TaskPanel.svelte \
>   src/lib/components/views/TableView.svelte src/lib/server/
> ```
>
> If any in-scope file changed since planning, compare the "Current state"
> excerpts against live code before proceeding; on a mismatch, treat it as a
> STOP condition. NOTE: at planning time `src/lib/server/tasks.ts` and
> `src/lib/components/TaskPanel.svelte` had UNCOMMITTED changes — re-read them.

## Status

- **Priority**: P3
- **Effort**: L
- **Risk**: MED
- **Category**: tech-debt
- **Confidence**: MEDIUM — whether the _large_ split pays off is a team-appetite
  call. The low-risk server-helper slice (Step 1) is worth doing regardless;
  everything beyond it is a recommendation to the team.
- **Depends on**: plans/014-*.md (the test harness for server-module unit tests)
  — Step 1 wants a unit test for the extracted helper.
- **Planned at**: commit `3958dd6`, 2026-07-12

## Why this matters

Four modules are an order of magnitude larger than the repo's view-component
median (~250–550 lines):

| File                                             | Lines |
| ------------------------------------------------ | ----- |
| `src/routes/(app)/projects/[id]/+page.svelte`    | 2243  |
| `src/lib/components/TaskPanel.svelte`            | 2061  |
| `src/routes/(app)/projects/[id]/+page.server.ts` | 1266  |
| `src/lib/components/views/TableView.svelte`      | 1209  |

(Verify with `wc -l` — see Step 0.) These are the highest-churn files in the
project, so their size is a recurring maintainability tax: every feature touches
them, review is slow, and merge conflicts concentrate here. This is a
maintainability cost, **not a hot bug** — nothing is broken.

The safest, most independent win is inside the SERVER load
(`+page.server.ts`): its `load` fans out ~20 queries and then does in-memory
re-scans that are genuinely PURE (input → output, no DB, no request state) and
therefore trivially extractable and unit-testable:

- `projectRollupText` (lines ~300–328) aggregates rollup chip values, using a
  `valueOf` that does `rollupValues.find(...)` per (task, field).
- the visible-user assembly (lines ~270–292) loops all task + project custom
  values to collect referenced person ids.

Pulling those into tested pure functions shrinks the load, makes the visibility
and rollup logic independently testable, and sets a pattern. When this lands,
the load is smaller and two pieces of previously-untested logic have tests.

**Explicit boundary**: this plan targets the server load's visibility/rollup
passes plus genuinely-independent extractions. It does NOT touch the three
client extractions the team already evaluated and deferred as low-value /
high-risk under ADR-049's cleanup: the `viewConfig` mutators in `+page.svelte`,
the rollup-resolver closure shared by TaskPanel/TableView, and the view-tab
drag→`use:sortable`. Do not propose or implement those.

## Current state

Files (roles):

- `src/routes/(app)/projects/[id]/+page.server.ts` — the project page `load` +
  all form actions; 1266 lines. Imports (already present):
  ```ts
  import {
  	decodeValue,
  	computeTaskRollup,
  	formatNumber,
  	type RollupConfig
  } from '$lib/customFields';
  import { /* ... */ projectAccessUserIds } from '$lib/server/permissions';
  ```
- `src/lib/customFields.ts` — client-safe pure helpers (`computeTaskRollup`,
  `formatNumber`, `decodeValue`, etc.) with unit tests in
  `tests/unit/customFields.test.ts` / `customFieldsRollup.test.ts`.
- `src/lib/server/` — the service layer (ADR-049): `tasks.ts`, `statuses.ts`,
  `labels.ts`, `milestones.ts`, `views.ts`, `customFields.ts`, `comments.ts`,
  `permissions.ts`. New tested server helpers belong here.

### The visible-user assembly (`+page.server.ts:270-292`)

```ts
// ADR-019: assignee pickers/groupings expose only users who can ACCESS this
// project — plus any user already referenced (assignee or person custom field)
// so existing values still resolve to a name. Don't leak the whole roster.
const visibleUserIds = await projectAccessUserIds(params.id, proj.workspaceId);
for (const tk of tasks) if (tk.assigneeId) visibleUserIds.add(tk.assigneeId);
for (const f of customFields) {
	if (f.type !== 'person') continue;
	for (const v of taskCustomValues) {
		if (v.fieldId !== f.id) continue;
		const ids = decodeValue({ type: 'person' }, v.value);
		if (Array.isArray(ids)) for (const id of ids) visibleUserIds.add(String(id));
	}
}
// project-entity person fields (header chips) resolve their user names too
for (const f of projectFields) {
	if (f.type !== 'person') continue;
	for (const v of projectCustomValues) {
		if (v.fieldId !== f.id) continue;
		const ids = decodeValue({ type: 'person' }, v.value);
		if (Array.isArray(ids)) for (const id of ids) visibleUserIds.add(String(id));
	}
}
const visibleUsers = users.filter((u) => visibleUserIds.has(u.id));
```

The `await projectAccessUserIds(...)` (a DB call) must STAY in the load; only the
PURE fold — "given a base id set + tasks + fields + values, collect all
referenced person ids" — is extractable. The nested `person`-field loops are
also O(fields × values) and could be simplified while extracting (a Map by
fieldId), but behavior must be preserved.

### The rollup chip pass (`+page.server.ts:300-328`)

```ts
const projectRollupText: Record<string, string> = {};
const projRollups = projectFields.filter((f) => f.type === 'rollup');
if (projRollups.length > 0) {
	const [rollupTasks, rollupValues] = await Promise.all([
		db
			.select({ id: task.id, parentId: task.parentId })
			.from(task)
			.where(eq(task.projectId, params.id)),
		db
			.select({
				taskId: taskCustomValue.taskId,
				fieldId: taskCustomValue.fieldId,
				value: taskCustomValue.value
			})
			.from(taskCustomValue)
			.innerJoin(task, eq(taskCustomValue.taskId, task.id))
			.where(eq(task.projectId, params.id))
	]);
	const valueOf = (tid: string, fid: string) => {
		const raw = rollupValues.find((v) => v.taskId === tid && v.fieldId === fid)?.value;
		const n = raw == null ? null : Number(raw);
		return n != null && Number.isFinite(n) ? n : null;
	};
	for (const f of projRollups) {
		const cfg = { ...(f.config as unknown as RollupConfig), relation: 'task' as const };
		const n = computeTaskRollup(cfg, '', { tasks: rollupTasks, taskDeps: [], valueOf });
		const target =
			customFields.find((t) => t.id === cfg.targetFieldId) ??
			projectFields.find((t) => t.id === cfg.targetFieldId);
		projectRollupText[f.id] =
			target && cfg.formula !== 'count' ? formatNumber(n, target.config) : String(n);
	}
}
```

The two `db.select(...)` queries must STAY in the load (they hit the DB). The
PURE part — "given `projRollups`, `rollupTasks`, `rollupValues`, `customFields`,
`projectFields`, compute `Record<fieldId, string>`" — is fully extractable and
testable. Note `valueOf` does a linear `rollupValues.find(...)` per (task,
field); the extracted helper MAY pre-index `rollupValues` into a
`Map<taskId+':'+fieldId, value>` for O(1) lookup — but ONLY if outputs stay
identical.

### Conventions

- Service/server helpers live in `src/lib/server/*.ts`; pure client-safe helpers
  in `src/lib/*.ts`. Because these two helpers use only already-loaded rows (no
  DB, no request), they can live in `src/lib/server/projectLoad.ts` (a new pure
  server module) — keep them server-side since they operate on server load data.
- Unit tests live in `tests/unit/*.test.ts`; model on
  `tests/unit/customFieldsRollup.test.ts` (it already exercises
  `computeTaskRollup`).
- ADR-049: domain logic belongs in the service layer as pure, testable
  functions — this extraction is consistent with that decision.

## Commands you will need

| Purpose        | Command                    | Expected on success           |
| -------------- | -------------------------- | ----------------------------- |
| Line counts    | `wc -l <files>`            | confirms the sizes above      |
| Typecheck/lint | `npm run check`            | exit 0, 0 errors, 0 warnings  |
| Unit tests     | `npm run test:unit`        | all pass                      |
| Integration    | `npm run test:integration` | all pass (needs dev server)   |
| E2E            | `npx playwright test`      | all pass (needs :5173 + seed) |
| Seed DB        | `npm run db:seed`          | idempotent seed               |
| Dev server     | `npm run dev`              | serves on :5173               |

Integration/e2e need a dev server on `:5173` and `npm run db:seed` first.

## Scope

**In scope** (Step 1 — the shippable slice):

- `src/lib/server/projectLoad.ts` (create — pure helpers)
- `src/routes/(app)/projects/[id]/+page.server.ts` (replace the two inline
  blocks with calls to the new helpers)
- `tests/unit/projectLoad.test.ts` (create)

**In scope** (Steps 2–3 — investigation output is a written recommendation, NOT
necessarily code):

- A findings note (in your final report) on whether/how to split
  `+page.svelte`, `TaskPanel.svelte`, `TableView.svelte`, and the rest of
  `+page.server.ts`.

**Out of scope** (do NOT touch):

- The three ADR-049-deferred client extractions: `viewConfig` mutators in
  `+page.svelte`, the rollup-resolver closure shared by TaskPanel/TableView, and
  the view-tab drag→`use:sortable`.
- Any DB query — the `await projectAccessUserIds(...)`, the two rollup
  `db.select(...)` calls, and every other query stay exactly where they are.
- Any change to the load's RETURN shape (`+page.svelte` and the views consume
  it — changing keys breaks them). `visibleUsers` and `projectRollupText` must
  come out byte-identical.

## Git workflow

- Branch: `advisor/019-server-load-helpers`
- Conventional commits, e.g.
  `refactor(project-load): extract pure rollup/visibility helpers + tests`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 0: Confirm the sizes and the excerpts

1. `wc -l "src/routes/(app)/projects/[id]/+page.svelte" \
"src/lib/components/TaskPanel.svelte" \
"src/routes/(app)/projects/[id]/+page.server.ts" \
src/lib/components/views/TableView.svelte` — confirm the four are near the
   sizes in the table (drift tolerance ±10%).
2. Open `+page.server.ts` around lines 270–328 and confirm the two excerpts
   above match. If they don't, STOP (drift).

**Verify**: excerpts match; sizes confirmed.

### Step 1: Extract the two pure helpers with unit tests (the shippable slice)

1. Create `src/lib/server/projectLoad.ts` with two PURE functions (no DB, no
   `params`, no `db` import). Suggested signatures — match the exact input row
   shapes used in the load:
   ```ts
   import {
   	decodeValue,
   	computeTaskRollup,
   	formatNumber,
   	type RollupConfig
   } from '$lib/customFields';

   type Field = { id: string; type: string; config: unknown; targetFieldId?: string };
   type CustomValue = { fieldId: string; value: string | null };

   /** Collect referenced person ids from task + project person-field values,
    *  seeded from the base access set. Pure — no DB. */
   export function collectVisibleUserIds(
   	base: Set<string>,
   	tasks: { assigneeId: string | null }[],
   	taskFields: Field[],
   	taskValues: (CustomValue & { taskId?: string })[],
   	projectFields: Field[],
   	projectValues: CustomValue[]
   ): Set<string> {
   	/* reproduce lines 274-291 exactly */
   }

   /** Compute the project rollup chip text map. Pure — the caller supplies the
    *  already-queried rollupTasks/rollupValues. */
   export function computeProjectRollupText(
   	projectFields: Field[],
   	customFields: Field[],
   	rollupTasks: { id: string; parentId: string | null }[],
   	rollupValues: { taskId: string; fieldId: string; value: string | null }[]
   ): Record<string, string> {
   	/* reproduce lines 304-327 exactly */
   }
   ```
   - Reproduce the logic BYTE-for-BYTE in observable output. The `valueOf`
     pre-indexing optimization is OPTIONAL and allowed ONLY if a test proves
     identical output.
2. In `+page.server.ts`:
   - Replace lines ~274–291 (the three `for` loops) with
     `const visibleUserIds = collectVisibleUserIds(await projectAccessUserIds(params.id, proj.workspaceId), tasks, customFields, taskCustomValues, projectFields, projectCustomValues);`
     Keep `const visibleUsers = users.filter((u) => visibleUserIds.has(u.id));`.
   - Replace the rollup `for (const f of projRollups) { ... }` block (keeping the
     two `db.select`/`Promise.all` queries in place) with
     `const projectRollupText = projRollups.length ? computeProjectRollupText(projRollups, customFields, rollupTasks, rollupValues) : {};`
     (adjust so `rollupTasks`/`rollupValues` are still queried when
     `projRollups.length > 0`).
3. Create `tests/unit/projectLoad.test.ts` (model on
   `tests/unit/customFieldsRollup.test.ts`) covering:
   - `collectVisibleUserIds`: base ids preserved; task `assigneeId` collected;
     task person-field ids collected (single + multi array); project person-field
     ids collected; non-person fields ignored; empty inputs → base unchanged.
   - `computeProjectRollupText`: a count formula (→ `String(n)`); a sum/avg with a
     target field (→ `formatNumber`); no rollup fields → `{}`; a rollup whose
     target is a project field vs a task field.

**Verify**:

- `npm run check` → exit 0, 0 errors, 0 warnings
- `npm run test:unit` → all pass, including new `projectLoad.test.ts`
- Manual: load a project page with rollup header chips and person custom fields;
  the chip values and the assignee picker roster are unchanged.
- If e2e exists: `npx playwright test` → all pass.

### Step 2 (INVESTIGATE): Assess the rest of `+page.server.ts`

Read the remaining ~1200 lines of `+page.server.ts`. Identify any OTHER pure,
DB-free folds that could move to `projectLoad.ts` the same way (list them with
line ranges). Do NOT extract anything that touches `db`, `locals`, `params`, or
`fail()`/`redirect()`. Produce a bulleted list of candidates + a one-line
risk note each. This step's deliverable is the list, not code.

**Verify**: a written list of candidate pure folds (or "none found").

### Step 3 (INVESTIGATE): Recommendation on the three large client files

For `+page.svelte` (2243), `TaskPanel.svelte` (2061), `TableView.svelte` (1209):
skim for SELF-CONTAINED, side-effect-free sub-pieces that could become child
components or `$lib` helpers WITHOUT crossing the three ADR-049-deferred
boundaries. For each, write: what it is, rough size, extraction risk
(LOW/MED/HIGH), and whether it's worth it. Be explicit that a full split is a
team-appetite call — recommend doing ONLY the Step 1 server slice unless the
team signals they want more.

**Verify**: a written recommendation (this is the investigate deliverable).

## Test plan

- `tests/unit/projectLoad.test.ts`: the cases listed in Step 1. Model on
  `tests/unit/customFieldsRollup.test.ts`.
- Verification: `npm run test:unit` → all pass including the new file;
  `npm run check` → exit 0.
- No new tests for Steps 2–3 (they produce recommendations, not code).

## Done criteria

Machine-checkable for the shippable slice (Step 1). ALL must hold:

- [ ] `src/lib/server/projectLoad.ts` exists with `collectVisibleUserIds` and
      `computeProjectRollupText`, neither importing `$lib/server/db`
- [ ] `tests/unit/projectLoad.test.ts` exists and passes
- [ ] `npm run check` exits 0 with 0 errors and 0 warnings
- [ ] `npm run test:unit` passes including the new file
- [ ] `+page.server.ts` line count dropped (`wc -l` lower than the ~1266 baseline)
- [ ] The load's return shape is unchanged (`visibleUsers` + `projectRollupText`
      byte-identical) — verified by the manual/e2e check
- [ ] No DB query was moved or removed (`git diff` shows queries in place)
- [ ] Steps 2 and 3 produced written recommendations in the final report
- [ ] `plans/README.md` status row updated (if that file exists)

## STOP conditions

Stop and report back (do not improvise) if:

- The excerpts at lines ~270–328 don't match live code (drift). Re-read; note
  that `tasks.ts`/`TaskPanel.svelte` had uncommitted changes at planning time.
- Extracting either helper would change the load's return shape or produce
  different `visibleUsers` / `projectRollupText` output. Prove identical output
  first (unit test); if you can't, STOP.
- An extraction candidate turns out to need `db`, `locals`, or `params` — it's
  not pure; leave it in the load and report.
- A step's verification fails twice after a reasonable fix attempt.
- You find yourself about to touch any of the three ADR-049-deferred client
  extractions — STOP; they are out of scope by design.

## Maintenance notes

- This is intentionally a SMALL first slice of a large problem. The MED
  confidence is about the _larger_ split, not Step 1 — Step 1 is low-risk and
  worth landing on its own.
- The extracted helpers are the pattern for future load-logic: keep pure folds
  in `src/lib/server/projectLoad.ts` with tests, keep queries in the `load`.
- Reviewer should scrutinize: (a) no DB call moved; (b) `visibleUsers` /
  `projectRollupText` outputs are provably identical (the tests should assert
  the exact strings); (c) if `valueOf` was pre-indexed, that a test covers the
  same (task, field) lookups.
- Follow-up explicitly deferred: splitting the three large client components is
  a team-appetite decision informed by Step 3's recommendation — do not start it
  without a green light.
