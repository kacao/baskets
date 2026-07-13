import { describe, expect, it } from 'vitest';
import {
	rollupAggregate,
	computeTaskRollup,
	rollsUpToParent,
	numberRollupConfig,
	rollupDisplayText
} from '$lib/customFields';

describe('rollupAggregate', () => {
	it('returns the related count for the count formula, ignoring the values array', () => {
		expect(rollupAggregate('count', [1, 2, 3, 4], 2)).toBe(2);
		expect(rollupAggregate('count', [], 5)).toBe(5);
	});

	it('sums finite values', () => {
		expect(rollupAggregate('sum', [10, 20, 30], 3)).toBe(60);
	});

	it('averages finite values', () => {
		expect(rollupAggregate('average', [2, 4, 6], 3)).toBe(4);
	});

	it('returns the minimum finite value', () => {
		expect(rollupAggregate('min', [7, -3, 4], 3)).toBe(-3);
	});

	it('returns the maximum finite value', () => {
		expect(rollupAggregate('max', [7, -3, 4], 3)).toBe(7);
	});

	it('sums to zero for an empty values array', () => {
		expect(rollupAggregate('sum', [], 0)).toBe(0);
	});

	it('averages an empty values array to zero (not NaN)', () => {
		expect(rollupAggregate('average', [], 0)).toBe(0);
	});

	it('returns zero for min/max over an empty values array', () => {
		expect(rollupAggregate('min', [], 0)).toBe(0);
		expect(rollupAggregate('max', [], 0)).toBe(0);
	});

	it('filters out non-finite values before aggregating', () => {
		expect(rollupAggregate('sum', [1, NaN, 2, Infinity, 3, -Infinity], 6)).toBe(6);
		expect(rollupAggregate('average', [2, NaN, 4], 3)).toBe(3);
		expect(rollupAggregate('max', [5, Infinity, 1], 3)).toBe(5);
		expect(rollupAggregate('min', [5, -Infinity, 1], 3)).toBe(1);
	});

	it('returns zero for an unknown formula', () => {
		expect(rollupAggregate('median', [1, 2, 3], 3)).toBe(0);
	});
});

describe('computeTaskRollup', () => {
	const tasks = [
		{ id: 'p', parentId: null },
		{ id: 'a', parentId: 'p' },
		{ id: 'b', parentId: 'p' },
		{ id: 'c', parentId: null }
	];

	it('rolls up over direct sub-tasks for the sub-task relation', () => {
		const vals: Record<string, number> = { a: 3, b: 7 };
		const n = computeTaskRollup(
			{ relation: 'sub-task', targetFieldId: 'hours', formula: 'sum' },
			'p',
			{ tasks, taskDeps: [], valueOf: (tid) => vals[tid] ?? null }
		);
		expect(n).toBe(10);
	});

	it('rolls up over the tasks this task is blocked by', () => {
		const vals: Record<string, number> = { a: 4, b: 6 };
		const n = computeTaskRollup(
			{ relation: 'blocked-by', targetFieldId: 'hours', formula: 'sum' },
			'p',
			{
				tasks,
				taskDeps: [
					{ taskId: 'p', dependsOnId: 'a' },
					{ taskId: 'p', dependsOnId: 'b' }
				],
				valueOf: (tid) => vals[tid] ?? null
			}
		);
		expect(n).toBe(10);
	});

	it('rolls up over the tasks this task is blocking', () => {
		const vals: Record<string, number> = { a: 8, b: 2 };
		const n = computeTaskRollup(
			{ relation: 'blocking', targetFieldId: 'hours', formula: 'sum' },
			'p',
			{
				tasks,
				taskDeps: [
					{ taskId: 'a', dependsOnId: 'p' },
					{ taskId: 'b', dependsOnId: 'p' }
				],
				valueOf: (tid) => vals[tid] ?? null
			}
		);
		expect(n).toBe(10);
	});

	it('rolls up over every other project task for the task relation, excluding itself', () => {
		const vals: Record<string, number> = { p: 100, a: 1, b: 2, c: 3 };
		const n = computeTaskRollup({ relation: 'task', targetFieldId: 'hours', formula: 'sum' }, 'p', {
			tasks,
			taskDeps: [],
			valueOf: (tid) => vals[tid] ?? null
		});
		// excludes p's own 100; sums a+b+c = 6
		expect(n).toBe(6);
	});

	it('counts related items for the count formula regardless of their values', () => {
		const n = computeTaskRollup(
			{ relation: 'sub-task', targetFieldId: 'hours', formula: 'count' },
			'p',
			{ tasks, taskDeps: [], valueOf: () => null }
		);
		expect(n).toBe(2);
	});

	it('filters out related items whose valueOf returns null before aggregating', () => {
		const vals: Record<string, number | null> = { a: 5, b: null };
		const n = computeTaskRollup(
			{ relation: 'sub-task', targetFieldId: 'hours', formula: 'average' },
			'p',
			{ tasks, taskDeps: [], valueOf: (tid) => vals[tid] ?? null }
		);
		// b is dropped, so average is over [5] = 5, not (5+0)/2
		expect(n).toBe(5);
	});

	it('returns zero when a task has no related items', () => {
		const n = computeTaskRollup(
			{ relation: 'sub-task', targetFieldId: 'hours', formula: 'sum' },
			'c',
			{ tasks, taskDeps: [], valueOf: () => 99 }
		);
		expect(n).toBe(0);
	});
});

