// Custom field types + pure helpers (client-safe; server re-exports from
// $lib/server/customFields). Field defs are project-scoped (custom_field);
// values live one-per-(task,field) in task_custom_value as a scalar string or a
// JSON array for the multi-capable types (select/person/place/files/task).
// Display-only in v1 (no sort/group/filter).

export const CUSTOM_FIELD_TYPES = [
	'text',
	'number',
	'select',
	'date',
	'person',
	'files',
	'task',
	'checkbox',
	'email',
	'phone',
	'place',
	'url',
	'rollup'
] as const;
export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];

export const FIELD_TYPE_LABELS: Record<string, string> = {
	text: 'Text',
	number: 'Number',
	select: 'Select',
	date: 'Date',
	person: 'Person',
	files: 'Files & media',
	task: 'Task',
	checkbox: 'Checkbox',
	email: 'Email',
	phone: 'Phone',
	place: 'Place',
	url: 'URL',
	rollup: 'Rollup'
};

// Rollup field: aggregate a target field across related items.
// relation = which items to roll up over (relative to the field's owner);
// 'task' = all the project's tasks (the only relation valid for project-entity fields).
export const ROLLUP_RELATIONS = [
	['blocked-by', 'Blocked by'],
	['blocking', 'Blocking'],
	['sub-task', 'Sub-task'],
	['task', 'Task']
] as const;
export const ROLLUP_FORMULAS = [
	['count', 'Count'],
	['sum', 'Sum'],
	['average', 'Average'],
	['min', 'Min'],
	['max', 'Max']
] as const;
export const rollupRelationLabel = (v: string) =>
	ROLLUP_RELATIONS.find(([k]) => k === v)?.[1] ?? v;
export const rollupFormulaLabel = (v: string) => ROLLUP_FORMULAS.find(([k]) => k === v)?.[1] ?? v;

/** Aggregate numeric values per formula. `count` ignores values (counts items). */
export function rollupAggregate(formula: string, values: number[], relatedCount: number): number {
	if (formula === 'count') return relatedCount;
	const nums = values.filter((n) => Number.isFinite(n));
	if (formula === 'sum') return nums.reduce((a, b) => a + b, 0);
	if (formula === 'average') return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
	if (formula === 'min') return nums.length ? Math.min(...nums) : 0;
	if (formula === 'max') return nums.length ? Math.max(...nums) : 0;
	return 0;
}

export type RollupConfig = { relation: string; targetFieldId: string; formula: string };

/**
 * Compute a rollup value for an owner task. `valueOf(taskId, fieldId)` returns the
 * numeric value of a target field on a related task (or null). Pure + client-safe.
 */
export function computeTaskRollup(
	config: RollupConfig,
	taskId: string,
	ctx: {
		tasks: { id: string; parentId: string | null }[];
		taskDeps: { taskId: string; dependsOnId: string }[];
		valueOf: (taskId: string, fieldId: string) => number | null;
	}
): number {
	let related: string[] = [];
	if (config.relation === 'sub-task')
		related = ctx.tasks.filter((t) => t.parentId === taskId).map((t) => t.id);
	else if (config.relation === 'blocked-by')
		related = ctx.taskDeps.filter((d) => d.taskId === taskId).map((d) => d.dependsOnId);
	else if (config.relation === 'blocking')
		related = ctx.taskDeps.filter((d) => d.dependsOnId === taskId).map((d) => d.taskId);
	else if (config.relation === 'task')
		related = ctx.tasks.map((t) => t.id).filter((id) => id !== taskId);
	const values = related
		.map((id) => ctx.valueOf(id, config.targetFieldId))
		.filter((n): n is number => n != null);
	return rollupAggregate(config.formula, values, related.length);
}
export const fieldTypeLabel = (t: string) => FIELD_TYPE_LABELS[t] ?? t;

// Types whose value is always stored as a JSON array (single = 1-element array).
export const MULTI_CAPABLE: ReadonlySet<string> = new Set([
	'select',
	'person',
	'place',
	'files',
	'task'
]);

// which tasks a field applies to (independent of type)
export const APPLIES_TO = ['all', 'tasks', 'subtasks'] as const;
export type AppliesTo = (typeof APPLIES_TO)[number];
export const APPLIES_TO_LABELS: Record<string, string> = {
	all: 'All tasks',
	tasks: 'Tasks only',
	subtasks: 'Sub-tasks only'
};
export const appliesToLabel = (a: string) => APPLIES_TO_LABELS[a] ?? a;

/** Does a field apply to a task at the given level? (top-level vs sub-task) */
export function fieldAppliesTo(field: { appliesTo?: string | null }, isSubtask: boolean): boolean {
	const a = field.appliesTo ?? 'all';
	if (a === 'all') return true;
	return isSubtask ? a === 'subtasks' : a === 'tasks';
}

