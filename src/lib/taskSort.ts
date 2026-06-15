// Pure, client-safe task sorting (BASDEV-7 "expanded sorts"). Used by the
// table/list views via config.sortBy. A sort key may carry an optional ':desc'
// suffix to reverse the natural direction (e.g. 'title:desc', 'due:desc').
//
// Supported keys: priority | order | title | due | status | assignee | createdAt
//   priority   — urgent → none (desc natural; ':desc' flips to none → urgent)
//   order      — manual order number, ascending, nulls last
//   title      — case-insensitive A→Z
//   due        — earliest due date first, no-due last
//   status     — by the project's status ordering (helpers.statusRank)
//   assignee   — by assignee display name A→Z, unassigned last
//   createdAt  — oldest first
//
// Sorting is stable: ties keep the input order. Unknown keys return the input
// unchanged (callers should treat that as "natural order").

export type SortableTask = {
	id: string;
	title: string;
	priority: string;
	order: number | null;
	statusId: string;
	assigneeId: string | null;
	dueDate: Date | string | null;
	createdAt?: Date | string | null;
};

export type SortHelpers = {
	/** Rank of a status id in the project's configured order (lower = first). */
	statusRank?: (statusId: string) => number;
	/** Display name for an assignee id (used for name-ordering). */
	assigneeName?: (assigneeId: string | null) => string | null;
};

export const SORT_KEYS = [
	'priority',
	'order',
	'title',
	'due',
	'status',
	'assignee',
	'createdAt'
] as const;
export type SortKey = (typeof SORT_KEYS)[number];

const PRIORITY_RANK: Record<string, number> = { none: 0, low: 1, medium: 2, high: 3, urgent: 4 };

function toTime(d: Date | string | null | undefined): number | null {
	if (!d) return null;
	const t = new Date(d).getTime();
	return Number.isFinite(t) ? t : null;
}

/** Split a raw sortBy value into its key and direction. */
export function parseSortBy(sortBy: string | null | undefined): {
	key: SortKey | null;
	desc: boolean;
} {
	if (!sortBy) return { key: null, desc: false };
	const [rawKey, dir] = sortBy.split(':');
	const key = (SORT_KEYS as readonly string[]).includes(rawKey) ? (rawKey as SortKey) : null;
	return { key, desc: dir === 'desc' };
}

/**
 * Returns a new, sorted array of `tasks` per `sortBy`. The natural direction of
 * each key is described above; a ':desc' suffix reverses it. Stable; never
 * mutates the input. With no/unknown key, returns a shallow copy in input order.
 */
export function sortTasks<T extends SortableTask>(
	tasks: T[],
	sortBy: string | null | undefined,
	helpers: SortHelpers = {}
): T[] {
	const { key, desc } = parseSortBy(sortBy);
	const rows = tasks.slice();
	if (!key) return rows;

	const statusRank = helpers.statusRank ?? (() => 0);
	const assigneeName = helpers.assigneeName ?? ((id: string | null) => id);

	// comparator in the key's NATURAL direction; ':desc' flips the result below
	const cmp = (a: T, b: T): number => {
		switch (key) {
			case 'priority':
				return (PRIORITY_RANK[b.priority] ?? 0) - (PRIORITY_RANK[a.priority] ?? 0);
			case 'order': {
				const ao = a.order ?? Number.MAX_SAFE_INTEGER;
				const bo = b.order ?? Number.MAX_SAFE_INTEGER;
				return ao - bo;
			}
			case 'title':
				return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
			case 'due': {
				const at = toTime(a.dueDate);
				const bt = toTime(b.dueDate);
				if (at === null && bt === null) return 0;
				if (at === null) return 1; // no due date sinks to the end
				if (bt === null) return -1;
				return at - bt;
			}
			case 'status':
				return statusRank(a.statusId) - statusRank(b.statusId);
			case 'assignee': {
				const an = assigneeName(a.assigneeId);
				const bn = assigneeName(b.assigneeId);
				if (!an && !bn) return 0;
				if (!an) return 1; // unassigned sinks to the end
				if (!bn) return -1;
				return an.localeCompare(bn, undefined, { sensitivity: 'base' });
			}
			case 'createdAt': {
				const at = toTime(a.createdAt) ?? 0;
				const bt = toTime(b.createdAt) ?? 0;
				return at - bt;
			}
			default:
				return 0;
		}
	};

	// stable sort: decorate with original index, break ties by it
	return rows
		.map((t, i) => ({ t, i }))
		.sort((x, y) => {
			const c = cmp(x.t, y.t);
			if (c !== 0) return desc ? -c : c;
			return x.i - y.i;
		})
		.map((d) => d.t);
}