describe('rollsUpToParent', () => {
	it('is true for a number field with rollupToParent and appliesTo other than "tasks"', () => {
		expect(
			rollsUpToParent({ type: 'number', config: { rollupToParent: true }, appliesTo: 'all' })
		).toBe(true);
		expect(
			rollsUpToParent({ type: 'number', config: { rollupToParent: true }, appliesTo: 'subtasks' })
		).toBe(true);
	});

	it('defaults an unset appliesTo to "all" and stays true', () => {
		expect(rollsUpToParent({ type: 'number', config: { rollupToParent: true } })).toBe(true);
	});

	it('is false for a "tasks"-only field', () => {
		expect(
			rollsUpToParent({ type: 'number', config: { rollupToParent: true }, appliesTo: 'tasks' })
		).toBe(false);
	});

	it('is false when rollupToParent is not exactly true', () => {
		expect(
			rollsUpToParent({ type: 'number', config: { rollupToParent: false }, appliesTo: 'all' })
		).toBe(false);
		expect(rollsUpToParent({ type: 'number', config: {}, appliesTo: 'all' })).toBe(false);
		expect(rollsUpToParent({ type: 'number', config: null, appliesTo: 'all' })).toBe(false);
	});

	it('is false for a non-number field even when rollupToParent is set', () => {
		expect(
			rollsUpToParent({ type: 'rollup', config: { rollupToParent: true }, appliesTo: 'all' })
		).toBe(false);
		expect(
			rollsUpToParent({ type: 'text', config: { rollupToParent: true }, appliesTo: 'all' })
		).toBe(false);
	});
});

describe('numberRollupConfig', () => {
	it('targets the field itself over its direct sub-tasks with the configured formula', () => {
		expect(numberRollupConfig({ id: 'fx', config: { rollupFormula: 'max' } })).toEqual({
			relation: 'sub-task',
			targetFieldId: 'fx',
			formula: 'max'
		});
	});

	it('defaults the formula to "sum" when the config has no rollupFormula', () => {
		expect(numberRollupConfig({ id: 'fx', config: {} }).formula).toBe('sum');
	});

	it('defaults the formula to "sum" when there is no config at all', () => {
		expect(numberRollupConfig({ id: 'fx' })).toEqual({
			relation: 'sub-task',
			targetFieldId: 'fx',
			formula: 'sum'
		});
	});
});

describe('rollupDisplayText', () => {
	const tasks = [
		{ id: 'p', parentId: null },
		{ id: 'a', parentId: 'p' },
		{ id: 'b', parentId: 'p' },
		{ id: 'leaf', parentId: null }
	];
	const vals: Record<string, Record<string, number>> = { a: { hours: 3 }, b: { hours: 7 } };
	const valueOf = (tid: string, fid: string) => vals[tid]?.[fid] ?? null;
	const ctxFor = (
		hasSubtasks: boolean,
		fields: { id: string; config: Record<string, unknown> }[] = []
	) => ({
		tasks,
		taskDeps: [] as { taskId: string; dependsOnId: string }[],
		fields,
		valueOf,
		hasSubtasks
	});

	it('formats a rollup-type non-count value through the target field config', () => {
		const target = { id: 'hours', config: { numberFormat: 'number' } };
		const rollup = {
			id: 'r',
			type: 'rollup',
			config: { relation: 'sub-task', targetFieldId: 'hours', formula: 'sum' } as Record<
				string,
				unknown
			>
		};
		expect(rollupDisplayText(rollup, 'p', ctxFor(true, [target]))).toBe('10');
	});

	it('stringifies a rollup-type count value without a target field', () => {
		const rollup = {
			id: 'r',
			type: 'rollup',
			config: { relation: 'sub-task', targetFieldId: '', formula: 'count' } as Record<
				string,
				unknown
			>
		};
		expect(rollupDisplayText(rollup, 'p', ctxFor(true))).toBe('2');
	});

	it('stringifies the raw aggregate when the rollup target field is missing', () => {
		// non-count formula but no matching target field in ctx.fields → String(n), not formatNumber.
		// valueOf(id, 'gone') resolves to null for every sub-task, so the aggregate is 0.
		const rollup = {
			id: 'r',
			type: 'rollup',
			config: { relation: 'sub-task', targetFieldId: 'gone', formula: 'sum' } as Record<
				string,
				unknown
			>
		};
		expect(rollupDisplayText(rollup, 'p', ctxFor(true, []))).toBe('0');
	});

	it('computes a number rollup-to-parent value only when the task has sub-tasks', () => {
		const field = {
			id: 'hours',
			type: 'number',
			config: { rollupToParent: true, rollupFormula: 'sum' } as Record<string, unknown>,
			appliesTo: 'all'
		};
		expect(rollupDisplayText(field, 'p', ctxFor(true))).toBe('10');
	});

	it('returns null for a rollup-to-parent field on a leaf with no sub-tasks', () => {
		const field = {
			id: 'hours',
			type: 'number',
			config: { rollupToParent: true, rollupFormula: 'sum' } as Record<string, unknown>,
			appliesTo: 'all'
		};
		expect(rollupDisplayText(field, 'leaf', ctxFor(false))).toBeNull();
	});

	it('returns null for a plain (non-rollup) number field', () => {
		const field = {
			id: 'hours',
			type: 'number',
			config: {} as Record<string, unknown>,
			appliesTo: 'all'
		};
		expect(rollupDisplayText(field, 'p', ctxFor(true))).toBeNull();
	});

	it('returns null when a rollup-to-parent field is not applicable (tasks-only, so rollsUpToParent is false)', () => {
		const field = {
			id: 'hours',
			type: 'number',
			config: { rollupToParent: true, rollupFormula: 'sum' } as Record<string, unknown>,
			appliesTo: 'tasks'
		};
		expect(rollupDisplayText(field, 'p', ctxFor(true))).toBeNull();
	});
});
