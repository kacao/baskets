import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	dueBucketOf,
	filterTasks,
	hasActiveFilters,
	matchTask,
	type FilterableTask,
	type FilterHelpers,
	type TaskFilters
} from '$lib/taskFilter';

// Pin "today" so due-date buckets are deterministic. dueBucketOf reads new Date()
// for the current day, so freeze the clock to a fixed local midnight-able moment.
const NOW = new Date(2026, 5, 15, 9, 0, 0); // 2026-06-15 09:00 local

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(NOW);
});

afterEach(() => {
	vi.useRealTimers();
});

// Factory keeps tasks in sync with the FilterableTask shape; override per case.
function makeTask(over: Partial<FilterableTask> = {}): FilterableTask {
	return {
		id: 't1',
		parentId: null,
		title: 'Untitled',
		description: null,
		statusId: 's-backlog',
		priority: 'none',
		assigneeId: null,
		milestoneId: null,
		dueDate: null,
		...over
	};
}

// Default helper: no labels for any task.
const noLabels: FilterHelpers = { labelIdsOf: () => [] };

// Helper for a fixed label map keyed by task id.
function labelsBy(map: Record<string, string[]>): FilterHelpers {
	return { labelIdsOf: (id) => map[id] ?? [] };
}

describe('dueBucketOf', () => {
	it('returns none for a null due date', () => {
		expect(dueBucketOf(null)).toBe('none');
	});

	it('returns overdue for a past date', () => {
		expect(dueBucketOf(new Date(2026, 5, 14))).toBe('overdue');
	});

	it('returns today for the current day regardless of time of day', () => {
		expect(dueBucketOf(new Date(2026, 5, 15, 23, 30))).toBe('today');
	});

	it('returns week for a date within the next 7 days', () => {
		expect(dueBucketOf(new Date(2026, 5, 18))).toBe('week');
	});

	it('returns later for a date beyond 7 days', () => {
		expect(dueBucketOf(new Date(2026, 5, 30))).toBe('later');
	});

	it('accepts an ISO date string', () => {
		expect(dueBucketOf('2026-06-14')).toBe('overdue');
	});

	it('treats exactly 7 days out as later (week boundary is exclusive)', () => {
		expect(dueBucketOf(new Date(2026, 5, 22))).toBe('later');
	});
});

describe('hasActiveFilters', () => {
	it('is false for undefined filters and empty search', () => {
		expect(hasActiveFilters(undefined)).toBe(false);
	});

	it('is false for a filter object with only empty arrays', () => {
		expect(hasActiveFilters({ statusIds: [], priorities: [] })).toBe(false);
	});

	it('is true when search text is non-empty', () => {
		expect(hasActiveFilters(undefined, 'find me')).toBe(true);
	});

	it('is false when search text is only whitespace', () => {
		expect(hasActiveFilters(undefined, '   ')).toBe(false);
	});

	it('is true when any facet has a selected value', () => {
		expect(hasActiveFilters({ statusIds: ['s-1'] })).toBe(true);
		expect(hasActiveFilters({ dueBuckets: ['today'] })).toBe(true);
		expect(hasActiveFilters({ labelIds: ['_none'] })).toBe(true);
	});
});

describe('matchTask — pass-through', () => {
	it('matches any task when filters undefined and no search', () => {
		expect(matchTask(makeTask(), undefined, '', noLabels)).toBe(true);
	});

	it('matches any task for an empty filter set', () => {
		expect(matchTask(makeTask(), {}, '', noLabels)).toBe(true);
	});
});

describe('matchTask — free-text search', () => {
	it('matches on title substring case-insensitively', () => {
		const task = makeTask({ title: 'Deploy the API' });
		expect(matchTask(task, undefined, 'deploy', noLabels)).toBe(true);
		expect(matchTask(task, undefined, 'API', noLabels)).toBe(true);
	});

	it('matches on description substring', () => {
		const task = makeTask({ title: 'Task', description: 'needs review by QA' });
		expect(matchTask(task, undefined, 'qa', noLabels)).toBe(true);
	});

	it('does not match when the query is absent from title and description', () => {
		const task = makeTask({ title: 'Hello', description: 'world' });
		expect(matchTask(task, undefined, 'zzz', noLabels)).toBe(false);
	});

	it('trims surrounding whitespace from the query', () => {
		const task = makeTask({ title: 'Deploy' });
		expect(matchTask(task, undefined, '  deploy  ', noLabels)).toBe(true);
	});

	it('tolerates null description without throwing', () => {
		const task = makeTask({ title: 'Solo', description: null });
		expect(matchTask(task, undefined, 'solo', noLabels)).toBe(true);
	});
});

