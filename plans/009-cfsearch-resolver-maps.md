# Plan 009: Replace linear-scan resolvers in cf-search with id→label Maps

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If
> anything in "STOP conditions" occurs, stop and report — do not improvise. When
> done, update this plan's status row in `plans/README.md` if that file exists
> (do NOT create it).
>
> **Drift check (run first)**:
> `git diff --stat 3958dd6..HEAD -- "src/routes/(app)/projects/[id]/+page.svelte" src/lib/customFields.ts src/lib/components/TaskPanel.svelte`
> NOTE: `src/lib/components/TaskPanel.svelte` had **uncommitted changes** at
> planning time; excerpts were read from the working tree. If the cited regions
> differ from live code, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `3958dd6`, 2026-07-12

## Why this matters

The `cfSearchByTask` derived on the project page passes five resolver closures
to `buildTaskCfSearch`, and each closure does a **linear `.find()` over a full
array** (`customFieldOptions`, `users`, `locations`, `tasks`, `files`).
`buildTaskCfSearch` invokes those resolvers **once per element of every
custom-field value array on every task**, so building the search index is
`O(values · array-length · list-length)`. It is a `$derived`, so it rebuilds on
every data change — including every realtime `invalidateAll()` refetch. The
inline comment even hedges _"O(values) — fine at app scale"_ (optimistic).
Swapping the linear `.find(` closures for `Map.get(` calls (maps built once)
drops the per-lookup cost from O(list) to O(1). Pure refactor — the resolved
strings are identical, so search behavior does not change.

## Current state

### `src/routes/(app)/projects/[id]/+page.svelte:137–149`

```ts
// Per-task searchable text from custom-field values (resolved to display labels).
// Lets free-text search + the task-cf link picker hit custom fields. ponytail:
// rebuilt on any data change, O(values) — fine at app scale.
const cfSearchByTask = $derived(
	buildTaskCfSearch(data.customFields, data.taskCustomValues, {
		option: (id) => data.customFieldOptions.find((o) => o.id === id)?.title ?? '',
		user: (id) => data.users.find((u) => u.id === id)?.name ?? '',
		location: (id) => data.locations.find((l) => l.id === id)?.title ?? '',
		task: (id) => data.tasks.find((t) => t.id === id)?.title ?? '',
		file: (id) => data.files.find((f) => f.id === id)?.filename ?? ''
	})
);
const taskCfSearch = (id: string) => cfSearchByTask.get(id) ?? '';
```

### `buildTaskCfSearch` — `src/lib/customFields.ts:294–333` (the consumer)

```ts
export function buildTaskCfSearch(
	fields: { id: string; type: string }[],
	values: { taskId: string; fieldId: string; value: string }[],
	resolve: {
		option: (id: string) => string;
		user: (id: string) => string;
		location: (id: string) => string;
		task: (id: string) => string;
		file: (id: string) => string;
	}
): Map<string, string> {
	const typeById = new Map(fields.map((f) => [f.id, f.type]));
	const parts = new Map<string, string[]>();
	for (const v of values) {
		const type = typeById.get(v.fieldId);
		if (!type || type === 'rollup' || type === 'checkbox') continue;
		const d = decodeValue({ type }, v.value);
		let text: string;
		if (Array.isArray(d)) {
			const r =
				type === 'select'
					? d.map(resolve.option)
					: type === 'person'
						? d.map(resolve.user)
						: type === 'place'
							? d.map(resolve.location)
							: type === 'task'
								? d.map(resolve.task)
								: type === 'files'
									? d.map(resolve.file)
									: d.map(String);
			text = r.join(' ');
		} else {
			text = String(d ?? '');
		}
		if (text.trim()) {
			const arr = parts.get(v.taskId) ?? [];
			arr.push(text);
			parts.set(v.taskId, arr);
		}
	}
	const out = new Map<string, string>();
	for (const [id, p] of parts) out.set(id, p.join(' '));
	return out;
}
```

`buildTaskCfSearch`'s **signature does not change** — it still takes five
`(id) => string` resolvers. Only the _closures the caller passes_ change from
`array.find(...)` to `map.get(...)`. So the pure `$lib` function is untouched,
and its unit tests (`tests/unit/customFieldsSearch.test.ts`) keep passing
without modification.

### TaskPanel.svelte:195–205 (the parallel site — Step 2)

```ts
// per-task cf search text so the `task`-cf link picker searches by cf values too
const cfSearchByTask = $derived(
	buildTaskCfSearch(customFields, taskCustomValues, {
		option: (id) => customFieldOptions.find((o) => o.id === id)?.title ?? '',
		user: (id) => users.find((u) => u.id === id)?.name ?? '',
		location: (id) => locations.find((l) => l.id === id)?.title ?? '',
		task: (id) => tasks.find((t) => t.id === id)?.title ?? '',
		file: (id) => files.find((f) => f.id === id)?.filename ?? ''
	})
);
const taskCfSearch = (id: string) => cfSearchByTask.get(id) ?? '';
```

Same shape; `customFields`/`customFieldOptions`/`users`/`locations`/`tasks`/`files`
are component props here rather than `data.*`.

### Svelte 5 reactivity constraint (must honor)

The maps MUST be built with `$derived`/`$derived.by` — NOT plain `const` — so
they re-compute when their source arrays change (e.g. after `invalidateAll()`).
A plain `const map = new Map(...)` inside the `<script>` runs once and goes
stale. Reference exemplar of a reactive derived in this same file:
`cfSearchByTask` itself is already `$derived(...)`.

## Commands you will need

