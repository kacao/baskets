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

// Each array holds the EXCLUDED (unchecked) values for that facet — the popover
// shows every option checked by default, and unchecking one hides tasks with
// that value. An empty/absent array excludes nothing (everything shown).
export type TaskFilters = {
	statusIds?: string[];
	assigneeIds?: string[]; // '_none' = unassigned
	milestoneIds?: string[]; // '_none' = no milestone
	labelIds?: string[]; // '_none' = no label
	priorities?: string[];
	dueBuckets?: DueBucket[];
};

// Per-task label lookup is injected so this helper stays independent of how the
// caller stores the task↔label join.
export type FilterHelpers = {
	labelIdsOf: (taskId: string) => string[];
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

function active(list: string[] | undefined): list is string[] {
	return Array.isArray(list) && list.length > 0;
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

// Exclusion semantics: a task is HIDDEN when, for any facet, its value appears in
// that facet's excluded (unchecked) list. Default (no exclusions) shows everything.
// Free-text search stays inclusive — only tasks matching the query are kept.
export function matchTask(
	task: FilterableTask,
	filters: TaskFilters | undefined,
	searchText: string,
	helpers: FilterHelpers
): boolean {
	const q = (searchText ?? '').trim().toLowerCase();
	if (q) {
		const hay = `${task.title ?? ''} ${task.description ?? ''}`.toLowerCase();
		if (!hay.includes(q)) return false;
	}

	if (!filters) return true;

	if (active(filters.statusIds) && filters.statusIds.includes(task.statusId)) return false;

	if (active(filters.priorities) && filters.priorities.includes(task.priority)) return false;

	if (active(filters.assigneeIds) && filters.assigneeIds.includes(task.assigneeId ?? '_none'))
		return false;

	if (active(filters.milestoneIds) && filters.milestoneIds.includes(task.milestoneId ?? '_none'))
		return false;

	if (active(filters.dueBuckets) && filters.dueBuckets.includes(dueBucketOf(task.dueDate)))
		return false;

	if (active(filters.labelIds)) {
		const ids = helpers.labelIdsOf(task.id);
		// hide an unlabeled task when 'No label' is unchecked, or any of the task's
		// labels has been unchecked (a task tagged with a hidden label disappears)
		const hidden =
			(ids.length === 0 && filters.labelIds.includes('_none')) ||
			ids.some((id) => filters.labelIds!.includes(id));
		if (hidden) return false;
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
