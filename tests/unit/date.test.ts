import { describe, expect, it } from 'vitest';
import { fmtDate, fmtDateShort } from '$lib/date';

describe('fmtDate', () => {
	it('returns null for null input', () => {
		expect(fmtDate(null)).toBeNull();
	});

	it('formats a Date to YYYY-MM-DD', () => {
		expect(fmtDate(new Date('2026-03-05T12:34:56Z'))).toBe('2026-03-05');
	});

	it('formats an ISO string to YYYY-MM-DD', () => {
		expect(fmtDate('2026-01-09T00:00:00.000Z')).toBe('2026-01-09');
	});
});

describe('fmtDateShort', () => {
	it('returns null for null input', () => {
		expect(fmtDateShort(null)).toBeNull();
	});

	it('formats a Date to MM-DD', () => {
		expect(fmtDateShort(new Date('2026-03-05T12:34:56Z'))).toBe('03-05');
	});

	it('formats an ISO string to MM-DD', () => {
		expect(fmtDateShort('2026-01-09T00:00:00.000Z')).toBe('01-09');
	});
});
