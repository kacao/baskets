# Plan 016: Consolidate duplicated logic across the six view components

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` if that file exists (a reviewer may own the index — if
> so, skip it).
>
> **Drift check (run first)**:
>
> ```bash
> git diff --stat 3958dd6..HEAD -- \
>   src/lib/components/views/ src/lib/components/TaskPanel.svelte
> ```
>
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: L
- **Risk**: MED
- **Category**: tech-debt
- **Depends on**: plans/014-*.md recommended first (characterization tests for the
  view components — see "Why this matters"). This plan can start at Step 1
  without 014, but Steps 2 and 3 are much safer with those tests in place.
- **Planned at**: commit `3958dd6`, 2026-07-12

## Why this matters

The six view components in `src/lib/components/views/` (TableView, BoardView,
ListView, DashboardView, CalendarView, TimelineView — FlowView and MapView are
the odd ones out) each re-implement the same three pieces of logic by
copy-paste, and the copies have already **drifted apart**:

1. A `fmtDate` helper — identical in four files, but BoardView silently uses a
   different format (`MM-DD` vs `YYYY-MM-DD`).
2. The `?task=` side-pane "back stack" drill-down navigation — the same ~45-line
   block (state + two `$effect`s + `navTask`/`navBack`/`openDetail`) pasted into
   all six views.
3. The group-by bucket builder (status / milestone / assignee / label / due +
   `_none` bucket + `hideEmptyGroups`) — independently reimplemented in
   TableView, ListView, and BoardView with per-view drift (e.g. Board's
   swimlanes have no `due` bucket).

The cost: a bug fix or new grouping option must be applied in three-to-six
places and is easy to miss, which is exactly how the drift above happened.
Consolidating reduces the surface and prevents future divergence. Because this
touches user-visible grouping and navigation, characterization tests (plan 014)
let the executor prove behavior is unchanged.

**This plan is deliberately NOT any of the three extractions the team already
evaluated and deferred as low-value / high-risk under ADR-049's cleanup pass:**
the `viewConfig` mutators in `+page.svelte`, the rollup-resolver closure shared
by TaskPanel/TableView, and the view-tab drag→`use:sortable`. Do not touch
those. This plan targets `fmtDate`, the back-stack nav, and the group-by
builder only.

## Current state

Files (roles):

- `src/lib/components/views/TableView.svelte` — table view; has `fmtDate`, back-stack, and the group-by builder
- `src/lib/components/views/BoardView.svelte` — board/swimlane view; `fmtDate` (DIFFERENT format), back-stack, swimlane group builder
- `src/lib/components/views/ListView.svelte` — list view; `fmtDate`, back-stack, group-by builder
- `src/lib/components/views/DashboardView.svelte` — dashboard; `fmtDate` only (no grouping)
- `src/lib/components/views/CalendarView.svelte` — calendar; back-stack (no `fmtDate`, uses its own calendar math)
- `src/lib/components/views/TimelineView.svelte` — timeline; back-stack
- `src/lib/components/views/FlowView.svelte` — flow graph; back-stack (client-only)
- `src/lib/components/TaskPanel.svelte` — task edit pane; has an identical `fmtDate` copy
- `src/lib/paneUrl.ts` — existing helper module exporting `setPaneUrl` / `readPaneParam`; the back-stack effects already import from here

### `fmtDate` copies

Four are byte-identical. `TaskPanel.svelte:289`, `TableView.svelte:281`,
`ListView.svelte:153`, `DashboardView.svelte:43` all read:

```ts
function fmtDate(d: Date | string | null) {
	if (!d) return null;
	return new Date(d).toISOString().slice(0, 10);
}
```

`BoardView.svelte:253` is **different** — it slices `(5, 10)` for a compact
`MM-DD`:

```ts
function fmtDate(d: Date | string | null) {
	if (!d) return null;
	return new Date(d).toISOString().slice(5, 10); // MM-DD, Linear-compact
}
```

So the shared util must support BOTH forms (see Step 1 — do not "fix" Board to
the long form; that would change its visible output).

### Back-stack drill-down nav (all six views)

`CalendarView.svelte:70-114` is the reference copy (BoardView.svelte:134-161 is
the same block plus the extra board state interleaved):

```ts
// split pane: ?task= deep-links a task open
let selectedId = $state<string | null>(page.url.searchParams.get('task'));
// nav history for in-pane task→task navigation (sub-task/cf link/dep/mention);
// the top is the "← back" target, reset on any fresh open from outside the pane
let backStack = $state<string[]>([]);
// keep the pane in sync with browser back/forward to a ?task= link, without
// fighting user clicks (effect tracks the URL only, never selectedId)
let lastTaskParam = $state(page.url.searchParams.get('task'));
$effect(() => {
	const fromUrl = readPaneParam('task');
	if (fromUrl !== untrack(() => lastTaskParam)) {
		lastTaskParam = fromUrl;
		selectedId = fromUrl;
		backStack = [];
	}
});
$effect(() => {
	const id = selectedId;
	if (id !== untrack(() => lastTaskParam)) {
		lastTaskParam = id;
		setPaneUrl({ task: id });
	}
});
const selected = $derived(allTasks.find((t) => t.id === selectedId) ?? null);

