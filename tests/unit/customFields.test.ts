import { describe, expect, it } from 'vitest';
import {
	decodeValue,
	defaultConfig,
	sanitizeConfig,
	formatNumber,
	formatDate,
	fieldAppliesTo,
	isMulti,
	rollupAggregate,
	computeTaskRollup,
	rollsUpToParent,
	numberRollupConfig,
	rollupDisplayText,
	fieldAggregations,
	MULTI_CAPABLE
} from '$lib/customFields';

describe('decodeValue', () => {
	it('returns null for empty scalar values', () => {
		expect(decodeValue({ type: 'text' }, null)).toBeNull();
		expect(decodeValue({ type: 'text' }, undefined)).toBeNull();
		expect(decodeValue({ type: 'text' }, '')).toBeNull();
	});

	it('returns empty array for empty multi-capable values', () => {
		for (const type of MULTI_CAPABLE) {
			expect(decodeValue({ type }, null)).toEqual([]);
			expect(decodeValue({ type }, '')).toEqual([]);
		}
	});

	it('decodes a scalar text value as the raw string', () => {
		expect(decodeValue({ type: 'text' }, 'hello')).toBe('hello');
	});

	it('decodes a number value as its raw string (no coercion)', () => {
		expect(decodeValue({ type: 'number' }, '42')).toBe('42');
	});

	it('decodes checkbox to a boolean', () => {
		expect(decodeValue({ type: 'checkbox' }, 'true')).toBe(true);
		expect(decodeValue({ type: 'checkbox' }, 'false')).toBe(false);
		expect(decodeValue({ type: 'checkbox' }, 'anything')).toBe(false);
	});

	it('decodes a JSON id-array for multi-capable types', () => {
		expect(decodeValue({ type: 'select' }, '["a","b"]')).toEqual(['a', 'b']);
		expect(decodeValue({ type: 'person' }, '["u1"]')).toEqual(['u1']);
		expect(decodeValue({ type: 'place' }, '[]')).toEqual([]);
		expect(decodeValue({ type: 'files' }, '["f1","f2","f3"]')).toEqual(['f1', 'f2', 'f3']);
	});

	it('returns [] when a multi-capable value is malformed JSON', () => {
		expect(decodeValue({ type: 'select' }, 'not-json')).toEqual([]);
	});

	it('returns [] when a multi-capable value is valid JSON but not an array', () => {
		expect(decodeValue({ type: 'select' }, '{"x":1}')).toEqual([]);
		expect(decodeValue({ type: 'person' }, '"u1"')).toEqual([]);
	});
});

describe('defaultConfig', () => {
	it('builds a number default config', () => {
		expect(defaultConfig('number')).toEqual({
			numberFormat: 'number',
			currencyCode: 'USD',
			formatString: '',
			rollupToParent: false,
			rollupFormula: 'sum'
		});
	});

	it('builds a select default config', () => {
		expect(defaultConfig('select')).toEqual({ multi: false, displayOption: 'text' });
	});

	it('builds a date default config', () => {
		expect(defaultConfig('date')).toEqual({ dateFormat: 'full', timeFormat: 'hidden' });
	});

	it('builds a multi:false config for person/place/files/task', () => {
		expect(defaultConfig('person')).toEqual({ multi: false });
		expect(defaultConfig('place')).toEqual({ multi: false });
		expect(defaultConfig('files')).toEqual({ multi: false });
		expect(defaultConfig('task')).toEqual({ multi: false });
	});

	it('returns an empty config for plain scalar types', () => {
		for (const type of ['text', 'checkbox', 'email', 'phone', 'url']) {
			expect(defaultConfig(type)).toEqual({});
		}
	});
});