export const NUMBER_FORMATS = ['number', 'accounting', 'financial', 'currency', 'custom'] as const;
export const DATE_FORMATS = ['full', 'short', 'mdy', 'dmy', 'ymd', 'relative'] as const;
export const TIME_FORMATS = ['hidden', '12h', '24h'] as const;
export const SELECT_DISPLAYS = ['text', 'icon', 'text-icon'] as const;

export type FieldConfig = Record<string, unknown>;

/** A custom field as loaded (config already parsed). */
export type CustomFieldDef = {
	id: string;
	projectId?: string;
	name: string;
	type: string;
	config: FieldConfig;
	appliesTo?: string;
	position?: number;
};

/** Default config for a freshly-created field of `type`. */
export function defaultConfig(type: string): FieldConfig {
	switch (type) {
		case 'number':
			return { numberFormat: 'number', currencyCode: 'USD', formatString: '' };
		case 'select':
			return { multi: false, displayOption: 'text' };
		case 'date':
			return { dateFormat: 'full', timeFormat: 'hidden' };
		case 'person':
		case 'place':
		case 'files':
		case 'task':
			return { multi: false };
		case 'rollup':
			return { relation: 'sub-task', targetFieldId: '', formula: 'count' };
		default:
			return {};
	}
}

/** Coerce a raw config object to the valid keys for its type (drops unknowns). */
export function sanitizeConfig(type: string, raw: unknown): FieldConfig {
	const c = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
	const pick = <T extends readonly string[]>(v: unknown, allowed: T, fallback: T[number]) =>
		typeof v === 'string' && (allowed as readonly string[]).includes(v) ? v : fallback;
	switch (type) {
		case 'number': {
			const numberFormat = pick(c.numberFormat, NUMBER_FORMATS, 'number');
			const out: FieldConfig = { numberFormat };
			if (numberFormat === 'currency' || numberFormat === 'accounting' || numberFormat === 'financial')
				out.currencyCode = typeof c.currencyCode === 'string' && c.currencyCode.trim() ? c.currencyCode.trim().toUpperCase().slice(0, 3) : 'USD';
			if (numberFormat === 'custom') out.formatString = typeof c.formatString === 'string' ? c.formatString.slice(0, 80) : '';
			return out;
		}
		case 'select':
			return { multi: c.multi === true, displayOption: pick(c.displayOption, SELECT_DISPLAYS, 'text') };
		case 'date':
			return { dateFormat: pick(c.dateFormat, DATE_FORMATS, 'full'), timeFormat: pick(c.timeFormat, TIME_FORMATS, 'hidden') };
		case 'person':
		case 'place':
		case 'files':
		case 'task':
			return { multi: c.multi === true };
		case 'rollup': {
			const relations = ROLLUP_RELATIONS.map(([k]) => k);
			const formulas = ROLLUP_FORMULAS.map(([k]) => k);
			return {
				relation: pick(c.relation, relations as unknown as readonly string[], 'sub-task'),
				targetFieldId: typeof c.targetFieldId === 'string' ? c.targetFieldId : '',
				formula: pick(c.formula, formulas as unknown as readonly string[], 'count')
			};
		}
		default:
			return {};
	}
}

export const isMulti = (field: { type: string; config: FieldConfig }) =>
	MULTI_CAPABLE.has(field.type) && field.config?.multi === true;

/** Parse a stored value string into a JS shape for rendering. */
export function decodeValue(field: { type: string }, raw: string | null | undefined): unknown {
	if (raw == null || raw === '') return MULTI_CAPABLE.has(field.type) ? [] : null;
	if (field.type === 'checkbox') return raw === 'true';
	if (MULTI_CAPABLE.has(field.type)) {
		try {
			const v = JSON.parse(raw);
			if (Array.isArray(v)) return v;
		} catch {
			// fall through
		}
		// `task` is the only multi type with a scalar era — recover its legacy
		// bare-id values as a single-element array; others are always arrays.
		return field.type === 'task' ? [raw] : [];
	}
	return raw;
}

/** Build the canonical stored string for a multi-capable type's id array. */
export const encodeIds = (ids: string[]) => JSON.stringify([...new Set(ids)]);

/** Per-task searchable text from custom-field values, resolved to display labels
 * (reference ids → titles, since raw ids are useless to match). Folded into both
 * the FilterBar free-text search and the `task`-cf link picker so they search cf
 * content. checkbox/rollup excluded (boolean / computed). */