// Exclusion semantics: a facet array lists the UNCHECKED values to hide; a task
// is dropped when its value for that facet is in the list. Default = all shown.
describe('matchTask — status facet (exclusion)', () => {
	it('drops a task whose status is excluded', () => {
		const task = makeTask({ statusId: 's-backlog' });
		expect(matchTask(task, { statusIds: ['s-backlog'] }, '', noLabels)).toBe(false);
	});

	it('keeps a task whose status is not excluded', () => {
		const task = makeTask({ statusId: 's-progress' });
		expect(matchTask(task, { statusIds: ['s-backlog'] }, '', noLabels)).toBe(true);
	});

	it('drops any status named in the excluded set', () => {
		const task = makeTask({ statusId: 's-done' });
		expect(matchTask(task, { statusIds: ['s-progress', 's-done'] }, '', noLabels)).toBe(false);
	});
});

describe('matchTask — priority facet (exclusion)', () => {
	it('drops an excluded priority', () => {
		const task = makeTask({ priority: 'high' });
		expect(matchTask(task, { priorities: ['high'] }, '', noLabels)).toBe(false);
	});

	it('keeps a priority that is not excluded', () => {
		const task = makeTask({ priority: 'low' });
		expect(matchTask(task, { priorities: ['high', 'urgent'] }, '', noLabels)).toBe(true);
	});
});

describe('matchTask — assignee facet (exclusion)', () => {
	it('drops a task assigned to an excluded user', () => {
		const task = makeTask({ assigneeId: 'u-1' });
		expect(matchTask(task, { assigneeIds: ['u-1'] }, '', noLabels)).toBe(false);
	});

	it('keeps a task assigned to a non-excluded user', () => {
		const task = makeTask({ assigneeId: 'u-2' });
		expect(matchTask(task, { assigneeIds: ['u-1'] }, '', noLabels)).toBe(true);
	});

	it('hides unassigned tasks when _none is excluded', () => {
		const task = makeTask({ assigneeId: null });
		expect(matchTask(task, { assigneeIds: ['_none'] }, '', noLabels)).toBe(false);
	});

	it('keeps an unassigned task when only a real user is excluded', () => {
		const task = makeTask({ assigneeId: null });
		expect(matchTask(task, { assigneeIds: ['u-1'] }, '', noLabels)).toBe(true);
	});
});

describe('matchTask — milestone facet (exclusion)', () => {
	it('drops a task in an excluded milestone', () => {
		const task = makeTask({ milestoneId: 'm-1' });
		expect(matchTask(task, { milestoneIds: ['m-1'] }, '', noLabels)).toBe(false);
	});

	it('hides milestone-less tasks when _none is excluded', () => {
		const task = makeTask({ milestoneId: null });
		expect(matchTask(task, { milestoneIds: ['_none'] }, '', noLabels)).toBe(false);
	});

	it('keeps a milestone-less task when a real milestone is excluded', () => {
		const task = makeTask({ milestoneId: null });
		expect(matchTask(task, { milestoneIds: ['m-1'] }, '', noLabels)).toBe(true);
	});
});

describe('matchTask — due-date bucket facet (exclusion)', () => {
	it('drops a task whose due date falls in an excluded bucket', () => {
		const task = makeTask({ dueDate: new Date(2026, 5, 14) }); // overdue
		expect(matchTask(task, { dueBuckets: ['overdue'] }, '', noLabels)).toBe(false);
	});

	it('keeps a task whose bucket is not excluded', () => {
		const task = makeTask({ dueDate: new Date(2026, 5, 14) }); // overdue
		expect(matchTask(task, { dueBuckets: ['today', 'week'] }, '', noLabels)).toBe(true);
	});

	it('hides no-due-date tasks when the none bucket is excluded', () => {
		const task = makeTask({ dueDate: null });
		expect(matchTask(task, { dueBuckets: ['none'] }, '', noLabels)).toBe(false);
	});
});

describe('matchTask — label facet (multi-value exclusion)', () => {
	it('drops a task that has an excluded label', () => {
		const task = makeTask({ id: 't1' });
		const helpers = labelsBy({ t1: ['l-a', 'l-b'] });
		expect(matchTask(task, { labelIds: ['l-b'] }, '', helpers)).toBe(false);
	});

	it('keeps a task when none of its labels are excluded', () => {
		const task = makeTask({ id: 't1' });
		const helpers = labelsBy({ t1: ['l-a'] });
		expect(matchTask(task, { labelIds: ['l-z'] }, '', helpers)).toBe(true);
	});

	it('hides a task that carries an excluded label even if its others stay checked', () => {
		const task = makeTask({ id: 't1' });
		const helpers = labelsBy({ t1: ['l-a', 'l-b'] });
		expect(matchTask(task, { labelIds: ['l-a'] }, '', helpers)).toBe(false);
	});

	it('hides unlabeled tasks when _none is excluded', () => {
		const task = makeTask({ id: 't1' });
		expect(matchTask(task, { labelIds: ['_none'] }, '', labelsBy({}))).toBe(false);
	});

	it('keeps a labeled task when only _none is excluded', () => {
		const task = makeTask({ id: 't1' });
		const helpers = labelsBy({ t1: ['l-a'] });
		expect(matchTask(task, { labelIds: ['_none'] }, '', helpers)).toBe(true);
	});
});

