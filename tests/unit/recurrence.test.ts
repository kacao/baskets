import { describe, expect, it } from 'vitest';
import {
	RECURRENCE_UNITS,
	parseRecurrence,
	formatRecurrence,
	describeRecurrence,
	isValidRecurrence,
	nextDueDate
} from '$lib/recurrence';

// The source uses local-time Date accessors (getDate/setMonth/...), so tests
// build dates with the local-time constructor to stay timezone-independent.
const d = (y: number, m: number, day: number) => new Date(y, m - 1, day);
const ymd = (date: Date) => [date.getFullYear(), date.getMonth() + 1, date.getDate()];

describe('parseRecurrence', () => {
	it('parses unit + interval', () => {
		expect(parseRecurrence('weekly:2')).toEqual({ unit: 'weekly', interval: 2 });
	});

	it('defaults interval to 1 when omitted', () => {
		expect(parseRecurrence('daily')).toEqual({ unit: 'daily', interval: 1 });
	});

	it('trims surrounding whitespace', () => {
		expect(parseRecurrence('  monthly:3  ')).toEqual({ unit: 'monthly', interval: 3 });
	});

	it('returns null for null/undefined/empty', () => {
		expect(parseRecurrence(null)).toBeNull();
		expect(parseRecurrence(undefined)).toBeNull();
		expect(parseRecurrence('')).toBeNull();
	});

	it('returns null for an unknown unit', () => {
		expect(parseRecurrence('hourly:1')).toBeNull();
	});

	it('returns null for non-integer or non-positive intervals', () => {
		expect(parseRecurrence('daily:0')).toBeNull();
		expect(parseRecurrence('daily:-1')).toBeNull();
		expect(parseRecurrence('daily:1.5')).toBeNull();
		expect(parseRecurrence('daily:abc')).toBeNull();
	});
});

describe('formatRecurrence', () => {
	it('round-trips with parseRecurrence', () => {
		const rec = { unit: 'yearly', interval: 2 } as const;
		expect(formatRecurrence(rec)).toBe('yearly:2');
		expect(parseRecurrence(formatRecurrence(rec))).toEqual(rec);
	});
});

describe('describeRecurrence', () => {
	it('uses singular noun for interval 1', () => {
		expect(describeRecurrence('daily:1')).toBe('Every day');
		expect(describeRecurrence('weekly')).toBe('Every week');
	});

	it('uses pluralized noun for interval > 1', () => {
		expect(describeRecurrence('weekly:2')).toBe('Every 2 weeks');
		expect(describeRecurrence('monthly:3')).toBe('Every 3 months');
		expect(describeRecurrence('yearly:5')).toBe('Every 5 years');
	});

	it('returns null for invalid input', () => {
		expect(describeRecurrence(null)).toBeNull();
		expect(describeRecurrence('bogus')).toBeNull();
	});
});

describe('isValidRecurrence', () => {
	it('is true for valid rules and false otherwise', () => {
		expect(isValidRecurrence('monthly:1')).toBe(true);
		expect(RECURRENCE_UNITS.every((u) => isValidRecurrence(u))).toBe(true);
		expect(isValidRecurrence('')).toBe(false);
		expect(isValidRecurrence('daily:0')).toBe(false);
	});
});