function openDetail(t: Task) {
	selectedId = selectedId === t.id ? null : t.id;
	backStack = [];
}
function navTask(id: string) {
	if (id === selectedId) return;
	if (selectedId) backStack = [...backStack, selectedId];
	selectedId = id;
}
function navBack() {
	selectedId = backStack[backStack.length - 1] ?? null;
	backStack = backStack.slice(0, -1);
}
const backTask = $derived(
	backStack.length ? (allTasks.find((t) => t.id === backStack[backStack.length - 1]) ?? null) : null
);
```

All six views `import { setPaneUrl, readPaneParam } from '$lib/paneUrl';` and
`import { untrack } from 'svelte'` and read `page` from `$app/state`. Confirmed
present in: CalendarView, BoardView, ListView, FlowView, TimelineView,
TableView.

**Important nuance**: the two `$effect`s and `untrack` reads are load-bearing
(ADR-055 — reading `page.url` directly instead of `readPaneParam`, or tracking
`lastTaskParam`, reintroduces the "clicking a pane input closes the pane" bug).
Any shared helper MUST preserve the `untrack` sentinel pattern and use
`readPaneParam`/`setPaneUrl` exactly as above.

### Group-by builder (TableView / ListView / BoardView)

TableView.svelte:355-399 (the `groups` derived) and ListView.svelte:164-215
(`dueBuckets` + `groups`) are near-identical. ListView.svelte:166-190 defines
the `due` buckets:

```ts
type Group = { key: string; title: string; tasks: Task[] };

