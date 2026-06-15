// BASDEV-10 — ACTUAL vs ESTIMATED cost + budget rollup (pure, client-safe).
// Sums two project-chosen number custom fields per milestone (and overall),
// reusing the same summing semantics as fieldAggregations() in $lib/customFields:
// a milestone's total spans its top-level tasks AND their sub-tasks (sub-tasks
// carry their own values), values coerced via Number(), non-finite skipped.

import { formatNumber, type FieldConfig } from '$lib/customFields';

export type BudgetTask = {
	id: string;
	parentId: string | null;
	milestoneId: string | null;
};

export type BudgetValue = {
	taskId: string;
	fieldId: string;
	value: string;
};

export type BudgetField = {
	id: string;
	name: string;
	type: string;
	config: FieldConfig;
};

export type BudgetMilestone = {
	id: string;
	name: string;
};

export type BudgetRow = {
	/** milestone id, null for the "No milestone" bucket, or 'project' for the total row */
	id: string | null;
	name: string;
	estimated: number;
	actual: number;
	/** actual − estimated (negative ⇒ under budget) */
	variance: number;
	/** variance as a fraction of estimated (null when estimated is 0) */
	pct: number | null;
	estimatedText: string;
	actualText: string;
	varianceText: string;
};

export type BudgetResult = {
	/** per-milestone rows (in milestone order, plus a trailing "No milestone" bucket if used) */
	rows: BudgetRow[];
	/** project-wide totals across every task */
	total: BudgetRow;
	/** whether either cost field is configured */
	configured: boolean;
};

/** Sum one number field across a set of task ids (mirrors fieldAggregations). */
function sumField(fieldId: string | null, taskIds: Set<string>, values: BudgetValue[]): number {
	if (!fieldId) return 0;
	let sum = 0;
	for (const v of values) {
		if (v.fieldId !== fieldId || !taskIds.has(v.taskId)) continue;
		const n = Number(v.value);
		if (Number.isFinite(n)) sum += n;
	}
	return sum;
}

/** Expand a set of top-level task ids to include their sub-tasks (matching fieldAggregations). */
function withSubtasks(seed: Set<string>, allTasks: BudgetTask[]): Set<string> {
	const ids = new Set(seed);
	for (const t of allTasks) if (t.parentId && seed.has(t.parentId)) ids.add(t.id);
	return ids;
}

function resolveField(
	fieldId: string | null | undefined,
	fields: BudgetField[]
): BudgetField | null {
	if (!fieldId) return null;
	return fields.find((f) => f.id === fieldId && f.type === 'number') ?? null;
}

function makeRow(
	id: string | null,
	name: string,
	estimated: number,
	actual: number,
	estField: BudgetField | null,
	actField: BudgetField | null
): BudgetRow {
	const variance = actual - estimated;
	const pct = estimated !== 0 ? variance / estimated : null;
	const cfg: FieldConfig = (estField ?? actField)?.config ?? {};
	return {
		id,
		name,
		estimated,
		actual,
		variance,
		pct,
		estimatedText: formatNumber(estimated, estField?.config ?? cfg),
		actualText: formatNumber(actual, actField?.config ?? cfg),
		varianceText: formatNumber(variance, cfg)
	};
}

/**
 * Compute per-milestone and project-wide estimated vs actual cost.
 *
 * estFieldId / actFieldId pick which number custom fields to sum
 * (project.estimatedCostFieldId / project.actualCostFieldId). `fields` are the
 * project's custom field defs, used to resolve the chosen fields and format sums
 * with each field's number config.
 */
export function computeBudget(
	tasks: BudgetTask[],
	taskCustomValues: BudgetValue[],
	fields: BudgetField[],
	estFieldId: string | null | undefined,
	actFieldId: string | null | undefined,
	milestones: BudgetMilestone[]
): BudgetResult {
	const estField = resolveField(estFieldId, fields);
	const actField = resolveField(actFieldId, fields);
	const configured = !!(estField || actField);

	const rows: BudgetRow[] = [];

	for (const m of milestones) {
		const seed = new Set(
			tasks.filter((t) => !t.parentId && t.milestoneId === m.id).map((t) => t.id)
		);
		const ids = withSubtasks(seed, tasks);
		rows.push(
			makeRow(
				m.id,
				m.name,
				sumField(estField?.id ?? null, ids, taskCustomValues),
				sumField(actField?.id ?? null, ids, taskCustomValues),
				estField,
				actField
			)
		);
	}

	// "No milestone" bucket — top-level tasks with no milestone, plus their sub-tasks.
	const noSeed = new Set(tasks.filter((t) => !t.parentId && !t.milestoneId).map((t) => t.id));
	const noIds = withSubtasks(noSeed, tasks);
	const noEst = sumField(estField?.id ?? null, noIds, taskCustomValues);
	const noAct = sumField(actField?.id ?? null, noIds, taskCustomValues);
	if (noIds.size > 0 && (noEst !== 0 || noAct !== 0))
		rows.push(makeRow(null, 'No milestone', noEst, noAct, estField, actField));

	// Project total — every task (top-level + sub-tasks).
	const allIds = new Set(tasks.map((t) => t.id));
	const total = makeRow(
		'project',
		'Total',
		sumField(estField?.id ?? null, allIds, taskCustomValues),
		sumField(actField?.id ?? null, allIds, taskCustomValues),
		estField,
		actField
	);

	return { rows, total, configured };
}

/** Format a variance percentage (e.g. "+12%", "−5%"); "—" when undefined. */
export function formatVariancePct(pct: number | null): string {
	if (pct == null) return '—';
	const sign = pct > 0 ? '+' : pct < 0 ? '−' : '';
	return `${sign}${Math.abs(Math.round(pct * 100))}%`;
}