describe('sanitizeConfig', () => {
	it('coerces a non-object raw to the type default', () => {
		expect(sanitizeConfig('select', null)).toEqual({ multi: false, displayOption: 'text' });
		expect(sanitizeConfig('select', 'garbage')).toEqual({ multi: false, displayOption: 'text' });
	});

	it('falls back invalid number format to "number" and drops currency/formatString', () => {
		expect(sanitizeConfig('number', { numberFormat: 'bogus' })).toEqual({ numberFormat: 'number' });
	});

	it('keeps and uppercases/truncates currencyCode for currency-style formats', () => {
		expect(sanitizeConfig('number', { numberFormat: 'currency', currencyCode: 'eur' })).toEqual({
			numberFormat: 'currency',
			currencyCode: 'EUR'
		});
		expect(sanitizeConfig('number', { numberFormat: 'accounting', currencyCode: '  usdx ' })).toEqual({
			numberFormat: 'accounting',
			currencyCode: 'USD'
		});
	});

	it('defaults currencyCode to USD when missing/blank', () => {
		expect(sanitizeConfig('number', { numberFormat: 'financial' })).toEqual({
			numberFormat: 'financial',
			currencyCode: 'USD'
		});
	});

	it('keeps and caps formatString only for custom format', () => {
		const long = 'x'.repeat(100);
		const out = sanitizeConfig('number', { numberFormat: 'custom', formatString: long });
		expect(out.numberFormat).toBe('custom');
		expect((out.formatString as string).length).toBe(80);
	});

	it('sanitizes select multi + displayOption', () => {
		expect(sanitizeConfig('select', { multi: true, displayOption: 'icon' })).toEqual({
			multi: true,
			displayOption: 'icon'
		});
		expect(sanitizeConfig('select', { multi: 'yes', displayOption: 'nope' })).toEqual({
			multi: false,
			displayOption: 'text'
		});
	});

	it('sanitizes date formats with fallbacks', () => {
		expect(sanitizeConfig('date', { dateFormat: 'mdy', timeFormat: '24h' })).toEqual({
			dateFormat: 'mdy',
			timeFormat: '24h'
		});
		expect(sanitizeConfig('date', { dateFormat: 'bad', timeFormat: 'bad' })).toEqual({
			dateFormat: 'full',
			timeFormat: 'hidden'
		});
	});

	it('sanitizes person/place/files to a multi boolean only', () => {
		expect(sanitizeConfig('person', { multi: true, junk: 1 })).toEqual({ multi: true });
		expect(sanitizeConfig('place', {})).toEqual({ multi: false });
		expect(sanitizeConfig('files', { multi: 'x' })).toEqual({ multi: false });
	});

	it('returns an empty config for scalar types with no settings', () => {
		expect(sanitizeConfig('text', { anything: true })).toEqual({});
		expect(sanitizeConfig('checkbox', { x: 1 })).toEqual({});
	});
});

describe('formatNumber', () => {
	it('returns empty string for non-finite input', () => {
		expect(formatNumber(NaN, { numberFormat: 'number' })).toBe('');
		expect(formatNumber(Infinity, { numberFormat: 'number' })).toBe('');
	});

	it('formats a plain number with grouping', () => {
		expect(formatNumber(1234, { numberFormat: 'number' })).toBe('1,234');
	});

	it('passes the raw number through for custom format (not interpreted in v1)', () => {
		expect(formatNumber(1234.5, { numberFormat: 'custom', formatString: '0.00%' })).toBe('1234.5');
	});

	it('formats currency with the configured currency code', () => {
		const out = formatNumber(5, { numberFormat: 'currency', currencyCode: 'USD' });
		expect(out).toContain('5');
		expect(out).toMatch(/\$|USD/);
	});

	it('defaults to plain grouping when numberFormat is absent', () => {
		expect(formatNumber(1000, {})).toBe('1,000');
	});
});

describe('formatDate', () => {
	it('returns the raw string for an unparseable date', () => {
		expect(formatDate('not-a-date', { dateFormat: 'mdy' })).toBe('not-a-date');
	});

	// Use a date+time ISO so the source's LOCAL getters (getMonth/getDate/getFullYear)
	// land on the same calendar day regardless of the test runner's timezone.
	const iso = '2026-01-05T12:00:00';

	it('formats mdy as zero-padded M/D/Y', () => {
		expect(formatDate(iso, { dateFormat: 'mdy' })).toBe('01/05/2026');
	});

	it('formats dmy as zero-padded D/M/Y', () => {
		expect(formatDate(iso, { dateFormat: 'dmy' })).toBe('05/01/2026');
	});

	it('formats ymd as Y/M/D', () => {
		expect(formatDate(iso, { dateFormat: 'ymd' })).toBe('2026/01/05');
	});

	it('appends a time part when timeFormat is set and the iso has a T', () => {
		const out = formatDate(iso, { dateFormat: 'mdy', timeFormat: '24h' });
		expect(out).toMatch(/^01\/05\/2026 \d{2}:\d{2}$/);
	});

	it('omits the time part when the iso has no T component', () => {
		// date-only string: no time appended even when timeFormat is set
		const out = formatDate('2026-01-05', { dateFormat: 'ymd', timeFormat: '24h' });
		expect(out).not.toContain(':');
	});

	it('produces a relative string for the relative format', () => {
		const out = formatDate(new Date().toISOString(), { dateFormat: 'relative' });
		expect(typeof out).toBe('string');
		expect(out.length).toBeGreaterThan(0);
	});
});