function dueBuckets(rows: Task[]): Group[] {
	const start = new Date();
	start.setHours(0, 0, 0, 0);
	const today = start.getTime();
	const week = today + 7 * 86400000;
	const b: Record<string, Task[]> = { overdue: [], today: [], week: [], later: [], none: [] };
	for (const t of rows) {
		if (!t.dueDate) {
			b.none.push(t);
			continue;
		}
		const ts = new Date(new Date(t.dueDate).setHours(0, 0, 0, 0)).getTime();
		if (ts < today) b.overdue.push(t);
		else if (ts === today) b.today.push(t);
		else if (ts < week) b.week.push(t);
		else b.later.push(t);
	}
	return [
		{ key: 'overdue', title: $i18n('Overdue'), tasks: b.overdue },
		{ key: 'today', title: $i18n('Today'), tasks: b.today },
		{ key: 'week', title: $i18n('Next 7 days'), tasks: b.week },
		{ key: 'later', title: $i18n('Later'), tasks: b.later },
		{ key: 'none', title: $i18n('No due date'), tasks: b.none }
	];
}
```

ListView.svelte:192-215 and TableView.svelte:355-399 both build the same
status/milestone/assignee/label/`_none` groups with the SAME strings
(`'No milestone'`, `'Unassigned'`, `'No label'`) and end with
`hideEmptyGroups ? g.filter((x) => x.tasks.length > 0) : g`.

**The DRIFT to reconcile**: BoardView builds _swimlanes_ (BoardView.svelte:87-126)
over `milestone | assignee | label | status` only — it has **no `due` bucket**
and, for `label`, its cross-lane drag changes status/position only (labels are
multi-value). BoardView's shape is `{ key, name }` (a `name` field, not
`title`) and it plots lanes differently (`inLane` predicate). So BoardView is
only _partially_ unifiable — see the STOP condition and Step 2 scope note.

### Conventions that apply

- Svelte 5 runes only: `$props`/`$state`/`$derived`/`$effect`/`untrack` — no
  `export let` / `$:`. Shared pure helpers live in `$lib` (client-safe TS
  modules), imported by the components.
- i18n: user-facing strings go through `$t(...)` / the `$i18n` store alias in
  these components. A pure helper in `$lib` that produces group _titles_ must
  NOT bake in translations — return stable string keys and let the component
  wrap them with `$i18n(...)`, OR accept a `t` function argument. (Grep each
  view for how it imports the translate fn: some alias it as `$i18n`, some as
  `$t` — check before assuming.)
- Existing pure helpers with unit tests live in `src/lib/` and
  `tests/unit/*.test.ts` (e.g. `src/lib/customFields.ts` +
  `tests/unit/customFields.test.ts`). Model new helpers + tests on that pair.

## Commands you will need

| Purpose        | Command                    | Expected on success           |
| -------------- | -------------------------- | ----------------------------- |
| Typecheck/lint | `npm run check`            | exit 0, 0 errors, 0 warnings  |
| Unit tests     | `npm run test:unit`        | all pass                      |
| Integration    | `npm run test:integration` | all pass (needs dev server)   |
| E2E            | `npx playwright test`      | all pass (needs :5173 + seed) |
| Seed DB        | `npm run db:seed`          | "seeded" / idempotent         |
| Dev server     | `npm run dev`              | serves on :5173               |

Integration/e2e need a dev server on `:5173` and `npm run db:seed` run first.

## Suggested executor toolkit

- If plan 014's characterization tests exist, run them before AND after each
  step and diff — they are your behavior oracle for this refactor.

## Scope

**In scope** (modify only these):

- `src/lib/date.ts` (create — Step 1)
- `src/lib/taskGroups.ts` (create — Step 2)
- `src/lib/paneNav.svelte.ts` (create — Step 3; `.svelte.ts` so it may use runes)
- `src/lib/components/views/TableView.svelte`
- `src/lib/components/views/BoardView.svelte`
- `src/lib/components/views/ListView.svelte`
- `src/lib/components/views/DashboardView.svelte`
- `src/lib/components/views/CalendarView.svelte`
- `src/lib/components/views/TimelineView.svelte`
- `src/lib/components/views/FlowView.svelte`
- `src/lib/components/TaskPanel.svelte` (Step 1 only — the `fmtDate` copy)
- `tests/unit/date.test.ts` (create)
- `tests/unit/taskGroups.test.ts` (create)

**Out of scope** (do NOT touch, even though they look related):

- The three ADR-049-deferred extractions: `viewConfig` mutators in
  `src/routes/(app)/projects/[id]/+page.svelte`, the rollup-resolver closure
  shared by TaskPanel/TableView, and the view-tab drag→`use:sortable`. These
  were evaluated and intentionally left alone.
- `src/lib/paneUrl.ts` — the URL read/write primitives are correct; reuse them,
  do not rewrite them.
- MapView.svelte — no `fmtDate`/group-by/back-stack duplication in scope here.
- Any change to visible grouping order, bucket labels, or date output formats.
  This is a pure de-duplication; output must be byte-for-byte identical.

## Git workflow

- Branch: `advisor/016-view-consolidation`
- Conventional commits, one per step, e.g.
  `refactor(views): extract shared fmtDate to $lib/date`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Extract `fmtDate` into `$lib/date.ts` (independently shippable)

This step is zero-risk and can ship on its own — do it first, verify, and
optionally stop here if time-boxed.

1. Create `src/lib/date.ts`:
   ```ts
   /** ISO date, YYYY-MM-DD, or null. */
   export function fmtDate(d: Date | string | null): string | null {
   	if (!d) return null;
   	return new Date(d).toISOString().slice(0, 10);
   }

   /** Compact MM-DD (Linear-style), or null. */
   export function fmtDateShort(d: Date | string | null): string | null {
   	if (!d) return null;
   	return new Date(d).toISOString().slice(5, 10);
   }
   ```
2. In `TaskPanel.svelte`, `TableView.svelte`, `ListView.svelte`,
   `DashboardView.svelte`: delete the local `function fmtDate(...)` and add
   `import { fmtDate } from '$lib/date';` alongside the other `$lib` imports.
   Call sites are unchanged (`fmtDate(...)`).
3. In `BoardView.svelte`: delete the local `fmtDate`, import
   `import { fmtDateShort as fmtDate } from '$lib/date';` (aliased so its call
   sites stay `fmtDate(...)` and the MM-DD output is preserved). Do NOT change
   Board to the long format.
4. Create `tests/unit/date.test.ts` (model on `tests/unit/files.test.ts`
   structure) covering: `null` → `null`; a `Date` and an ISO string →
   `'YYYY-MM-DD'` for `fmtDate` and `'MM-DD'` for `fmtDateShort`.

**Verify**:

- `grep -rn "function fmtDate" src/lib/components/` → **no matches**
- `npm run check` → exit 0, 0 errors, 0 warnings
- `npm run test:unit` → all pass, including the new `date.test.ts`

### Step 2: Unify the group-by builder into `$lib/taskGroups.ts`

Biggest payoff and highest risk — do this only with characterization tests (or
manual per-view verification) in place.

1. Create `src/lib/taskGroups.ts` exporting a pure builder that reproduces the
   TableView/ListView `groups` derived EXACTLY, including the `due` buckets and
   the `hideEmptyGroups` filter. Suggested shape:
   ```ts
   export type TaskGroup<T> = { key: string; title: string; tasks: T[] };
   export type GroupBy = 'status' | 'milestone' | 'assignee' | 'due' | 'label';

   export interface GroupCtx<T> {
   	statuses: { id: string; name: string }[];
   	milestones: { id: string; name: string }[];
   	users: { id: string; name: string }[];
   	labels: { id: string; name: string }[];
   	labelIdsOf: (taskId: string) => string[];
   	// title translator injected by the caller (keeps i18n in the component)
   	t: (s: string) => string;
   	now?: () => number; // injectable for deterministic `due` tests
   }

   export function groupTasks<
   	T extends {
   		id: string;
   		statusId: string;
   		milestoneId: string | null;
   		assigneeId: string | null;
   		dueDate: Date | string | null;
   	}
   >(rows: T[], groupBy: GroupBy | null, ctx: GroupCtx<T>, hideEmpty: boolean): TaskGroup<T>[];
   ```
   - Reproduce the `_none` buckets and the exact titles: `'No milestone'`,
     `'Unassigned'`, `'No label'`, and the due titles `'Overdue' / 'Today' /
