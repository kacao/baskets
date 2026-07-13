// Pure recurrence helpers for task repeat rules (BASDEV-8). A rule is a compact
// string stored in task.recurrence: "<unit>:<interval>" where unit is one of
// daily | weekly | monthly | yearly and interval is a positive integer.
// Examples: "daily:1", "weekly:2" (every two weeks), "monthly:1". null = one-off.
// These functions are framework-free and side-effect free so they can be unit
// tested and reused on client and server alike.

export const RECURRENCE_UNITS = ['daily', 'weekly', 'monthly', 'yearly'] as const;
export type RecurrenceUnit = (typeof RECURRENCE_UNITS)[number];

export type Recurrence = { unit: RecurrenceUnit; interval: number };

/** Parse a rule string into a structured recurrence, or null if absent/invalid. */
export function parseRecurrence(rule: string | null | undefined): Recurrence | null {
	if (!rule) return null;
	const [unitRaw, intervalRaw] = String(rule).trim().split(':');
	const unit = unitRaw as RecurrenceUnit;
	if (!RECURRENCE_UNITS.includes(unit)) return null;
	const interval = intervalRaw === undefined ? 1 : Number(intervalRaw);
	if (!Number.isInteger(interval) || interval < 1) return null;
	return { unit, interval };
}

/** Serialize a structured recurrence back into its rule string. */
export function formatRecurrence(rec: Recurrence): string {
	return `${rec.unit}:${rec.interval}`;
}

/** A human label for display, e.g. "Every 2 weeks". */
export function describeRecurrence(rule: string | null | undefined): string | null {
	const rec = parseRecurrence(rule);
	if (!rec) return null;
	const noun = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' }[rec.unit];
	return rec.interval === 1 ? `Every ${noun}` : `Every ${rec.interval} ${noun}s`;
}

/** True when `rule` parses to a valid recurrence. */
export function isValidRecurrence(rule: string | null | undefined): boolean {
	return parseRecurrence(rule) !== null;
}

/**
 * Compute the next due date by advancing `from` by one recurrence step. Returns
 * a fresh Date. For monthly/yearly steps that overflow a short month (e.g. Jan 31
 * + 1 month) the date clamps to the last day of the target month. Returns null
 * when the rule is invalid or `from` is null.
 */
export function nextDueDate(
	from: Date | null | undefined,
	rule: string | null | undefined
): Date | null {
	const rec = parseRecurrence(rule);
	if (!rec || !from) return null;
	const base = new Date(from.getTime());
	if (Number.isNaN(base.getTime())) return null;

	switch (rec.unit) {
		case 'daily':
			base.setDate(base.getDate() + rec.interval);
			return base;
		case 'weekly':
			base.setDate(base.getDate() + 7 * rec.interval);
			return base;
		case 'monthly':
			return addMonths(base, rec.interval);
		case 'yearly':
			return addMonths(base, 12 * rec.interval);
	}
}

/** Add `months` calendar months, clamping the day to the target month length. */
function addMonths(date: Date, months: number): Date {
	const day = date.getDate();
	const d = new Date(date.getTime());
	d.setDate(1);
	d.setMonth(d.getMonth() + months);
	const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
	d.setDate(Math.min(day, lastDay));
	return d;
}