describe('fieldAppliesTo', () => {
	it('applies to both levels when appliesTo is "all" or unset', () => {
		expect(fieldAppliesTo({ appliesTo: 'all' }, false)).toBe(true);
		expect(fieldAppliesTo({ appliesTo: 'all' }, true)).toBe(true);
		expect(fieldAppliesTo({}, false)).toBe(true);
		expect(fieldAppliesTo({ appliesTo: null }, true)).toBe(true);
	});

	it('applies only to top-level tasks when appliesTo is "tasks"', () => {
		expect(fieldAppliesTo({ appliesTo: 'tasks' }, false)).toBe(true);
		expect(fieldAppliesTo({ appliesTo: 'tasks' }, true)).toBe(false);
	});

	it('applies only to sub-tasks when appliesTo is "subtasks"', () => {
		expect(fieldAppliesTo({ appliesTo: 'subtasks' }, true)).toBe(true);
		expect(fieldAppliesTo({ appliesTo: 'subtasks' }, false)).toBe(false);
	});
});

describe('task field is multi-capable', () => {
	it('includes task in the multi-capable set', () => {
		expect(MULTI_CAPABLE.has('task')).toBe(true);
	});

	it('decodes a JSON id-array of task ids', () => {
		expect(decodeValue({ type: 'task' }, '["t1","t2"]')).toEqual(['t1', 't2']);
		expect(decodeValue({ type: 'task' }, '[]')).toEqual([]);
	});

	it('recovers a legacy scalar task id (pre-multi) as a single-element array', () => {
		expect(decodeValue({ type: 'task' }, 'abc-123')).toEqual(['abc-123']);
	});

	it('keeps other multi types returning [] for non-array values (no scalar era)', () => {
		expect(decodeValue({ type: 'select' }, 'not-json')).toEqual([]);
		expect(decodeValue({ type: 'person' }, '"u1"')).toEqual([]);
	});

	it('sanitizes a task config to a multi flag', () => {
		expect(sanitizeConfig('task', { multi: true })).toEqual({ multi: true });
		expect(sanitizeConfig('task', { multi: 'yes', junk: 1 })).toEqual({ multi: false });
		expect(sanitizeConfig('task', null)).toEqual({ multi: false });
	});

	it('isMulti is true only when a task field opts in via config.multi', () => {
		expect(isMulti({ type: 'task', config: { multi: true } })).toBe(true);
		expect(isMulti({ type: 'task', config: { multi: false } })).toBe(false);
		expect(isMulti({ type: 'task', config: {} })).toBe(false);
	});
});

