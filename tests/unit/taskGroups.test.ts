import { describe, expect, it } from 'vitest';
import { groupTasks, type GroupCtx, type GroupableTask } from '$lib/taskGroups';

type Task = GroupableTask & { id: string; labelIds?: string[] };

function task(overrides: Partial<Task> & { id: string }): Task {
	return {
		statusId: 's-backlog',
		milestoneId: null,
		assigneeId: null,
		dueDate: null,
		labelIds: [],
		...overrides
	};
}

const statuses = [
	{ id: 's-backlog', name: 'Backlog' },
	{ id: 's-done', name: 'Done' }
];
const milestones = [{ id: 'm1', name: 'Milestone 1' }];
const users = [{ id: 'u1', name: 'Alice' }];
const labels = [
	{ id: 'l1', name: 'Bug' },
	{ id: 'l2', name: 'Urgent' }
];

function baseCtx(rows: Task[]): GroupCtx<Task> {
	return {
		statuses,
		milestones,
		users,
		labels,
		labelIdsOf: (id) => rows.find((t) => t.id === id)?.labelIds ?? [],
		t: (key) => key
	};
}

describe('groupTasks', () => {
	it('returns a single _all group when groupBy is null', () => {
		const rows = [task({ id: 't1' }), task({ id: 't2' })];
		const groups = groupTasks(rows, null, baseCtx(rows), true);
		expect(groups).toEqual([{ key: '_all', title: '', tasks: rows }]);
	});

	it('returns the _all group even when empty (hideEmpty not applied to null groupBy)', () => {
		const groups = groupTasks([], null, baseCtx([]), true);
		expect(groups).toEqual([{ key: '_all', title: '', tasks: [] }]);
	});

	it('groups by status', () => {
		const rows = [
			task({ id: 't1', statusId: 's-backlog' }),
			task({ id: 't2', statusId: 's-done' }),
			task({ id: 't3', statusId: 's-backlog' })
		];
		const groups = groupTasks(rows, 'status', baseCtx(rows), false);
		expect(groups).toEqual([
			{ key: 's-backlog', title: 'Backlog', tasks: [rows[0], rows[2]] },
			{ key: 's-done', title: 'Done', tasks: [rows[1]] }
		]);
	});

	it('groups by milestone with a _none bucket', () => {
		const rows = [task({ id: 't1', milestoneId: 'm1' }), task({ id: 't2', milestoneId: null })];
		const groups = groupTasks(rows, 'milestone', baseCtx(rows), false);
		expect(groups).toEqual([
			{ key: 'm1', title: 'Milestone 1', tasks: [rows[0]] },
			{ key: '_none', title: 'No milestone', tasks: [rows[1]] }
		]);
	});

	it('groups by assignee with a _none (Unassigned) bucket', () => {
		const rows = [task({ id: 't1', assigneeId: 'u1' }), task({ id: 't2', assigneeId: null })];
		const groups = groupTasks(rows, 'assignee', baseCtx(rows), false);
		expect(groups).toEqual([
			{ key: 'u1', title: 'Alice', tasks: [rows[0]] },
			{ key: '_none', title: 'Unassigned', tasks: [rows[1]] }
		]);
	});

	it('groups by label, with a task appearing in every one of its labels groups', () => {
		const rows = [
			task({ id: 't1', labelIds: ['l1', 'l2'] }),
			task({ id: 't2', labelIds: ['l1'] }),
			task({ id: 't3', labelIds: [] })
		];
		const groups = groupTasks(rows, 'label', baseCtx(rows), false);
		expect(groups).toEqual([
			{ key: 'l1', title: 'Bug', tasks: [rows[0], rows[1]] },
			{ key: 'l2', title: 'Urgent', tasks: [rows[0]] },
			{ key: '_none', title: 'No label', tasks: [rows[2]] }
		]);
	});

	it('hides empty groups when hideEmpty is true', () => {
		const rows = [task({ id: 't1', statusId: 's-backlog' })];
		const groups = groupTasks(rows, 'status', baseCtx(rows), true);
		expect(groups).toEqual([{ key: 's-backlog', title: 'Backlog', tasks: rows }]);
	});

	it('keeps empty groups when hideEmpty is false', () => {
		const rows = [task({ id: 't1', statusId: 's-backlog' })];
		const groups = groupTasks(rows, 'status', baseCtx(rows), false);
		expect(groups).toEqual([
			{ key: 's-backlog', title: 'Backlog', tasks: rows },
			{ key: 's-done', title: 'Done', tasks: [] }
		]);
	});

	describe('due buckets', () => {
		// Fixed "now": 2026-06-15 12:00 local time.
		const now = new Date(2026, 5, 15, 12, 0, 0).getTime();
		const nowFn = () => now;

		function dueTask(id: string, dayOffset: number | null) {
			if (dayOffset === null) return task({ id, dueDate: null });
			const d = new Date(2026, 5, 15);
			d.setDate(d.getDate() + dayOffset);
			return task({ id, dueDate: d.toISOString() });
		}

		it('buckets overdue/today/week/later/none', () => {
			const rows = [
				dueTask('overdue', -1),
				dueTask('today', 0),
				dueTask('week', 3),
				dueTask('later', 10),
				dueTask('none', null)
			];
			const ctx: GroupCtx<Task> = { ...baseCtx(rows), now: nowFn };
			const groups = groupTasks(rows, 'due', ctx, false);
			expect(groups.map((g) => g.key)).toEqual(['overdue', 'today', 'week', 'later', 'none']);
			expect(groups.map((g) => g.title)).toEqual([
				'Overdue',
				'Today',
				'Next 7 days',
				'Later',
				'No due date'
			]);
			expect(groups.find((g) => g.key === 'overdue')?.tasks).toEqual([rows[0]]);
			expect(groups.find((g) => g.key === 'today')?.tasks).toEqual([rows[1]]);
			expect(groups.find((g) => g.key === 'week')?.tasks).toEqual([rows[2]]);
			expect(groups.find((g) => g.key === 'later')?.tasks).toEqual([rows[3]]);
			expect(groups.find((g) => g.key === 'none')?.tasks).toEqual([rows[4]]);
		});

		it('the "week" bucket boundary is exclusive at day+7', () => {
			const boundary = dueTask('boundary', 7);
			const justUnder = dueTask('under', 6);
			const rows = [boundary, justUnder];
			const ctx: GroupCtx<Task> = { ...baseCtx(rows), now: nowFn };
			const groups = groupTasks(rows, 'due', ctx, false);
			expect(groups.find((g) => g.key === 'later')?.tasks).toEqual([boundary]);
			expect(groups.find((g) => g.key === 'week')?.tasks).toEqual([justUnder]);
		});

		it('hides empty due buckets when hideEmpty is true', () => {
			const rows = [dueTask('today', 0)];
			const ctx: GroupCtx<Task> = { ...baseCtx(rows), now: nowFn };
			const groups = groupTasks(rows, 'due', ctx, true);
			expect(groups).toEqual([{ key: 'today', title: 'Today', tasks: rows }]);
		});
	});
});
