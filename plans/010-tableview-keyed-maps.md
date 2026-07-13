# Plan 010: Replace per-row full-array scans in TableView with $derived Maps

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If
> anything in "STOP conditions" occurs, stop and report — do not improvise. When
> done, update this plan's status row in `plans/README.md` if that file exists
> (do NOT create it).
>
> **Drift check (run first)**:
> `git diff --stat 3958dd6..HEAD -- src/lib/components/views/TableView.svelte src/lib/customFields.ts`
> If `TableView.svelte` changed since this plan was written, compare the "Current
> state" excerpts against live code before proceeding; on a mismatch treat it as
> a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `3958dd6`, 2026-07-12

## Why this matters

`TableView.svelte` (~1200 lines, the project's most-rendered view) resolves
almost every cell by scanning a full array **per row and per cell**:
`cfValue(taskId,fieldId)` does `taskCustomValues.find(...)` for each custom-field
cell; `userName`/`milestoneName` do `users.find`/`milestones.find` per row;
`labelsOf`/`depsOf` filter a join array then `.find` per element per row; and
`files.filter(f => f.taskId === t.id)` runs per row AND per subtask. For R rows ×
C custom-field columns over V stored values, cell resolution alone is O(R·C·V).
The table re-renders on every data change / realtime refetch. Building a handful
of `$derived` lookup Maps once (id→object and grouped-by-task) turns each cell
resolution into an O(1) `Map.get`, cutting render cost dramatically on large
projects with no behavior change.

## Current state

All line numbers are from `src/lib/components/views/TableView.svelte` at commit
`3958dd6`.

### Props (lines 41–85) — the source arrays

```ts
	let {
		tasks,
		allTasks = tasks,
		users,
		statuses,
		milestones,
		locations,
		labels,
		taskLabels,
		taskDeps,
		customFields = [],
		customFieldOptions = [],
		taskCustomValues = [],
		files = [],
		...
	}: {
		tasks: Task[];
		allTasks?: Task[];
		users: { id: string; name: string }[];
		statuses: Status[];
		milestones: { id: string; name: string }[];
		locations: Location[];
		labels: { id: string; name: string; color?: string | null; icon?: string | null }[];
		taskLabels: { taskId: string; labelId: string }[];
		taskDeps: { taskId: string; dependsOnId: string }[];
		customFields?: CustomFieldDef[];
		customFieldOptions?: CustomFieldOption[];
		taskCustomValues?: { taskId: string; fieldId: string; value: string }[];
		files?: FileRef[];
		...
	} = $props();
```

### The linear-scan helpers (lines 165–167, 270–279)

```ts
const cfOptions = (fieldId: string) => customFieldOptions.filter((o) => o.fieldId === fieldId);
const cfValue = (taskId: string, fieldId: string) =>
	taskCustomValues.find((v) => v.taskId === taskId && v.fieldId === fieldId)?.value ?? null;
```

```ts
const cat = (id: string) => statuses.find((s) => s.id === id)?.category ?? 'backlog';
const isDone = (t: Task) => cat(t.statusId) === 'completed';
const subsOf = (id: string) => tasks.filter((t) => t.parentId === id);
const userName = (id: string | null) => users.find((u) => u.id === id)?.name ?? null;
const milestoneName = (id: string | null) => milestones.find((m) => m.id === id)?.name ?? null;
const labelsOf = (taskId: string) =>
	taskLabels
		.filter((l) => l.taskId === taskId)
		.map((l) => labels.find((x) => x.id === l.labelId))
		.filter(Boolean);
const taskLabelIds = (taskId: string) =>
	taskLabels.filter((l) => l.taskId === taskId).map((l) => l.labelId);
const depsOf = (taskId: string) =>
	taskDeps
		.filter((d) => d.taskId === taskId)
		.map((d) => tasks.find((t) => t.id === d.dependsOnId))
		.filter(Boolean);
```

`cfValue` is also consumed inside `rollupText` (line 168–181) via a local
`valueOf` closure — swapping `cfValue`'s implementation keeps `rollupText`
correct automatically.

### The per-cell render call sites (parent row: lines 635–648; sub-row: 690–708)

Parent-row custom-field cell:

```svelte
{#each cfCols as c (c.key)}
	{#if show(c.key)}
		<td>
			<CustomFieldValue
				field={c.field}
				options={cfOptions(c.field.id)}
				value={cfValue(t.id, c.field.id)}
				rollupText={rollupText(t.id, c.field)}
				mode="cell"
				{users}
				{locations}
				tasks={allTasks}
				files={files.filter((f) => f.taskId === t.id)}
			/>
		</td>
	{/if}
{/each}
```

Sub-row uses the same shape with `s.id` (lines 697, 703) and
`files.filter((f) => f.taskId === s.id)`.

Other per-row consumers in markup: `userName(s.assigneeId)` (line 674),
`milestoneName(s.milestoneId)` (line 678), `labelsOf(s.id)` (line 686) — and the
equivalent parent-row usages elsewhere in the template (search the file for
`userName(`, `milestoneName(`, `labelsOf(`, `depsOf(`).

### Svelte 5 reactivity constraint (CRITICAL — this is why Risk is MED)

The lookup Maps MUST be declared with `$derived`/`$derived.by`, never plain
`const new Map(...)`, so they invalidate when their source arrays change (an
edit → `invalidateAll()` → new `taskCustomValues`/`taskLabels`/... props). A
plain const map computes once and leaves **stale cells after an edit**. The
existing `cfCols` derived (lines 160–164) is the in-file exemplar of a correct
`$derived`. If any cell shows stale data after an edit during manual testing,
that is the failure mode to catch (see STOP conditions).

## Commands you will need

| Purpose    | Command             | Expected on success         |
| ---------- | ------------------- | --------------------------- |
| Typecheck  | `npm run check`     | exit 0, 0 errors/warnings   |
| Unit tests | `npm run test:unit` | all pass (416 tests)        |
| Dev server | `npm run dev`       | serves on :5173 (manual QA) |

## Scope

**In scope**:

- `src/lib/components/views/TableView.svelte` — the only file to modify.

**Out of scope** (do NOT touch — list as follow-ups only):

- `src/lib/components/views/ListView.svelte` and
  `src/lib/components/views/BoardView.svelte` — they share the same
  linear-scan shape but render far fewer rows; a separate follow-up plan can
  apply the identical treatment. Do NOT change them here.
- `src/lib/customFields.ts` and `CustomFieldValue.svelte` — the cell component's
  props stay identical; you only change how TableView _computes_ the values it
  passes.
- Any change to what CustomFieldValue receives (same `field`/`options`/`value`/
  `rollupText`/`users`/`locations`/`tasks`/`files` props) — output must be
  byte-identical, only faster.

## Git workflow

- Branch `dev` (or `advisor/010-tableview-keyed-maps` off it).
- Conventional commit, e.g. `perf(table): resolve TableView cells via $derived maps`.
- Do NOT push or open a PR unless instructed.

## Steps

Order the steps so the file typechecks after each one. Add the maps first
(unused is fine), then switch call sites.

### Step 1: Add the $derived lookup maps

Near the existing helpers (after `cfCols`, ~line 164, and before/around the
current `cfValue`/`userName` definitions), add:

```ts
// O(1) lookup maps (must be $derived so they invalidate on data change).
const valueByTaskField = $derived(
	new Map(taskCustomValues.map((v) => [`${v.taskId}:${v.fieldId}`, v.value]))
);
const optionsByField = $derived.by(() => {
	const m = new Map<string, CustomFieldOption[]>();
	for (const o of customFieldOptions) {
		const arr = m.get(o.fieldId) ?? [];
		arr.push(o);
		m.set(o.fieldId, arr);
	}
	return m;
});
const userById = $derived(new Map(users.map((u) => [u.id, u])));
const milestoneById = $derived(new Map(milestones.map((m) => [m.id, m])));
const labelById = $derived(new Map(labels.map((l) => [l.id, l])));
const taskById = $derived(new Map(allTasks.map((t) => [t.id, t])));
const labelsByTask = $derived.by(() => {
	const m = new Map<string, typeof labels>();
	for (const tl of taskLabels) {
		const lab = labels.find; // placeholder — replaced below
	}
	return m;
});
```

Do NOT keep the broken `labelsByTask` placeholder above — write it correctly as:

```ts
const labelIdsByTask = $derived.by(() => {
	const m = new Map<string, string[]>();
	for (const tl of taskLabels) {
		const arr = m.get(tl.taskId) ?? [];
		arr.push(tl.labelId);
		m.set(tl.taskId, arr);
	}
	return m;
});
const depIdsByTask = $derived.by(() => {
	const m = new Map<string, string[]>();
	for (const d of taskDeps) {
		const arr = m.get(d.taskId) ?? [];
		arr.push(d.dependsOnId);
		m.set(d.taskId, arr);
	}
	return m;
});
const filesByTask = $derived.by(() => {
	const m = new Map<string, FileRef[]>();
	for (const f of files) {
		if (f.taskId == null) continue;
		const arr = m.get(f.taskId) ?? [];
		arr.push(f);
		m.set(f.taskId, arr);
	}
	return m;
});
```

(`FileRef`, `CustomFieldOption` are already imported/typed in this file — reuse
the existing type names; `grep -n "CustomFieldOption\|FileRef" src/lib/components/views/TableView.svelte`
to confirm.)

**Verify**: `npm run check` → exit 0, 0 errors/warnings (maps unused so far is OK;
remove the broken placeholder block before checking).

### Step 2: Rewrite the helper functions to read the maps

Replace the linear-scan helper bodies (keep the same names + signatures so no
call site needs renaming):

```ts
const cfOptions = (fieldId: string) => optionsByField.get(fieldId) ?? [];
const cfValue = (taskId: string, fieldId: string) =>
	valueByTaskField.get(`${taskId}:${fieldId}`) ?? null;
const userName = (id: string | null) => (id == null ? null : (userById.get(id)?.name ?? null));
const milestoneName = (id: string | null) =>
	id == null ? null : (milestoneById.get(id)?.name ?? null);
const labelsOf = (taskId: string) =>
	(labelIdsByTask.get(taskId) ?? []).map((id) => labelById.get(id)).filter(Boolean);
const taskLabelIds = (taskId: string) => labelIdsByTask.get(taskId) ?? [];
const depsOf = (taskId: string) =>
	(depIdsByTask.get(taskId) ?? []).map((id) => taskById.get(id)).filter(Boolean);
```

Leave `cat`, `isDone`, `subsOf` as they are (statuses/subs are small and/or
already fine; not part of this plan's hot path — though you MAY add a
`statusById` map for `cat` if trivial, it is optional).

Note `labelsOf`/`depsOf` previously used `tasks.find`/`labels.find`; the map
versions use `taskById` (built from `allTasks`, matching the render which passes
`tasks={allTasks}`) and `labelById`. Confirm the original `depsOf` resolved
against `tasks` (line 279) — it did; using `allTasks` is a superset and safe for
resolving a dependency title (a dep may point at a filtered-out task). If you
want a byte-identical result, build `taskById` from `tasks` instead of
`allTasks`; prefer `allTasks` so filtered-out deps still resolve. Pick `allTasks`
and note it.

**Verify**: `npm run check` → exit 0, 0 errors/warnings.

### Step 3: Switch the per-cell `files.filter(...)` render call sites to the map

At the parent-row cell (line 647) and sub-row cell (line 703), replace
`files={files.filter((f) => f.taskId === t.id)}` /
`files={files.filter((f) => f.taskId === s.id)}` with:

```svelte
files={filesByTask.get(t.id) ?? []}
```

and

```svelte
files={filesByTask.get(s.id) ?? []}
```

The `cfValue(...)`, `cfOptions(...)`, `userName(...)`, `milestoneName(...)`,
`labelsOf(...)`, `depsOf(...)` call sites in the markup need NO edit — they call
the same-named helpers you rewrote in Step 2.

**Verify**:

- `npm run check` → exit 0, 0 errors/warnings.
- `grep -n "\.find(" src/lib/components/views/TableView.svelte` → the cf/user/
  milestone/label/dep resolution `.find(`s are gone (a residual `.find` in
  unrelated code like `statuses.find` inside `cat` is acceptable).
- `grep -n "files.filter" src/lib/components/views/TableView.svelte` → the two
  per-cell `files.filter` call sites are gone.

### Step 4: Manual reactivity + parity check (REQUIRED — Risk MED)

Start the dev server (`npm run dev`), open a project's Table view that has:
custom fields (at least one `select`/`person`/`task` field with a column shown),
labels on tasks, assignees, milestones, and a task with a file attachment.

Confirm:

1. Every cell renders the same values as before (custom fields, assignee names,
   milestone names, label chips, dependency badges, file counts).
2. **Edit a task** (change status/assignee/a custom-field value from the pane or
   inline) → the corresponding table cell updates immediately. Stale cells after
   an edit = the maps aren't reactive → STOP.
3. Expand a parent row → sub-row custom-field cells + file lists render correctly.

## Test plan

- No new automated tests required (this view has no dedicated unit test; its
  helpers are inline). `npm run test:unit` (416 tests) is the regression gate for
  shared `$lib` helpers.
- The load-bearing verification is the **manual parity + reactivity check in
  Step 4** — a table with custom fields, labels, and files must render
  identically and update live after an edit.
- If a Playwright e2e for the table exists (`grep -rln "TableView\|table-view" tests/`),
  run it: `npm run test:e2e` (needs dev server on :5173 + `npm run db:seed`).

## Done criteria

ALL must hold:

- [ ] The 8-ish `$derived`/`$derived.by` maps exist (reactive, no plain `const new Map`)
- [ ] `cfValue`/`cfOptions`/`userName`/`milestoneName`/`labelsOf`/`taskLabelIds`/
      `depsOf` read from maps (no full-array `.find`/`.filter` in their bodies)
- [ ] The two per-cell `files.filter(...)` call sites use `filesByTask.get(...)`
- [ ] `npm run check` exits 0, 0 errors/warnings
- [ ] `npm run test:unit` passes (416 tests)
- [ ] Step 4 manual check: cells render identically AND update live after an edit
- [ ] Only `src/lib/components/views/TableView.svelte` modified (`git status --short`)

## STOP conditions

Stop and report if:

- The "Current state" excerpts don't match live `TableView.svelte` (drift).
- After the change a table cell shows **stale data after an edit** (a map wasn't
  `$derived`) and you can't fix it by converting the offending map to
  `$derived`/`$derived.by` — revert and report; broken reactivity is worse than
  the slow scan.
- The cell output visibly differs from before (missing labels, wrong assignee,
  empty custom-field cells) — a map key mismatch; revert the offending helper.
- The change appears to require touching `CustomFieldValue.svelte`,
  `customFields.ts`, ListView, or BoardView — those are out of scope; stop.

## Maintenance notes

- ListView.svelte and BoardView.svelte carry the identical linear-scan shape
  (lower row counts). A follow-up plan should apply the same map treatment there.
- Any new per-row resolver added to TableView should follow this pattern (build a
  `$derived` map, `.get` in the helper) rather than reintroducing `.find`/`.filter`.
- Reviewer should scrutinize: (a) every map is `$derived`, not a plain const;
  (b) `taskById` is built from `allTasks` (so a filtered-out dependency target
  still resolves), matching the `tasks={allTasks}` prop passed to CustomFieldValue;
  (c) the composite key format `` `${taskId}:${fieldId}` `` is used consistently
  for `valueByTaskField` (ids are UUIDs, so `:` cannot collide).
