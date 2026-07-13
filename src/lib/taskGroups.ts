export type TaskGroup<T> = { key: string; title: string; tasks: T[] };

export type GroupBy = 'status' | 'milestone' | 'assignee' | 'due' | 'label';

export interface GroupableTask {
	id: string;
	statusId: string;
	milestoneId: string | null;
	assigneeId: string | null;
	dueDate: Date | string | null;
}

export interface GroupCtx<T> {
	statuses: { id: string; name: string }[];
	milestones: { id: string; name: string }[];
	users: { id: string; name: string }[];
	labels: { id: string; name: string }[];
	labelIdsOf: (taskId: string) => string[];
	t: (key: string) => string;
	now?: () => number;
}

function dueBuckets<T extends GroupableTask>(rows: T[], ctx: GroupCtx<T>): TaskGroup<T>[] {
	const start = new Date(ctx.now ? ctx.now() : Date.now());
	start.setHours(0, 0, 0, 0);
	const today = start.getTime();
	const week = today + 7 * 86400000;
	const b: Record<string, T[]> = { overdue: [], today: [], week: [], later: [], none: [] };
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
		{ key: 'overdue', title: ctx.t('Overdue'), tasks: b.overdue },
		{ key: 'today', title: ctx.t('Today'), tasks: b.today },
		{ key: 'week', title: ctx.t('Next 7 days'), tasks: b.week },
		{ key: 'later', title: ctx.t('Later'), tasks: b.later },
		{ key: 'none', title: ctx.t('No due date'), tasks: b.none }
	];
}

/**
 * Builds the grouped-rows shape shared by TableView + ListView's `groups` derived.
 * Behavior-preserving extraction (ADR-035 inclusion-set filtering happens upstream,
 * on `rows`): null/unknown groupBy returns a single ungrouped `_all` group
 * (hideEmpty NOT applied to it, matching the pre-extraction views).
 */
export function groupTasks<T extends GroupableTask>(
	rows: T[],
	groupBy: GroupBy | string | null,
	ctx: GroupCtx<T>,
	hideEmpty: boolean
): TaskGroup<T>[] {
	let g: TaskGroup<T>[];
	if (groupBy === 'status') {
		g = ctx.statuses.map((s) => ({
			key: s.id,
			title: s.name,
			tasks: rows.filter((t) => t.statusId === s.id)
		}));
	} else if (groupBy === 'milestone') {
		g = [
			...ctx.milestones.map((m) => ({
				key: m.id,
				title: m.name,
				tasks: rows.filter((t) => t.milestoneId === m.id)
			})),
			{ key: '_none', title: ctx.t('No milestone'), tasks: rows.filter((t) => !t.milestoneId) }
		];
	} else if (groupBy === 'assignee') {
		g = [
			...ctx.users.map((u) => ({
				key: u.id,
				title: u.name,
				tasks: rows.filter((t) => t.assigneeId === u.id)
			})),
			{ key: '_none', title: ctx.t('Unassigned'), tasks: rows.filter((t) => !t.assigneeId) }
		];
	} else if (groupBy === 'due') {
		g = dueBuckets(rows, ctx);
	} else if (groupBy === 'label') {
		g = [
			...ctx.labels.map((l) => ({
				key: l.id,
				title: l.name,
				tasks: rows.filter((t) => ctx.labelIdsOf(t.id).includes(l.id))
			})),
			{ key: '_none', title: ctx.t('No label'), tasks: rows.filter((t) => ctx.labelIdsOf(t.id).length === 0) }
		];
	} else {
		return [{ key: '_all', title: '', tasks: rows }];
	}
	return hideEmpty ? g.filter((x) => x.tasks.length > 0) : g;
}