| Purpose        | Command                                                           | Expected on success       |
| -------------- | ----------------------------------------------------------------- | ------------------------- |
| Typecheck      | `npm run check`                                                   | exit 0, 0 errors/warnings |
| Unit tests     | `npm run test:unit`                                               | all pass (416 tests)      |
| Grep (no find) | `grep -n "\.find(" "src/routes/(app)/projects/[id]/+page.svelte"` | (see Step verify)         |

## Scope

**In scope**:

- `src/routes/(app)/projects/[id]/+page.svelte` — Step 1 (primary).
- `src/lib/components/TaskPanel.svelte` — Step 2 (optional parallel site).

**Out of scope** (do NOT touch):

- `src/lib/customFields.ts` — `buildTaskCfSearch`'s signature and body stay
  exactly as-is. This is a caller-side change only.
- `tests/unit/customFieldsSearch.test.ts` — must pass unchanged (proves behavior
  is identical).
- The other `.find(` closures on the page unrelated to cf-search (e.g.
  `labelIdsOf`, `statusRankFn`, `assigneeNameFn` at lines 129–135) — leave them;
  they are not part of the `buildTaskCfSearch` hot path.

## Git workflow

- Branch `dev` (or `advisor/009-cfsearch-resolver-maps` off it).
- Conventional commit, e.g. `perf(cf): resolve cf-search refs via id→label maps`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Build id→label maps on the project page, use `.get` in the resolvers

In `src/routes/(app)/projects/[id]/+page.svelte`, ABOVE the `cfSearchByTask`
derived (i.e. before line 140), add five reactive maps:

```ts
const optionTitleById = $derived(new Map(data.customFieldOptions.map((o) => [o.id, o.title])));
const userNameById = $derived(new Map(data.users.map((u) => [u.id, u.name])));
const locationTitleById = $derived(new Map(data.locations.map((l) => [l.id, l.title])));
const taskTitleById = $derived(new Map(data.tasks.map((t) => [t.id, t.title])));
const fileNameById = $derived(new Map(data.files.map((f) => [f.id, f.filename])));
```

Then change the resolver closures to read from those maps:

```ts
const cfSearchByTask = $derived(
	buildTaskCfSearch(data.customFields, data.taskCustomValues, {
		option: (id) => optionTitleById.get(id) ?? '',
		user: (id) => userNameById.get(id) ?? '',
		location: (id) => locationTitleById.get(id) ?? '',
		task: (id) => taskTitleById.get(id) ?? '',
		file: (id) => fileNameById.get(id) ?? ''
	})
);
```

Keep the `const taskCfSearch = (id) => cfSearchByTask.get(id) ?? '';` line
unchanged.

**Verify**:

- `npm run check` → exit 0, 0 errors/warnings.
- The five cf-search resolvers now use `.get(` — confirm by eye that none of the
  five closures inside the `buildTaskCfSearch(...)` call still contains `.find(`.

### Step 2 (optional but recommended): Same change in TaskPanel.svelte

In `src/lib/components/TaskPanel.svelte`, above the `cfSearchByTask` derived
(before line 196), add the same five maps built from the component props
(`customFieldOptions`, `users`, `locations`, `tasks`, `files`) as `$derived`,
and swap the five closures to `.get(id) ?? ''`. Mind that `users` items are
`{ id, name }` (name may be nullable — keep the `?? ''` fallback), and `tasks`
items expose `title`.

If TaskPanel's surrounding code has drifted from the excerpt, skip Step 2, note
it, and ship Step 1 alone (they are independent).

**Verify**: `npm run check` → exit 0, 0 errors/warnings.

### Step 3: Run unit tests

**Verify**: `npm run test:unit` → all pass (416 tests). In particular
`tests/unit/customFieldsSearch.test.ts` (the `buildTaskCfSearch` coverage) must
remain green — it proves the resolved search strings are byte-identical.

## Test plan

- No new tests. `buildTaskCfSearch` is unchanged, so its existing unit test in
  `tests/unit/customFieldsSearch.test.ts` is the behavior gate. The change is
  caller-side and produces identical resolver outputs.
- Optional manual check: on a project with `select`/`person`/`task` custom
  fields populated, the free-text FilterBar search still matches a task by its
  cf value's display label (e.g. searching a select option's title).

## Done criteria

ALL must hold:

- [ ] The five cf-search resolver closures in `+page.svelte` use `.get(` not `.find(`
- [ ] Five `$derived` maps added (reactive, not plain `const`)
- [ ] `npm run check` exits 0, 0 errors/warnings
- [ ] `npm run test:unit` passes (416 tests), incl. `customFieldsSearch.test.ts`
- [ ] `src/lib/customFields.ts` is unmodified (`git status --short`)
- [ ] Only in-scope files modified

## STOP conditions

Stop and report if:

- The `cfSearchByTask` excerpt in `+page.svelte` doesn't match the live code (drift).
- Building the maps as `$derived` triggers a Svelte "cannot reference $derived
  before declaration" or reactivity error you can't resolve by moving the map
  declarations above their first use.
- `customFieldsSearch.test.ts` fails — that means the resolved strings changed
  (they must not); revert and report.
- You find yourself needing to edit `buildTaskCfSearch`'s signature — that is
  out of scope; the closures adapt to it, not the reverse.

## Maintenance notes

- If a new referenceable cf type is added to `buildTaskCfSearch` (a sixth
  resolver), add a matching id→label map at both call sites.
- The maps must stay `$derived` — a reviewer converting them to plain consts
  during a "cleanup" would reintroduce stale-search-after-edit bugs.
- ListView/BoardView do not build cf-search maps (the page passes the prebuilt
  `taskCfSearch` down), so no parallel change is needed there.