'Next 7 days' / 'Later' / 'No due date'` — passed through `ctx.t(...)`.
   - `null` groupBy → `[{ key: '_all', title: '', tasks: rows }]`.
   - End with `hideEmpty ? g.filter((x) => x.tasks.length > 0) : g`.
   - Use `ctx.now?.() ?? Date.now()` for the `due` reference time.
2. Rewrite TableView's and ListView's `groups` derived to call `groupTasks(...)`,
   passing `labelIdsOf` = their existing `taskLabelIds` closure and `t` = their
   translate fn. Keep every other line (rendering, snippets) untouched.
3. **BoardView**: do NOT force Board through `groupTasks` if its swimlane shape
   (`{ key, name }`, `inLane` predicate, no `due`) can't be expressed without
   changing behavior. Instead, ONLY reuse the pieces that are truly identical
   (e.g. the `_none` label strings). If Board can't be unified cleanly, leave
   its `lanes`/`inLane` as-is and note it in "Maintenance notes". Partial reuse
   is the correct outcome — do not distort Board to fit.
4. Create `tests/unit/taskGroups.test.ts` covering each `groupBy` value, the
   `_none` bucket, `hideEmpty` true/false, the multi-label task-in-multiple-
   groups case, and the five `due` buckets (inject `now` for determinism).

**Verify**:

- `npm run check` → exit 0, 0 errors, 0 warnings
- `npm run test:unit` → all pass, including new `taskGroups.test.ts`
- Manually (or via plan-014 tests): open a project, switch a Table view and a
  List view through each Group by option (status/milestone/assignee/due/label)
  and toggle "Hide empty groups" — the groups, order, counts, and titles are
  identical to before. If plan 014 tests exist:
  `npx playwright test` → all pass.

### Step 3: Extract the back-stack drill-nav into `$lib/paneNav.svelte.ts`

1. Create `src/lib/paneNav.svelte.ts` (the `.svelte.ts` extension lets it use
   runes) exporting a factory that returns the same reactive surface the views
   use today. It MUST preserve the ADR-055 invariants: read the URL param via
   `readPaneParam('task')`, write via `setPaneUrl({ task: id })`, and read the
   `lastTaskParam` sentinel via `untrack(...)` in BOTH effects. Suggested shape:
   ```ts
   import { untrack } from 'svelte';
   import { setPaneUrl, readPaneParam } from '$lib/paneUrl';

   export function createPaneNav<T extends { id: string }>(getAllTasks: () => T[]) {
   	let selectedId = $state<string | null>(readPaneParam('task'));
   	let backStack = $state<string[]>([]);
   	let lastTaskParam = $state<string | null>(readPaneParam('task'));
   	$effect(() => {
   		const fromUrl = readPaneParam('task');
   		if (fromUrl !== untrack(() => lastTaskParam)) {
   			lastTaskParam = fromUrl;
   			selectedId = fromUrl;
   			backStack = [];
   		}
   	});
   	$effect(() => {
   		const id = selectedId;
   		if (id !== untrack(() => lastTaskParam)) {
   			lastTaskParam = id;
   			setPaneUrl({ task: id });
   		}
   	});
   	return {
   		get selectedId() {
   			return selectedId;
   		},
   		set selectedId(v: string | null) {
   			selectedId = v;
   		},
   		get selected() {
   			return getAllTasks().find((t) => t.id === selectedId) ?? null;
   		},
   		get backTask() {
   			return backStack.length
   				? (getAllTasks().find((t) => t.id === backStack[backStack.length - 1]) ?? null)
   				: null;
   		},
   		openDetail(t: T) {
   			selectedId = selectedId === t.id ? null : t.id;
   			backStack = [];
   		},
   		navTask(id: string) {
   			if (id === selectedId) return;
   			if (selectedId) backStack = [...backStack, selectedId];
   			selectedId = id;
   		},
   		navBack() {
   			selectedId = backStack[backStack.length - 1] ?? null;
   			backStack = backStack.slice(0, -1);
   		}
   	};
   }
   ```
   **CAUTION**: Svelte 5 `$state`/`$effect` outside a component work only in a
   `.svelte.ts` module _called from component init_. Confirm the factory is
   invoked at the top level of each `<script>` (component setup), not inside an
   event handler. If `npm run check` reports `$effect`/`$state` used outside a
   component or effect-orphan warnings, that is a STOP condition — the current
   inline effects rely on component ownership; report rather than force it.
2. Replace the inline block in each of the six views with
   `const nav = createPaneNav(() => allTasks);` and update references:
   `selectedId` → `nav.selectedId`, `selected` → `nav.selected`, `backTask` →
   `nav.backTask`, `openDetail`/`navTask`/`navBack` → `nav.*`. Views that also
   read/write `selectedId` in local handlers (e.g. board drag) use
   `nav.selectedId = ...`.
3. Do NOT change any view's rendering or the props passed to `TaskPanel`.

**Verify**:

- `npm run check` → exit 0, 0 errors, 0 warnings
- `grep -rn "let backStack" src/lib/components/views/` → **no matches**
- `npm run test:unit` → all pass
- Manual/e2e: in each view type, click a task title (pane opens, URL gains
  `?task=`), click a sub-task/mention/dependency chip inside the pane (a
  `← back` breadcrumb appears), press back (returns to origin), copy the URL to
  a new tab (pane restores), click a pane input then click out (pane stays
  open — the ADR-055 regression). If plan-014/e2e exists:
  `npx playwright test` → all pass.

## Test plan

- `tests/unit/date.test.ts`: `fmtDate`/`fmtDateShort` null, Date, ISO-string
  cases. Model on `tests/unit/files.test.ts`.
- `tests/unit/taskGroups.test.ts`: every `groupBy`, `_none` bucket, multi-label
  membership, `hideEmpty` on/off, all five `due` buckets with injected `now`.
  Model on `tests/unit/customFields.test.ts`.
- No unit test for `paneNav` (it's reactive/DOM-coupled) — rely on plan-014
  characterization tests or the manual/e2e checks in Step 3.
- Verification: `npm run test:unit` → all pass including the two new files;
  `npm run check` → exit 0.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `npm run check` exits 0 with 0 errors and 0 warnings
- [ ] `npm run test:unit` passes, including `date.test.ts` and `taskGroups.test.ts`
- [ ] `grep -rn "function fmtDate" src/lib/components/` returns no matches
- [ ] `grep -rn "let backStack" src/lib/components/views/` returns no matches
      (unless Step 3 was intentionally stopped — then note it)
- [ ] BoardView still renders due-less swimlanes and MM-DD dates (unchanged)
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated (if that file exists)

## STOP conditions

Stop and report back (do not improvise) if:

- The code at the locations in "Current state" doesn't match the excerpts
  (drift since planning) — re-run the drift check.
- Extracting `groupTasks` would change ANY view's visible grouping, order,
  bucket titles, or counts. Capture current behavior first (plan 014); if you
  cannot prove byte-identical output, ship Step 1 only and report.
- BoardView cannot adopt the shared group builder without altering its swimlane
  behavior — that is expected; leave Board partially unified and note it, do NOT
  force it.
- `npm run check` reports `$state`/`$effect`-outside-component or orphan-effect
  errors for the `paneNav` factory (Step 3). Report — do not restructure the
  effect ownership to work around it.
- Any step's verification fails twice after a reasonable fix attempt.
- The fix appears to require touching an out-of-scope file (especially the three
  ADR-049-deferred extractions).

## Maintenance notes

- Steps are ordered lowest-risk-first and each is independently shippable. If
  time-boxed, ship Step 1 alone — it's pure win and unblocks nothing else.
- `fmtDate`/`fmtDateShort` now have ONE definition; future date-format changes
  go in `src/lib/date.ts`.
- If BoardView was left with its own swimlane builder, a future "group by due on
  the board" feature should first fold Board into `groupTasks` — record whether
  Step 2 unified it or not.
- Reviewer should scrutinize: (a) Board's date output is still MM-DD; (b) the
  `untrack` + `readPaneParam`/`setPaneUrl` pattern survived the `paneNav`
  extraction intact (ADR-055 regression risk); (c) group titles still route
  through the component's `$i18n`/`$t`, not baked into `$lib`.
