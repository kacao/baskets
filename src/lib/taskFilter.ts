// Pure task filtering helpers shared by FilterBar + the project views (BASDEV-2).
// matchTask/filterTasks run client-side over the already-loaded task list, so they
// stay framework-free (no Svelte imports) and are safe to unit-test in isolation.

export type FilterableTask = {
	id: string;
	parentId: string | null;
	title: string;
	description: string | null;
	statusId: string;
	priority: string;
	assigneeId: string | null;
	milestoneId: string | null;
	dueDate: Date | string | null;
};

// A "due bucket" coarsely classifies a task by its dueDate relative to today.
export type DueBucket = 'overdue' | 'today' | 'week' | 'later' | 'none';

// Inclusion semantics (ADR-035, supersedes the exclusion model of ADR-033): a
// facet array holds the CHECKED (shown) values. A facet is ACTIVE only when its
// key is PRESENT — then a task is shown only if its value is in the list. An
// ABSENT key means the facet is inactive (everything shown, every option renders
// checked). An empty array is active-but-shows-nothing. New views carry no
// filters key, so all facets start inactive = all checked.
export type TaskFilters = {
	statusIds?: string[];
	assigneeIds?: string[]; // '_none' = unassigned
	milestoneIds?: string[]; // '_none' = no milestone
	labelIds?: string[]; // '_none' = no label
	priorities?: string[];
	dueBuckets?: DueBucket[];
};

// Per-task label lookup is injected so this helper stays independent of how the
// caller stores the task↔label join. `searchableText` (optional) returns extra
// free-text for a task (e.g. resolved custom-field values) folded into search.
export type FilterHelpers = {
	labelIdsOf: (taskId: string) => string[];
	searchableText?: (taskId: string) => string;
};

export function dueBucketOf(due: Date | string | null): DueBucket {
	if (!due) return 'none';
	const start = new Date();
	start.setHours(0, 0, 0, 0);
	const today = start.getTime();
	const week = today + 7 * 86400000;
	const d = new Date(due);
	d.setHours(0, 0, 0, 0);
	const ts = d.getTime();
	if (ts < today) return 'overdue';
	if (ts === today) return 'today';
	if (ts < week) return 'week';
	return 'later';
}

// A facet is active when its key is present (an array) — even an empty one, which
// then shows nothing. Absence means the facet does not filter at all.
function active(list: string[] | undefined): list is string[] {
	return Array.isArray(list);
}

export function hasActiveFilters(filters: TaskFilters | undefined, searchText = ''): boolean {
	if (searchText.trim()) return true;
	if (!filters) return false;
	return (
		active(filters.statusIds) ||
		active(filters.assigneeIds) ||
		active(filters.milestoneIds) ||
		active(filters.labelIds) ||
		active(filters.priorities) ||
		active(filters.dueBuckets)
	);
}

// Inclusion semantics: for each ACTIVE facet a task is shown only when its value
// is in the facet's (checked) list — otherwise it is hidden. Inactive (absent)
// facets don't filter. Free-text search stays inclusive — only tasks matching the
// query are kept.
export function matchTask(
	task: FilterableTask,
	filters: TaskFilters | undefined,
	searchText: string,
	helpers: FilterHelpers
): boolean {
	const q = (searchText ?? '').trim().toLowerCase();
	if (q) {
		const cf = helpers.searchableText?.(task.id) ?? '';
		const hay = `${task.title ?? ''} ${task.description ?? ''} ${cf}`.toLowerCase();
		if (!hay.includes(q)) return false;
	}

	if (!filters) return true;

	if (active(filters.statusIds) && !filters.statusIds.includes(task.statusId)) return false;

	if (active(filters.priorities) && !filters.priorities.includes(task.priority)) return false;

	if (active(filters.assigneeIds) && !filters.assigneeIds.includes(task.assigneeId ?? '_none'))
		return false;

	if (active(filters.milestoneIds) && !filters.milestoneIds.includes(task.milestoneId ?? '_none'))
		return false;

	if (active(filters.dueBuckets) && !filters.dueBuckets.includes(dueBucketOf(task.dueDate)))
		return false;

	if (active(filters.labelIds)) {
		const ids = helpers.labelIdsOf(task.id);
		// show an unlabeled task only when 'No label' is checked; a labeled task when
		// ANY of its labels is checked (multi-label tasks survive if one label matches)
		const shown =
			ids.length === 0
				? filters.labelIds.includes('_none')
				: ids.some((id) => filters.labelIds!.includes(id));
		if (!shown) return false;
	}

	return true;
}

// Filters the flat task list. A sub-task is kept when it matches OR its parent
// matches, so expandable parent/child rows in TableView/ListView never lose
// their context. Parents whose only relevance is a matching child are also kept.
export function filterTasks<T extends FilterableTask>(
	tasks: T[],
	filters: TaskFilters | undefined,
	searchText: string,
	helpers: FilterHelpers
): T[] {
	if (!hasActiveFilters(filters, searchText)) return tasks;

	const direct = new Set<string>();
	for (const t of tasks) if (matchTask(t, filters, searchText, helpers)) direct.add(t.id);

	const keep = new Set<string>(direct);
	// keep parents of matched sub-tasks
	for (const t of tasks) {
		if (direct.has(t.id) && t.parentId) keep.add(t.parentId);
	}
	// keep sub-tasks of matched parents (so an expanded parent still shows its rows)
	for (const t of tasks) {
		if (t.parentId && direct.has(t.parentId)) keep.add(t.id);
	}

	return tasks.filter((t) => keep.has(t.id));
}
