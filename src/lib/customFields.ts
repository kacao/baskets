// Custom field types + pure helpers (client-safe; server re-exports from
// $lib/server/customFields). Field defs are project-scoped (custom_field);
// values live one-per-(task,field) in task_custom_value as a scalar string or a
// JSON array for the multi-capable types. Display-only in v1 (no sort/group/filter).

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
	'url'
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
	url: 'URL'
};
export const fieldTypeLabel = (t: string) => FIELD_TYPE_LABELS[t] ?? t;

// Types whose value is always stored as a JSON array (single = 1-element array).
export const MULTI_CAPABLE: ReadonlySet<string> = new Set(['select', 'person', 'place', 'files']);

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
			return { multi: false };
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
			return { multi: c.multi === true };
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
			return Array.isArray(v) ? v : [];
		} catch {
			return [];
		}
	}
	return raw;
}

/** Build the canonical stored string for a multi-capable type's id array. */
export const encodeIds = (ids: string[]) => JSON.stringify([...new Set(ids)]);

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
