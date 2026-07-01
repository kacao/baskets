import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	filterTasks,
	matchTask,
	type FilterableTask,
	type FilterHelpers
} from '$lib/taskFilter';
import { sortTasks, type SortableTask, type SortHelpers } from '$lib/taskSort';

// Pin "today" so any due-date-derived behavior stays deterministic.
const NOW = new Date(2026, 5, 15, 9, 0, 0); // 2026-06-15 09:00 local

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(NOW);
});

afterEach(() => {
	vi.useRealTimers();
});

function makeFilterable(over: Partial<FilterableTask> = {}): FilterableTask {
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

const noLabels: FilterHelpers = { labelIdsOf: () => [] };

function makeSortable(over: Partial<SortableTask> & { id: string }): SortableTask {
	return {
		title: 'Task',
		priority: 'none',
		order: null,
		statusId: 's-default',
		assigneeId: null,
		dueDate: null,
		createdAt: null,
		...over
	};
}

const ids = (tasks: SortableTask[]) => tasks.map((t) => t.id);

// The free-text query is matched via String.includes (substring), NOT a RegExp,
// so regex metacharacters must be taken literally and can never throw.
describe('matchTask — regex-special characters in the search query', () => {
	it('treats a query with a literal asterisk as a plain substring', () => {
		const task = makeFilterable({ title: 'rate is 5 * 3' });
		expect(matchTask(task, undefined, '5 * 3', noLabels)).toBe(true);
	});

	it('does not treat a lone asterisk as a wildcard matching arbitrary text', () => {
		const task = makeFilterable({ title: 'no star here' });
		expect(matchTask(task, undefined, '*', noLabels)).toBe(false);
	});

	it('matches a query containing plus and question mark literally', () => {
		const task = makeFilterable({ title: 'C++ FAQ?' });
		expect(matchTask(task, undefined, 'C++ FAQ?', noLabels)).toBe(true);
	});

	it('matches an unbalanced open parenthesis literally without throwing', () => {
		const task = makeFilterable({ title: 'call foo( then bar' });
		expect(() => matchTask(task, undefined, 'foo(', noLabels)).not.toThrow();
		expect(matchTask(task, undefined, 'foo(', noLabels)).toBe(true);
	});

	it('matches an unbalanced close parenthesis literally', () => {
		const task = makeFilterable({ title: 'end) of line' });
		expect(matchTask(task, undefined, 'end)', noLabels)).toBe(true);
	});

	it('matches a literal open bracket without treating it as a character class', () => {
		const task = makeFilterable({ title: 'arr[0] index' });
		expect(matchTask(task, undefined, 'arr[0]', noLabels)).toBe(true);
	});

	it('matches a mixed cluster of metacharacters literally', () => {
		const task = makeFilterable({ title: 'weird *+?()[ token' });
		expect(matchTask(task, undefined, '*+?()[', noLabels)).toBe(true);
	});
});

describe('matchTask — searchableText (custom-field search map)', () => {
	it('matches when the query is only present in the searchableText, not title or description', () => {
		const task = makeFilterable({ id: 'x', title: 'Inspect', description: null });
		const helpers: FilterHelpers = {
			labelIdsOf: () => [],
			searchableText: (id) => (id === 'x' ? 'Concrete foundation report' : '')
		};
		expect(matchTask(task, undefined, 'foundation', helpers)).toBe(true);
	});

	it('does not throw when searchableText is provided but returns empty string', () => {
		const task = makeFilterable({ id: 'x', title: 'Plain' });
		const helpers: FilterHelpers = { labelIdsOf: () => [], searchableText: () => '' };
		expect(matchTask(task, undefined, 'plain', helpers)).toBe(true);
		expect(matchTask(task, undefined, 'missing', helpers)).toBe(false);
	});

	it('matches searchableText case-insensitively', () => {
		const task = makeFilterable({ id: 'x', title: 'A', description: null });
		const helpers: FilterHelpers = { labelIdsOf: () => [], searchableText: () => 'UPPER Region' };
		expect(matchTask(task, undefined, 'upper', helpers)).toBe(true);
	});

	it('ignores searchableText metacharacters, matching them literally', () => {
		const task = makeFilterable({ id: 'x', title: 'A', description: null });
		const helpers: FilterHelpers = {
			labelIdsOf: () => [],
			searchableText: () => 'value (a+b)*'
		};
		expect(matchTask(task, undefined, '(a+b)*', helpers)).toBe(true);
	});
});

// Empty PRESENT array = active facet that shows nothing; ABSENT key = inactive facet
// that shows everything. Verify this asymmetry across each facet key.
describe('matchTask — empty present array vs absent facet key', () => {
	it('hides a task when a present status facet is empty', () => {
		expect(matchTask(makeFilterable(), { statusIds: [] }, '', noLabels)).toBe(false);
	});

	it('shows a task when the status facet key is absent', () => {
		expect(matchTask(makeFilterable(), {}, '', noLabels)).toBe(true);
	});

	it('hides a task when a present priority facet is empty', () => {
		expect(matchTask(makeFilterable(), { priorities: [] }, '', noLabels)).toBe(false);
	});

	it('hides a task when a present assignee facet is empty', () => {
		expect(matchTask(makeFilterable(), { assigneeIds: [] }, '', noLabels)).toBe(false);
	});

	it('hides a task when a present milestone facet is empty', () => {
		expect(matchTask(makeFilterable(), { milestoneIds: [] }, '', noLabels)).toBe(false);
	});

	it('hides a task when a present due-bucket facet is empty', () => {
		expect(matchTask(makeFilterable(), { dueBuckets: [] }, '', noLabels)).toBe(false);
	});

	it('hides a task when a present label facet is empty', () => {
		expect(matchTask(makeFilterable({ id: 't1' }), { labelIds: [] }, '', noLabels)).toBe(false);
	});

	it('shows a task when only an unrelated facet key is present and includes its value', () => {
		const task = makeFilterable({ statusId: 's-backlog', priority: 'high' });
		// priorities absent (inactive) → priority not filtered; status present and matches
		expect(matchTask(task, { statusIds: ['s-backlog'] }, '', noLabels)).toBe(true);
	});
});

describe('filterTasks — empty present facet drops everything', () => {
	it('returns an empty list when a present facet array is empty (active but shows nothing)', () => {
		const tasks = [makeFilterable({ id: 'a' }), makeFilterable({ id: 'b' })];
		// hasActiveFilters is true for a present empty array, so filtering runs and keeps nothing
		expect(filterTasks(tasks, { statusIds: [] }, '', noLabels)).toEqual([]);
	});

	it('returns the original array reference when every facet key is absent and no search', () => {
		const tasks = [makeFilterable({ id: 'a' }), makeFilterable({ id: 'b' })];
		expect(filterTasks(tasks, {}, '', noLabels)).toBe(tasks);
	});
});

// The 'due' comparator sends null/undefined/invalid dueDate to the end (returns +1
// when a is null, -1 when b is null); valid dates order ascending. toTime treats
// undefined the same as null.
describe('sortTasks — due with a mix of null, undefined and valid dates', () => {
	it('orders valid dates ascending and sinks both null and undefined to the end', () => {
		const input = [
			makeSortable({ id: 'nullDue', dueDate: null }),
			makeSortable({ id: 'late', dueDate: '2026-12-01' }),
			makeSortable({ id: 'undef', dueDate: undefined as unknown as null }),
			makeSortable({ id: 'early', dueDate: '2026-01-01' })
		];
		const out = ids(sortTasks(input, 'due'));
		// dated rows come first in ascending order
		expect(out.slice(0, 2)).toEqual(['early', 'late']);
		// the two undated rows sink to the end, keeping their relative input order (stable)
		expect(out.slice(2)).toEqual(['nullDue', 'undef']);
	});

	it('keeps undated rows in stable relative order among themselves', () => {
		const input = [
			makeSortable({ id: 'n1', dueDate: null }),
			makeSortable({ id: 'n2', dueDate: undefined as unknown as null }),
			makeSortable({ id: 'n3', dueDate: null })
		];
		// all compare equal (null vs null → 0), so input order is preserved
		expect(ids(sortTasks(input, 'due'))).toEqual(['n1', 'n2', 'n3']);
	});

	it('treats an unparseable date string as no-due and sinks it to the end', () => {
		const input = [
			makeSortable({ id: 'bad', dueDate: 'not-a-date' }),
			makeSortable({ id: 'good', dueDate: '2026-05-01' })
		];
		// toTime returns null for a NaN timestamp, so 'bad' sorts after 'good'
		expect(ids(sortTasks(input, 'due'))).toEqual(['good', 'bad']);
	});
});

// When a helper returns null (e.g. an unknown assignee id or an unranked status),
// sorting must not throw and must apply the documented sink/ordering behavior.
describe('sortTasks — helpers returning null do not crash', () => {
	it('sinks a task whose assigneeName resolves to null to the end', () => {
		const helpers: SortHelpers = {
			assigneeName: (id) => (id === 'u1' ? 'Alice' : null)
		};
		const input = [
			makeSortable({ id: 'unknown', assigneeId: 'ghost' }), // resolves null
			makeSortable({ id: 'alice', assigneeId: 'u1' })
		];
		expect(() => sortTasks(input, 'assignee', helpers)).not.toThrow();
		expect(ids(sortTasks(input, 'assignee', helpers))).toEqual(['alice', 'unknown']);
	});

	it('keeps two null-name assignees in stable input order', () => {
		const helpers: SortHelpers = { assigneeName: () => null };
		const input = [
			makeSortable({ id: 'a', assigneeId: 'x' }),
			makeSortable({ id: 'b', assigneeId: 'y' })
		];
		// both names null → cmp returns 0 → original index tiebreak preserves order
		expect(ids(sortTasks(input, 'assignee', helpers))).toEqual(['a', 'b']);
	});

	it('does not crash when the default assigneeName helper is passed a null assigneeId', () => {
		// default helper returns the id itself, which is null for unassigned → sinks last
		const input = [
			makeSortable({ id: 'unassigned', assigneeId: null }),
			makeSortable({ id: 'named', assigneeId: 'zeta' })
		];
		expect(() => sortTasks(input, 'assignee')).not.toThrow();
		expect(ids(sortTasks(input, 'assignee'))).toEqual(['named', 'unassigned']);
	});

	it('does not crash when statusRank helper is absent (all ranks default to 0)', () => {
		const input = [
			makeSortable({ id: 'a', statusId: 'done' }),
			makeSortable({ id: 'b', statusId: 'backlog' })
		];
		// no statusRank → every rank 0 → stable input order, no throw
		expect(() => sortTasks(input, 'status')).not.toThrow();
		expect(ids(sortTasks(input, 'status'))).toEqual(['a', 'b']);
	});
});