describe('matchTask — combined facets (hide if ANY facet excludes)', () => {
	it('keeps a task when none of its values are excluded in any facet', () => {
		const task = makeTask({
			statusId: 's-progress',
			priority: 'high',
			assigneeId: 'u-1',
			dueDate: new Date(2026, 5, 15) // today
		});
		const filters: TaskFilters = {
			statusIds: ['s-backlog'],
			priorities: ['low'],
			assigneeIds: ['u-2'],
			dueBuckets: ['overdue']
		};
		expect(matchTask(task, filters, '', noLabels)).toBe(true);
	});

	it('hides the task when a single facet excludes its value', () => {
		const task = makeTask({ statusId: 's-progress', priority: 'low' });
		const filters: TaskFilters = { statusIds: ['s-backlog'], priorities: ['low'] };
		expect(matchTask(task, filters, '', noLabels)).toBe(false);
	});

	it('combines free-text search with exclusion (both must hold)', () => {
		const task = makeTask({ title: 'Ship release', statusId: 's-progress' });
		const filters: TaskFilters = { statusIds: ['s-backlog'] }; // does not exclude s-progress
		expect(matchTask(task, filters, 'ship', noLabels)).toBe(true);
		expect(matchTask(task, filters, 'nope', noLabels)).toBe(false);
	});
});

describe('filterTasks (exclusion)', () => {
	it('returns the original array unchanged when no filters are active', () => {
		const tasks = [makeTask({ id: 'a' }), makeTask({ id: 'b' })];
		expect(filterTasks(tasks, undefined, '', noLabels)).toBe(tasks);
	});

	it('drops the excluded tasks for a flat list', () => {
		const tasks = [
			makeTask({ id: 'a', priority: 'high' }),
			makeTask({ id: 'b', priority: 'low' })
		];
		const out = filterTasks(tasks, { priorities: ['high'] }, '', noLabels);
		expect(out.map((t) => t.id)).toEqual(['b']);
	});

	it('keeps a non-excluded sub-task and pulls in its parent for context', () => {
		const tasks = [
			makeTask({ id: 'parent', priority: 'low' }), // excluded
			makeTask({ id: 'child', parentId: 'parent', priority: 'high' }) // kept
		];
		const out = filterTasks(tasks, { priorities: ['low'] }, '', noLabels);
		expect(out.map((t) => t.id).sort()).toEqual(['child', 'parent']);
	});

	it('keeps the sub-tasks of a non-excluded parent so an expanded parent retains its rows', () => {
		const tasks = [
			makeTask({ id: 'parent', priority: 'high' }), // kept
			makeTask({ id: 'child', parentId: 'parent', priority: 'low' }) // excluded but pulled in
		];
		const out = filterTasks(tasks, { priorities: ['low'] }, '', noLabels);
		expect(out.map((t) => t.id).sort()).toEqual(['child', 'parent']);
	});

	it('drops a parent whose children are also excluded', () => {
		const tasks = [
			makeTask({ id: 'parent', priority: 'low' }),
			makeTask({ id: 'child', parentId: 'parent', priority: 'low' }),
			makeTask({ id: 'hit', priority: 'high' })
		];
		const out = filterTasks(tasks, { priorities: ['low'] }, '', noLabels);
		expect(out.map((t) => t.id)).toEqual(['hit']);
	});

	it('preserves input order in the filtered output', () => {
		const tasks = [
			makeTask({ id: 'a', priority: 'high' }),
			makeTask({ id: 'b', priority: 'low' }),
			makeTask({ id: 'c', priority: 'high' })
		];
		const out = filterTasks(tasks, { priorities: ['low'] }, '', noLabels);
		expect(out.map((t) => t.id)).toEqual(['a', 'c']);
	});

	it('hides tasks carrying an excluded label across the list', () => {
		const tasks = [makeTask({ id: 'a' }), makeTask({ id: 'b' }), makeTask({ id: 'c' })];
		const helpers = labelsBy({ a: ['l-1'], b: ['l-2'] });
		const out = filterTasks(tasks, { labelIds: ['l-2'] }, '', helpers);
		expect(out.map((t) => t.id)).toEqual(['a', 'c']);
	});
});