describe('nextDueDate — per recurrence kind', () => {
	it('advances daily by interval days', () => {
		expect(ymd(nextDueDate(d(2026, 6, 15), 'daily:1')!)).toEqual([2026, 6, 16]);
		expect(ymd(nextDueDate(d(2026, 6, 15), 'daily:10')!)).toEqual([2026, 6, 25]);
	});

	it('advances weekly by 7 * interval days', () => {
		expect(ymd(nextDueDate(d(2026, 6, 15), 'weekly:1')!)).toEqual([2026, 6, 22]);
		expect(ymd(nextDueDate(d(2026, 6, 15), 'weekly:2')!)).toEqual([2026, 6, 29]);
	});

	it('advances monthly by calendar months', () => {
		expect(ymd(nextDueDate(d(2026, 6, 15), 'monthly:1')!)).toEqual([2026, 7, 15]);
		expect(ymd(nextDueDate(d(2026, 6, 15), 'monthly:3')!)).toEqual([2026, 9, 15]);
	});

	it('advances yearly by calendar years', () => {
		expect(ymd(nextDueDate(d(2026, 6, 15), 'yearly:1')!)).toEqual([2027, 6, 15]);
		expect(ymd(nextDueDate(d(2026, 6, 15), 'yearly:2')!)).toEqual([2028, 6, 15]);
	});

	it('returns a fresh Date and does not mutate the input', () => {
		const from = d(2026, 6, 15);
		const next = nextDueDate(from, 'daily:1')!;
		expect(next).not.toBe(from);
		expect(ymd(from)).toEqual([2026, 6, 15]);
	});
});

describe('nextDueDate — month-end rollover', () => {
	it('clamps Jan 31 + 1 month to Feb 28 (non-leap year)', () => {
		expect(ymd(nextDueDate(d(2026, 1, 31), 'monthly:1')!)).toEqual([2026, 2, 28]);
	});

	it('clamps Jan 31 + 1 month to Feb 29 in a leap year', () => {
		expect(ymd(nextDueDate(d(2024, 1, 31), 'monthly:1')!)).toEqual([2024, 2, 29]);
	});

	it('clamps Jan 31 + 1 month into a 30-day month (Mar 31 + 1 → Apr 30)', () => {
		expect(ymd(nextDueDate(d(2026, 3, 31), 'monthly:1')!)).toEqual([2026, 4, 30]);
	});

	it('does not clamp when the target month is long enough', () => {
		expect(ymd(nextDueDate(d(2026, 1, 30), 'monthly:2')!)).toEqual([2026, 3, 30]);
	});

	it('clamps yearly Feb 29 onto Feb 28 in the following non-leap year', () => {
		expect(ymd(nextDueDate(d(2024, 2, 29), 'yearly:1')!)).toEqual([2025, 2, 28]);
	});
});

describe('nextDueDate — year boundary', () => {
	it('rolls December into the next year (monthly)', () => {
		expect(ymd(nextDueDate(d(2026, 12, 15), 'monthly:1')!)).toEqual([2027, 1, 15]);
	});

	it('rolls Dec 31 daily into Jan 1', () => {
		expect(ymd(nextDueDate(d(2026, 12, 31), 'daily:1')!)).toEqual([2027, 1, 1]);
	});

	it('crosses the year boundary with a multi-month interval', () => {
		expect(ymd(nextDueDate(d(2026, 11, 15), 'monthly:3')!)).toEqual([2027, 2, 15]);
	});

	it('crosses multiple years with a multi-year interval', () => {
		expect(ymd(nextDueDate(d(2026, 6, 15), 'yearly:3')!)).toEqual([2029, 6, 15]);
	});
});

describe('nextDueDate — no-recurrence / invalid input', () => {
	it('returns null when the rule is absent or invalid', () => {
		expect(nextDueDate(d(2026, 6, 15), null)).toBeNull();
		expect(nextDueDate(d(2026, 6, 15), undefined)).toBeNull();
		expect(nextDueDate(d(2026, 6, 15), '')).toBeNull();
		expect(nextDueDate(d(2026, 6, 15), 'bogus:1')).toBeNull();
		expect(nextDueDate(d(2026, 6, 15), 'daily:0')).toBeNull();
	});

	it('returns null when `from` is absent', () => {
		expect(nextDueDate(null, 'daily:1')).toBeNull();
		expect(nextDueDate(undefined, 'daily:1')).toBeNull();
	});

	it('returns null when `from` is an invalid Date', () => {
		expect(nextDueDate(new Date('not-a-date'), 'daily:1')).toBeNull();
	});
});