export function buildTaskCfSearch(
	fields: { id: string; type: string }[],
	values: { taskId: string; fieldId: string; value: string }[],
	resolve: {
		option: (id: string) => string;
		user: (id: string) => string;
		location: (id: string) => string;
		task: (id: string) => string;
		file: (id: string) => string;
	}
): Map<string, string> {
	const typeById = new Map(fields.map((f) => [f.id, f.type]));
	const parts = new Map<string, string[]>();
	for (const v of values) {
		const type = typeById.get(v.fieldId);
		if (!type || type === 'rollup' || type === 'checkbox') continue;
		const d = decodeValue({ type }, v.value);
		let text: string;
		if (Array.isArray(d)) {
			const r =
				type === 'select' ? d.map(resolve.option)
				: type === 'person' ? d.map(resolve.user)
				: type === 'place' ? d.map(resolve.location)
				: type === 'task' ? d.map(resolve.task)
				: type === 'files' ? d.map(resolve.file)
				: d.map(String);
			text = r.join(' ');
		} else {
			text = String(d ?? '');
		}
		if (text.trim()) {
			const arr = parts.get(v.taskId) ?? [];
			arr.push(text);
			parts.set(v.taskId, arr);
		}
	}
	const out = new Map<string, string>();
	for (const [id, p] of parts) out.set(id, p.join(' '));
	return out;
}

/* ---------------------------- pure formatters ---------------------------- */

export function formatNumber(n: number, config: FieldConfig): string {
	if (!Number.isFinite(n)) return '';
	const fmt = (config.numberFormat as string) ?? 'number';
	const currency = ((config.currencyCode as string) || 'USD').toUpperCase();
	try {
		if (fmt === 'currency') return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(n);
		if (fmt === 'accounting' || fmt === 'financial')
			return new Intl.NumberFormat(undefined, { style: 'currency', currency, currencySign: 'accounting' }).format(n);
		if (fmt === 'custom') return String(n); // format string stored, not interpreted (v1)
		return new Intl.NumberFormat().format(n);
	} catch {
		return String(n);
	}
}

/** Per-group sums of the given number fields across a set of tasks.
 *  Returns one entry per still-existing number field, formatted for display. */
export function fieldAggregations(
	fieldIds: string[],
	fields: { id: string; name: string; type: string; config: FieldConfig }[],
	tasks: { id: string }[],
	values: { taskId: string; fieldId: string; value: string }[],
	allTasks: { id: string; parentId: string | null }[] = []
): { id: string; name: string; text: string }[] {
	if (!fieldIds.length) return [];
	// Sum spans each group task AND its sub-tasks (sub-tasks carry their own values).
	const taskIds = new Set(tasks.map((t) => t.id));
	for (const t of allTasks) if (t.parentId && taskIds.has(t.parentId)) taskIds.add(t.id);
	const out: { id: string; name: string; text: string }[] = [];
	for (const id of fieldIds) {
		const field = fields.find((f) => f.id === id && f.type === 'number');
		if (!field) continue;
		let sum = 0;
		for (const v of values) {
			if (v.fieldId !== id || !taskIds.has(v.taskId)) continue;
			const n = Number(v.value);
			if (Number.isFinite(n)) sum += n;
		}
		out.push({ id, name: field.name, text: formatNumber(sum, field.config) });
	}
	return out;
}

function pad(n: number) {
	return String(n).padStart(2, '0');
}

function relativeDate(d: Date): string {
	const day = 86400000;
	const startOf = (x: Date) => {
		const c = new Date(x);
		c.setHours(0, 0, 0, 0);
		return c.getTime();
	};
	const diff = Math.round((startOf(d) - startOf(new Date())) / day);
	const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
	if (Math.abs(diff) < 30) return rtf.format(diff, 'day');
	if (Math.abs(diff) < 365) return rtf.format(Math.round(diff / 30), 'month');
	return rtf.format(Math.round(diff / 365), 'year');
}

export function formatDate(iso: string, config: FieldConfig): string {
	const d = new Date(iso);
	if (isNaN(+d)) return iso;
	const dateFormat = (config.dateFormat as string) ?? 'full';
	const timeFormat = (config.timeFormat as string) ?? 'hidden';
	if (dateFormat === 'relative') return relativeDate(d);

	let datePart: string;
	switch (dateFormat) {
		case 'short':
			datePart = d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
			break;
		case 'mdy':
			datePart = `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${d.getFullYear()}`;
			break;
		case 'dmy':
			datePart = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
			break;
		case 'ymd':
			datePart = `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
			break;
		case 'full':
		default:
			datePart = d.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
	}
	if (timeFormat !== 'hidden' && iso.includes('T')) {
		const timePart = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: timeFormat === '12h' });
		return `${datePart} ${timePart}`;
	}
	return datePart;
}

/* ---------------------- pure scalar value validators --------------------- */

export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
export const PHONE_RE = /^[+0-9 ()\-.]{3,}$/;

export function isValidUrl(s: string): boolean {
	try {
		const u = new URL(s);
		return u.protocol === 'http:' || u.protocol === 'https:';
	} catch {
		return false;
	}
}
