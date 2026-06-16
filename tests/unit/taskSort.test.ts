import { describe, expect, it } from 'vitest';
import {
	parseSortBy,
	sortTasks,
	SORT_KEYS,
	type SortableTask,
	type SortHelpers
} from '$lib/taskSort';

function task(overrides: Partial<SortableTask> & { id: string }): SortableTask {
	return {
		title: 'Task',
		priority: 'none',
		order: null,
		statusId: 's-default',
		assigneeId: null,
		dueDate: null,
		createdAt: null,
		...overrides
	};
}

const ids = (tasks: SortableTask[]) => tasks.map((t) => t.id);

describe('parseSortBy', () => {
	it('returns null key for empty / nullish input', () => {
		expect(parseSortBy(null)).toEqual({ key: null, desc: false });
		expect(parseSortBy(undefined)).toEqual({ key: null, desc: false });
		expect(parseSortBy('')).toEqual({ key: null, desc: false });
	});

	it('parses a bare key in natural (ascending) direction', () => {
		expect(parseSortBy('title')).toEqual({ key: 'title', desc: false });
	});

	it('parses a :desc suffix', () => {
		expect(parseSortBy('due:desc')).toEqual({ key: 'due', desc: true });
	});

	it('treats a non-desc direction suffix as natural direction', () => {
		expect(parseSortBy('title:asc')).toEqual({ key: 'title', desc: false });
	});

	it('returns null key for an unknown key', () => {
		expect(parseSortBy('bogus')).toEqual({ key: null, desc: false });
		expect(parseSortBy('bogus:desc')).toEqual({ key: null, desc: true });
	});

	it('accepts every key in SORT_KEYS', () => {
		for (const key of SORT_KEYS) {
			expect(parseSortBy(key)).toEqual({ key, desc: false });
		}
	});
});

describe('sortTasks — no/unknown key', () => {
	it('returns a shallow copy in input order with no key', () => {
		const input = [task({ id: 'a' }), task({ id: 'b' }), task({ id: 'c' })];
		const out = sortTasks(input, null);
		expect(ids(out)).toEqual(['a', 'b', 'c']);
		expect(out).not.toBe(input);
	});

	it('returns input order for an unknown key', () => {
		const input = [task({ id: 'b' }), task({ id: 'a' })];
		expect(ids(sortTasks(input, 'nope'))).toEqual(['b', 'a']);
	});

	it('never mutates the input array', () => {
		const input = [task({ id: 'b', title: 'B' }), task({ id: 'a', title: 'A' })];
		const before = ids(input);
		sortTasks(input, 'title');
		expect(ids(input)).toEqual(before);
	});
});

describe('sortTasks — priority', () => {
	it('orders urgent → none (natural desc)', () => {
		const input = [
			task({ id: 'low', priority: 'low' }),
			task({ id: 'urgent', priority: 'urgent' }),
			task({ id: 'none', priority: 'none' }),
			task({ id: 'high', priority: 'high' }),
			task({ id: 'medium', priority: 'medium' })
		];
		expect(ids(sortTasks(input, 'priority'))).toEqual([
			'urgent',
			'high',
			'medium',
			'low',
			'none'
		]);
	});

	it(':desc flips to none → urgent', () => {
		const input = [
			task({ id: 'urgent', priority: 'urgent' }),
			task({ id: 'none', priority: 'none' }),
			task({ id: 'medium', priority: 'medium' })
		];
		expect(ids(sortTasks(input, 'priority:desc'))).toEqual(['none', 'medium', 'urgent']);
	});

	it('treats an unrecognised priority value as rank 0 (none)', () => {
		const input = [
			task({ id: 'bogus', priority: 'whatever' }),
			task({ id: 'high', priority: 'high' })
		];
		expect(ids(sortTasks(input, 'priority'))).toEqual(['high', 'bogus']);
	});
});

describe('sortTasks — order', () => {
	it('orders ascending by manual order number', () => {
		const input = [
			task({ id: 'c', order: 30 }),
			task({ id: 'a', order: 10 }),
			task({ id: 'b', order: 20 })
		];
		expect(ids(sortTasks(input, 'order'))).toEqual(['a', 'b', 'c']);
	});

	it('sinks null order to the end (nulls last)', () => {
		const input = [
			task({ id: 'null1', order: null }),
			task({ id: 'two', order: 2 }),
			task({ id: 'null2', order: null }),
			task({ id: 'one', order: 1 })
		];
		const out = ids(sortTasks(input, 'order'));
		expect(out).toEqual(['one', 'two', 'null1', 'null2']);
	});
});

describe('sortTasks — title', () => {
	it('orders case-insensitively A→Z', () => {
		const input = [
			task({ id: 'b', title: 'banana' }),
			task({ id: 'A', title: 'Apple' }),
			task({ id: 'c', title: 'Cherry' })
		];
		expect(ids(sortTasks(input, 'title'))).toEqual(['A', 'b', 'c']);
	});

	it(':desc reverses to Z→A', () => {
		const input = [
			task({ id: 'a', title: 'Apple' }),
			task({ id: 'c', title: 'Cherry' }),
			task({ id: 'b', title: 'banana' })
		];
		expect(ids(sortTasks(input, 'title:desc'))).toEqual(['c', 'b', 'a']);
	});
});

