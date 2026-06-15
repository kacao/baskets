// Status categories (client-safe; server re-exports these from $lib/server/statuses).
// Five human-readable buckets aligned with the default statuses. Behavior keys
// off `completed` (counts as done + completes sub-tasks); new tasks start at `backlog`.
export const STATUS_CATEGORIES = [
	'backlog',
	'planned',
	'in-progress',
	'completed',
	'canceled'
] as const;
export type StatusCategory = (typeof STATUS_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<string, string> = {
	backlog: 'Backlog',
	planned: 'Planned',
	'in-progress': 'In progress',
	completed: 'Completed',
	canceled: 'Canceled'
};
export const categoryLabel = (c: string) => CATEGORY_LABELS[c] ?? c;

/** The category that means "done": counts as complete + cascades to sub-tasks. */
export const DONE_CATEGORY: StatusCategory = 'completed';
/** The category a brand-new task defaults to. */
export const INITIAL_CATEGORY: StatusCategory = 'backlog';
