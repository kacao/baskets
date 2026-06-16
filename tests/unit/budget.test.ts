import { describe, expect, it } from 'vitest';
import {
	computeBudget,
	formatVariancePct,
	type BudgetField,
	type BudgetMilestone,
	type BudgetTask,
	type BudgetValue
} from '$lib/budget';

const EST = 'est';
const ACT = 'act';

function field(id: string, name: string): BudgetField {
	return { id, name, type: 'number', config: {} };
}

const fields: BudgetField[] = [field(EST, 'Estimated'), field(ACT, 'Actual')];

const milestones: BudgetMilestone[] = [
	{ id: 'm1', name: 'Phase 1' },
	{ id: 'm2', name: 'Phase 2' }
];

function val(taskId: string, fieldId: string, value: string): BudgetValue {
	return { taskId, fieldId, value };
}

describe('computeBudget — per-milestone rollup', () => {
	it('should sum estimated and actual per milestone in milestone order', () => {
		const tasks: BudgetTask[] = [
			{ id: 't1', parentId: null, milestoneId: 'm1' },
			{ id: 't2', parentId: null, milestoneId: 'm2' }
		];
		const values = [
			val('t1', EST, '100'),
			val('t1', ACT, '120'),
			val('t2', EST, '50'),
			val('t2', ACT, '40')
		];
		const { rows } = computeBudget(tasks, values, fields, EST, ACT, milestones);

		expect(rows.map((r) => r.id)).toEqual(['m1', 'm2']);
		expect(rows[0]).toMatchObject({ name: 'Phase 1', estimated: 100, actual: 120 });
		expect(rows[1]).toMatchObject({ name: 'Phase 2', estimated: 50, actual: 40 });
	});

	it('should roll sub-task values into their parent task milestone', () => {
		const tasks: BudgetTask[] = [
			{ id: 'p1', parentId: null, milestoneId: 'm1' },
			{ id: 's1', parentId: 'p1', milestoneId: null },
			{ id: 's2', parentId: 'p1', milestoneId: 'm2' } // milestone ignored; follows parent
		];
		const values = [
			val('p1', EST, '10'),
			val('s1', EST, '5'),
			val('s2', EST, '7')
		];
		const { rows } = computeBudget(tasks, values, fields, EST, ACT, milestones);

		expect(rows[0]).toMatchObject({ id: 'm1', estimated: 22 });
		expect(rows[1]).toMatchObject({ id: 'm2', estimated: 0 });
	});

	it('should emit a trailing "No milestone" bucket for unassigned tasks', () => {
		const tasks: BudgetTask[] = [
			{ id: 't1', parentId: null, milestoneId: 'm1' },
			{ id: 't2', parentId: null, milestoneId: null }
		];
		const values = [val('t1', EST, '100'), val('t2', EST, '30')];
		const { rows } = computeBudget(tasks, values, fields, EST, ACT, milestones);

		const noMs = rows[rows.length - 1];
		expect(noMs).toMatchObject({ id: null, name: 'No milestone', estimated: 30 });
	});

	it('should omit the "No milestone" bucket when its totals are all zero', () => {
		const tasks: BudgetTask[] = [
			{ id: 't1', parentId: null, milestoneId: 'm1' },
			{ id: 't2', parentId: null, milestoneId: null } // no values
		];
		const values = [val('t1', EST, '100')];
		const { rows } = computeBudget(tasks, values, fields, EST, ACT, milestones);

		expect(rows.some((r) => r.id === null)).toBe(false);
	});
});

describe('computeBudget — project total', () => {
	it('should sum every task (top-level + sub-tasks) into the total row', () => {
		const tasks: BudgetTask[] = [
			{ id: 'p1', parentId: null, milestoneId: 'm1' },
			{ id: 's1', parentId: 'p1', milestoneId: null },
			{ id: 't2', parentId: null, milestoneId: null }
		];
		const values = [
			val('p1', EST, '10'),
			val('s1', EST, '5'),
			val('t2', EST, '20'),
			val('p1', ACT, '12')
		];
		const { total } = computeBudget(tasks, values, fields, EST, ACT, milestones);

		expect(total).toMatchObject({ id: 'project', name: 'Total', estimated: 35, actual: 12 });
	});
});

