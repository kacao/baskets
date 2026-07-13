import { describe, expect, it } from 'vitest';
import { collectVisibleUserIds, computeProjectRollupText } from '$lib/server/projectLoad';

describe('collectVisibleUserIds', () => {
	it('preserves the base set untouched when there is nothing to add', () => {
		const base = new Set(['u1']);
		const out = collectVisibleUserIds(base, [], [], [], [], []);
		expect(out).toBe(base); // mutates + returns the same instance
		expect([...out]).toEqual(['u1']);
	});

	it('collects task assigneeIds, skipping null', () => {
		const out = collectVisibleUserIds(
			new Set(),
			[{ assigneeId: 'u1' }, { assigneeId: null }, { assigneeId: 'u2' }],
			[],
			[],
			[],
			[]
		);
		expect([...out].sort()).toEqual(['u1', 'u2']);
	});

	it('collects ids from a single-value task-level person field', () => {
		const out = collectVisibleUserIds(
			new Set(),
			[],
			[{ id: 'f1', type: 'person', config: {} }],
			[{ taskId: 't1', fieldId: 'f1', value: JSON.stringify(['u9']) }],
			[],
			[]
		);
		expect([...out]).toEqual(['u9']);
	});

	it('collects ids from a multi-value task-level person field', () => {
		const out = collectVisibleUserIds(
			new Set(),
			[],
			[{ id: 'f1', type: 'person', config: {} }],
			[{ taskId: 't1', fieldId: 'f1', value: JSON.stringify(['u1', 'u2', 'u3']) }],
			[],
			[]
		);
		expect([...out].sort()).toEqual(['u1', 'u2', 'u3']);
	});

	it('collects ids from a project-level person field', () => {
		const out = collectVisibleUserIds(
			new Set(),
			[],
			[],
			[],
			[{ id: 'pf1', type: 'person', config: {} }],
			[{ projectId: 'p1', fieldId: 'pf1', value: JSON.stringify(['u5', 'u6']) }]
		);
		expect([...out].sort()).toEqual(['u5', 'u6']);
	});

	it('ignores non-person fields (task-level and project-level)', () => {
		const out = collectVisibleUserIds(
			new Set(['keep']),
			[],
			[{ id: 'f1', type: 'text', config: {} }],
			[{ taskId: 't1', fieldId: 'f1', value: 'hello' }],
			[{ id: 'pf1', type: 'number', config: {} }],
			[{ projectId: 'p1', fieldId: 'pf1', value: '42' }]
		);
		expect([...out]).toEqual(['keep']);
	});

	it('ignores values for a different field id than the person field', () => {
		const out = collectVisibleUserIds(
			new Set(),
			[],
			[{ id: 'f1', type: 'person', config: {} }],
			[{ taskId: 't1', fieldId: 'other', value: JSON.stringify(['u1']) }],
			[],
			[]
		);
		expect([...out]).toEqual([]);
	});

	it('combines the base set, assignees, and person-field values without duplicates', () => {
		const out = collectVisibleUserIds(
			new Set(['u1']),
			[{ assigneeId: 'u2' }],
			[{ id: 'f1', type: 'person', config: {} }],
			[{ taskId: 't1', fieldId: 'f1', value: JSON.stringify(['u1', 'u3']) }],
			[{ id: 'pf1', type: 'person', config: {} }],
			[{ projectId: 'p1', fieldId: 'pf1', value: JSON.stringify(['u4']) }]
		);
		expect([...out].sort()).toEqual(['u1', 'u2', 'u3', 'u4']);
	});
});

describe('computeProjectRollupText', () => {
	const rollupTasks = [
		{ id: 't1', parentId: null },
		{ id: 't2', parentId: null },
		{ id: 't3', parentId: null }
	];

	it('returns an empty record for no rollup fields', () => {
		expect(computeProjectRollupText([], [], [], rollupTasks, [])).toEqual({});
	});

	it('renders a count formula as String(n), without needing a resolvable target', () => {
		const rollupField = {
			id: 'r1',
			type: 'rollup',
			config: { relation: 'task', targetFieldId: 'missing', formula: 'count' }
		};
		const out = computeProjectRollupText([rollupField], [], [], rollupTasks, []);
		expect(out).toEqual({ r1: '3' });
	});

	it('formats a sum via the target task-facing field config', () => {
		const rollupField = {
			id: 'r1',
			type: 'rollup',
			config: { relation: 'task', targetFieldId: 'hours', formula: 'sum' }
		};
		const targetField = { id: 'hours', type: 'number', config: { numberFormat: 'number' } };
		const rollupValues = [
			{ taskId: 't1', fieldId: 'hours', value: '10' },
			{ taskId: 't2', fieldId: 'hours', value: '5' },
			{ taskId: 't3', fieldId: 'hours', value: 'not-a-number' }
		];
		const out = computeProjectRollupText([rollupField], [targetField], [], rollupTasks, rollupValues);
		expect(out).toEqual({ r1: '15' });
	});

	it('resolves the target field from customFields before falling back to projectFields', () => {
		const rollupField = {
			id: 'r1',
			type: 'rollup',
			config: { relation: 'task', targetFieldId: 'hours', formula: 'average' }
		};
		const taskField = { id: 'hours', type: 'number', config: { numberFormat: 'currency', currencyCode: 'USD' } };
		const rollupValues = [
			{ taskId: 't1', fieldId: 'hours', value: '10' },
			{ taskId: 't2', fieldId: 'hours', value: '20' }
		];
		const out = computeProjectRollupText(
			[rollupField],
			[taskField],
			[rollupField],
			rollupTasks,
			rollupValues
		);
		expect(out.r1).toBe(new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(15));
	});

	it('falls back to projectFields when the target is a project-entity (non-rollup) field, not in customFields', () => {
		const rollupField = {
			id: 'r1',
			type: 'rollup',
			config: { relation: 'task', targetFieldId: 'proj-num', formula: 'sum' }
		};
		const projectNumberField = { id: 'proj-num', type: 'number', config: { numberFormat: 'number' } };
		// No custom (task-facing) fields at all — target only resolvable via the
		// full projectFields list, proving the fallback lookup still works.
		const out = computeProjectRollupText(
			[rollupField],
			[],
			[rollupField, projectNumberField],
			rollupTasks,
			[]
		);
		// No values recorded against 'proj-num' in rollupValues -> sum of nothing -> 0
		expect(out.r1).toBe(new Intl.NumberFormat().format(0));
	});

	it('stringifies the raw number when no target field resolves at all (formula != count)', () => {
		const rollupField = {
			id: 'r1',
			type: 'rollup',
			config: { relation: 'task', targetFieldId: 'missing', formula: 'sum' }
		};
		const out = computeProjectRollupText([rollupField], [], [], rollupTasks, []);
		expect(out).toEqual({ r1: '0' });
	});
});