describe('sortTasks — due', () => {
	it('orders earliest due date first', () => {
		const input = [
			task({ id: 'late', dueDate: '2026-12-01' }),
			task({ id: 'early', dueDate: '2026-01-01' }),
			task({ id: 'mid', dueDate: '2026-06-01' })
		];
		expect(ids(sortTasks(input, 'due'))).toEqual(['early', 'mid', 'late']);
	});

	it('sinks no-due tasks to the end in both directions', () => {
		const input = [
			task({ id: 'none1', dueDate: null }),
			task({ id: 'b', dueDate: '2026-06-01' }),
			task({ id: 'a', dueDate: '2026-01-01' })
		];
		expect(ids(sortTasks(input, 'due'))).toEqual(['a', 'b', 'none1']);
		// ':desc' negates the whole comparator, including the +1/-1 the null
		// branch returns — so no-due flips to the FRONT and dated rows reverse
		expect(ids(sortTasks(input, 'due:desc'))).toEqual(['none1', 'b', 'a']);
	});

	it('accepts Date objects as well as strings', () => {
		const input = [
			task({ id: 'late', dueDate: new Date('2026-12-01') }),
			task({ id: 'early', dueDate: new Date('2026-01-01') })
		];
		expect(ids(sortTasks(input, 'due'))).toEqual(['early', 'late']);
	});
});

describe('sortTasks — status', () => {
	const helpers: SortHelpers = {
		statusRank: (id) => ({ backlog: 0, 'in-progress': 1, done: 2 })[id] ?? 99
	};

	it('orders by the project status ranking', () => {
		const input = [
			task({ id: 'd', statusId: 'done' }),
			task({ id: 'b', statusId: 'backlog' }),
			task({ id: 'p', statusId: 'in-progress' })
		];
		expect(ids(sortTasks(input, 'status', helpers))).toEqual(['b', 'p', 'd']);
	});

	it('treats all statuses equal when no statusRank helper is given', () => {
		const input = [
			task({ id: 'a', statusId: 'done' }),
			task({ id: 'b', statusId: 'backlog' })
		];
		// every rank is 0 → stable input order
		expect(ids(sortTasks(input, 'status'))).toEqual(['a', 'b']);
	});
});

describe('sortTasks — assignee', () => {
	const helpers: SortHelpers = {
		assigneeName: (id) =>
			({ u1: 'Alice', u2: 'bob', u3: 'Carol' })[id ?? ''] ?? null
	};

	it('orders by assignee display name A→Z, case-insensitive', () => {
		const input = [
			task({ id: 'carol', assigneeId: 'u3' }),
			task({ id: 'alice', assigneeId: 'u1' }),
			task({ id: 'bob', assigneeId: 'u2' })
		];
		expect(ids(sortTasks(input, 'assignee', helpers))).toEqual(['alice', 'bob', 'carol']);
	});

	it('sinks unassigned (no name) to the end', () => {
		const input = [
			task({ id: 'unassigned', assigneeId: null }),
			task({ id: 'alice', assigneeId: 'u1' })
		];
		expect(ids(sortTasks(input, 'assignee', helpers))).toEqual(['alice', 'unassigned']);
	});

	it('default assigneeName helper falls back to the id', () => {
		const input = [
			task({ id: 'z', assigneeId: 'zeta' }),
			task({ id: 'a', assigneeId: 'alpha' })
		];
		expect(ids(sortTasks(input, 'assignee'))).toEqual(['a', 'z']);
	});
});

describe('sortTasks — createdAt', () => {
	it('orders oldest first', () => {
		const input = [
			task({ id: 'new', createdAt: '2026-06-01' }),
			task({ id: 'old', createdAt: '2026-01-01' }),
			task({ id: 'mid', createdAt: '2026-03-01' })
		];
		expect(ids(sortTasks(input, 'createdAt'))).toEqual(['old', 'mid', 'new']);
	});

	it('treats missing createdAt as epoch (sorts first)', () => {
		const input = [
			task({ id: 'dated', createdAt: '2026-01-01' }),
			task({ id: 'undated', createdAt: null })
		];
		expect(ids(sortTasks(input, 'createdAt'))).toEqual(['undated', 'dated']);
	});
});

describe('sortTasks — stability', () => {
	it('ties keep input order (priority)', () => {
		const input = [
			task({ id: 'a', priority: 'high' }),
			task({ id: 'b', priority: 'high' }),
			task({ id: 'c', priority: 'high' })
		];
		expect(ids(sortTasks(input, 'priority'))).toEqual(['a', 'b', 'c']);
	});

	it('ties keep input order even when reversed with :desc', () => {
		const input = [
			task({ id: 'a', priority: 'medium' }),
			task({ id: 'b', priority: 'medium' }),
			task({ id: 'c', priority: 'medium' })
		];
		// :desc flips the comparator result, but equal elements (cmp === 0) fall
		// through to the original-index tiebreak, so order is preserved (not reversed)
		expect(ids(sortTasks(input, 'priority:desc'))).toEqual(['a', 'b', 'c']);
	});

	it('partial ties preserve relative order within each group', () => {
		const input = [
			task({ id: 'h1', priority: 'high' }),
			task({ id: 'l1', priority: 'low' }),
			task({ id: 'h2', priority: 'high' }),
			task({ id: 'l2', priority: 'low' })
		];
		expect(ids(sortTasks(input, 'priority'))).toEqual(['h1', 'h2', 'l1', 'l2']);
	});
});

describe('sortTasks — edge cases', () => {
	it('handles an empty array', () => {
		expect(sortTasks([], 'priority')).toEqual([]);
	});

	it('handles a single-element array', () => {
		const input = [task({ id: 'solo' })];
		expect(ids(sortTasks(input, 'title'))).toEqual(['solo']);
	});
});