describe('computeBudget — variance and pct', () => {
	it('should compute variance as actual minus estimated (positive = over)', () => {
		const tasks: BudgetTask[] = [{ id: 't1', parentId: null, milestoneId: 'm1' }];
		const values = [val('t1', EST, '100'), val('t1', ACT, '130')];
		const { rows } = computeBudget(tasks, values, fields, EST, ACT, milestones);

		expect(rows[0].variance).toBe(30);
		expect(rows[0].pct).toBeCloseTo(0.3);
	});

	it('should produce a negative variance when under budget', () => {
		const tasks: BudgetTask[] = [{ id: 't1', parentId: null, milestoneId: 'm1' }];
		const values = [val('t1', EST, '100'), val('t1', ACT, '80')];
		const { rows } = computeBudget(tasks, values, fields, EST, ACT, milestones);

		expect(rows[0].variance).toBe(-20);
		expect(rows[0].pct).toBeCloseTo(-0.2);
	});

	it('should report a null pct when estimated is zero', () => {
		const tasks: BudgetTask[] = [{ id: 't1', parentId: null, milestoneId: 'm1' }];
		const values = [val('t1', ACT, '40')]; // no estimate
		const { rows } = computeBudget(tasks, values, fields, EST, ACT, milestones);

		expect(rows[0].estimated).toBe(0);
		expect(rows[0].variance).toBe(40);
		expect(rows[0].pct).toBeNull();
	});
});

describe('computeBudget — missing designated fields', () => {
	it('should be unconfigured when neither cost field is set', () => {
		const tasks: BudgetTask[] = [{ id: 't1', parentId: null, milestoneId: 'm1' }];
		const values = [val('t1', EST, '100')];
		const { configured, rows, total } = computeBudget(
			tasks,
			values,
			fields,
			null,
			undefined,
			milestones
		);

		expect(configured).toBe(false);
		expect(rows.every((r) => r.estimated === 0 && r.actual === 0)).toBe(true);
		expect(total).toMatchObject({ estimated: 0, actual: 0 });
	});

	it('should stay configured with only one field set and zero the other side', () => {
		const tasks: BudgetTask[] = [{ id: 't1', parentId: null, milestoneId: 'm1' }];
		const values = [val('t1', EST, '100'), val('t1', ACT, '120')];
		const { configured, rows } = computeBudget(tasks, values, fields, EST, null, milestones);

		expect(configured).toBe(true);
		expect(rows[0]).toMatchObject({ estimated: 100, actual: 0, variance: -100 });
	});

	it('should ignore a designated field id that does not resolve to a number field', () => {
		const textField: BudgetField = { id: 'txt', name: 'Notes', type: 'text', config: {} };
		const tasks: BudgetTask[] = [{ id: 't1', parentId: null, milestoneId: 'm1' }];
		const values = [val('t1', 'txt', '100'), val('t1', 'missing', '5')];
		const { configured, total } = computeBudget(
			tasks,
			values,
			[textField],
			'txt', // not a number field
			'missing', // not in fields at all
			milestones
		);

		expect(configured).toBe(false);
		expect(total).toMatchObject({ estimated: 0, actual: 0 });
	});
});

describe('computeBudget — non-numeric and absent values', () => {
	it('should skip non-numeric values via Number() coercion', () => {
		const tasks: BudgetTask[] = [
			{ id: 't1', parentId: null, milestoneId: 'm1' },
			{ id: 't2', parentId: null, milestoneId: 'm1' }
		];
		const values = [
			val('t1', EST, '100'),
			val('t2', EST, 'not-a-number'), // NaN → skipped
			val('t1', EST, '') // '' → Number('') is 0, finite → counted as 0
		];
		const { rows } = computeBudget(tasks, values, fields, EST, ACT, milestones);

		expect(rows[0].estimated).toBe(100);
	});

	it('should treat absent value rows as no contribution', () => {
		const tasks: BudgetTask[] = [
			{ id: 't1', parentId: null, milestoneId: 'm1' },
			{ id: 't2', parentId: null, milestoneId: 'm1' }
		];
		const values = [val('t1', EST, '100')]; // t2 has no row at all
		const { rows } = computeBudget(tasks, values, fields, EST, ACT, milestones);

		expect(rows[0].estimated).toBe(100);
		expect(rows[0].actual).toBe(0);
	});

	it('should produce a zeroed budget when there are no tasks', () => {
		const { rows, total, configured } = computeBudget([], [], fields, EST, ACT, milestones);

		expect(configured).toBe(true);
		expect(rows.map((r) => r.id)).toEqual(['m1', 'm2']);
		expect(rows.every((r) => r.estimated === 0 && r.actual === 0)).toBe(true);
		expect(total).toMatchObject({ estimated: 0, actual: 0, variance: 0, pct: null });
	});
});

describe('formatVariancePct', () => {
	it('should render an em-dash for a null pct', () => {
		expect(formatVariancePct(null)).toBe('—');
	});

	it('should prefix a positive pct with "+"', () => {
		expect(formatVariancePct(0.123)).toBe('+12%');
	});

	it('should prefix a negative pct with a minus sign and use its magnitude', () => {
		expect(formatVariancePct(-0.05)).toBe('−5%');
	});

	it('should render zero without a sign', () => {
		expect(formatVariancePct(0)).toBe('0%');
	});
});