describe('rollup', () => {
	it('aggregates per formula', () => {
		expect(rollupAggregate('count', [], 3)).toBe(3);
		expect(rollupAggregate('sum', [1, 2, 3], 3)).toBe(6);
		expect(rollupAggregate('average', [2, 4], 2)).toBe(3);
		expect(rollupAggregate('min', [5, 2, 9], 3)).toBe(2);
		expect(rollupAggregate('max', [5, 2, 9], 3)).toBe(9);
		expect(rollupAggregate('sum', [], 0)).toBe(0);
	});

	it('counts sub-tasks via computeTaskRollup', () => {
		const tasks = [
			{ id: 'p', parentId: null },
			{ id: 'a', parentId: 'p' },
			{ id: 'b', parentId: 'p' },
			{ id: 'x', parentId: null }
		];
		const n = computeTaskRollup(
			{ relation: 'sub-task', targetFieldId: '', formula: 'count' },
			'p',
			{ tasks, taskDeps: [], valueOf: () => null }
		);
		expect(n).toBe(2);
	});

	it('sums a target field over blocked-by tasks', () => {
		const tasks = [
			{ id: 'p', parentId: null },
			{ id: 'a', parentId: null },
			{ id: 'b', parentId: null }
		];
		const vals: Record<string, number> = { a: 10, b: 5 };
		const n = computeTaskRollup(
			{ relation: 'blocked-by', targetFieldId: 'cost', formula: 'sum' },
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
		expect(n).toBe(15);
	});
});

describe('number rollup-to-parent config', () => {
	it('sanitizes rollupToParent + rollupFormula on a number field', () => {
		expect(sanitizeConfig('number', { numberFormat: 'number', rollupToParent: true, rollupFormula: 'average' })).toEqual({
			numberFormat: 'number',
			rollupToParent: true,
			rollupFormula: 'average'
		});
	});

	it('defaults an invalid/blank rollupFormula to "sum" when rolling up', () => {
		expect(sanitizeConfig('number', { numberFormat: 'number', rollupToParent: true, rollupFormula: 'bogus' })).toEqual({
			numberFormat: 'number',
			rollupToParent: true,
			rollupFormula: 'sum'
		});
		expect(sanitizeConfig('number', { numberFormat: 'number', rollupToParent: true })).toEqual({
			numberFormat: 'number',
			rollupToParent: true,
			rollupFormula: 'sum'
		});
	});

	it('drops rollup keys when rollupToParent is not exactly true', () => {
		expect(sanitizeConfig('number', { numberFormat: 'number', rollupToParent: false, rollupFormula: 'max' })).toEqual({
			numberFormat: 'number'
		});
		// truthy-but-not-true must not enable it
		expect(sanitizeConfig('number', { numberFormat: 'number', rollupToParent: 'yes' })).toEqual({
			numberFormat: 'number'
		});
	});
});

describe('rollsUpToParent', () => {
	it('is true only for a number field with rollupToParent and a non-"tasks" appliesTo', () => {
		expect(rollsUpToParent({ type: 'number', config: { rollupToParent: true }, appliesTo: 'all' })).toBe(true);
		expect(rollsUpToParent({ type: 'number', config: { rollupToParent: true }, appliesTo: 'subtasks' })).toBe(true);
		// unset appliesTo defaults to 'all'
		expect(rollsUpToParent({ type: 'number', config: { rollupToParent: true } })).toBe(true);
	});

	it('is false for a "tasks"-only field (no parent to roll up to)', () => {
		expect(rollsUpToParent({ type: 'number', config: { rollupToParent: true }, appliesTo: 'tasks' })).toBe(false);
	});

	it('is false when rollupToParent is off or the type is not number', () => {
		expect(rollsUpToParent({ type: 'number', config: { rollupToParent: false }, appliesTo: 'all' })).toBe(false);
		expect(rollsUpToParent({ type: 'number', config: {}, appliesTo: 'all' })).toBe(false);
		expect(rollsUpToParent({ type: 'rollup', config: { rollupToParent: true }, appliesTo: 'all' })).toBe(false);
		expect(rollsUpToParent({ type: 'text', config: { rollupToParent: true }, appliesTo: 'all' })).toBe(false);
	});
});

describe('numberRollupConfig', () => {
	it('targets the field itself over its direct sub-tasks', () => {
		expect(numberRollupConfig({ id: 'f1', config: { rollupFormula: 'average' } })).toEqual({
			relation: 'sub-task',
			targetFieldId: 'f1',
			formula: 'average'
		});
	});

	it('defaults the formula to "sum" when unset', () => {
		expect(numberRollupConfig({ id: 'f1', config: {} })).toEqual({
			relation: 'sub-task',
			targetFieldId: 'f1',
			formula: 'sum'
		});
		expect(numberRollupConfig({ id: 'f1' }).formula).toBe('sum');
	});

	it('feeds computeTaskRollup to aggregate a number field over a task’s sub-tasks', () => {
		const tasks = [
			{ id: 'p', parentId: null },
			{ id: 'a', parentId: 'p' },
			{ id: 'b', parentId: 'p' }
		];
		const vals: Record<string, number> = { a: 3, b: 7 };
		const cfg = numberRollupConfig({ id: 'hours', config: { rollupFormula: 'sum' } });
		const n = computeTaskRollup(cfg, 'p', {
			tasks,
			taskDeps: [],
			valueOf: (tid, fid) => (fid === 'hours' ? (vals[tid] ?? null) : null)
		});
		expect(n).toBe(10);
	});
});

describe('fieldAggregations with rollup-to-parent', () => {
	const field = { id: 'hours', name: 'Hours', type: 'number', config: { numberFormat: 'number' }, appliesTo: 'all' as const };
	const rollupField = { ...field, config: { numberFormat: 'number', rollupToParent: true, rollupFormula: 'sum' } };
	const allTasks = [
		{ id: 'p', parentId: null },
		{ id: 'a', parentId: 'p' },
		{ id: 'b', parentId: 'p' }
	];
	// a stale stored value lives on the PARENT plus its two sub-tasks
	const values = [
		{ taskId: 'p', fieldId: 'hours', value: '100' },
		{ taskId: 'a', fieldId: 'hours', value: '3' },
		{ taskId: 'b', fieldId: 'hours', value: '7' }
	];

	it('sums the parent AND its sub-tasks for a plain number field', () => {
		const out = fieldAggregations(['hours'], [field], [{ id: 'p' }], values, allTasks);
		expect(out[0].text).toBe('110');
	});

	it('skips a parent’s stale stored value for a rollup-to-parent field (no double-count)', () => {
		const out = fieldAggregations(['hours'], [rollupField], [{ id: 'p' }], values, allTasks);
		// only the two sub-task values (3 + 7) — matches the parent cell’s computed rollup
		expect(out[0].text).toBe('10');
	});

	it('still counts a childless top-level task’s own value for a rollup-to-parent field', () => {
		const leaf = [{ id: 'leaf', parentId: null }];
		const leafVals = [{ taskId: 'leaf', fieldId: 'hours', value: '42' }];
		const out = fieldAggregations(['hours'], [rollupField], [{ id: 'leaf' }], leafVals, leaf);
		expect(out[0].text).toBe('42');
	});
});

describe('rollupDisplayText (shared rollup display path)', () => {
	const tasks = [
		{ id: 'p', parentId: null },
		{ id: 'a', parentId: 'p' },
		{ id: 'b', parentId: 'p' }
	];
	const vals: Record<string, Record<string, number>> = { a: { hours: 3 }, b: { hours: 7 } };
	const valueOf = (tid: string, fid: string) => vals[tid]?.[fid] ?? null;
	const ctxFor = (hasSubtasks: boolean, fields: { id: string; config: Record<string, unknown> }[] = []) => ({
		tasks,
		taskDeps: [] as { taskId: string; dependsOnId: string }[],
		fields,
		valueOf,
		hasSubtasks
	});

	it('aggregates a rollup-TYPE field over its target (sum, formatted)', () => {
		const hours = { id: 'hours', config: { numberFormat: 'number' } };
		const rollup = {
			id: 'r',
			type: 'rollup',
			config: { relation: 'sub-task', targetFieldId: 'hours', formula: 'sum' } as Record<string, unknown>
		};
		expect(rollupDisplayText(rollup, 'p', ctxFor(true, [hours]))).toBe('10');
	});

	it('counts related items for a rollup-TYPE count formula (no target needed)', () => {
		const rollup = {
			id: 'r',
			type: 'rollup',
			config: { relation: 'sub-task', targetFieldId: '', formula: 'count' } as Record<string, unknown>
		};
		expect(rollupDisplayText(rollup, 'p', ctxFor(true))).toBe('2');
	});

	it('rolls a number rollup-to-parent field up over the parent’s sub-tasks', () => {
		const field = { id: 'hours', type: 'number', config: { rollupToParent: true, rollupFormula: 'sum' }, appliesTo: 'all' };
		expect(rollupDisplayText(field, 'p', ctxFor(true))).toBe('10');
	});

	it('returns null for a rollup-to-parent field with no sub-tasks (renders normally)', () => {
		const field = { id: 'hours', type: 'number', config: { rollupToParent: true, rollupFormula: 'sum' }, appliesTo: 'all' };
		expect(rollupDisplayText(field, 'a', ctxFor(false))).toBeNull();
	});

	it('returns null for a plain (non-rollup) number field', () => {
		const field = { id: 'hours', type: 'number', config: {}, appliesTo: 'all' };
		expect(rollupDisplayText(field, 'p', ctxFor(true))).toBeNull();
	});
});
