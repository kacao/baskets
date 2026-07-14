import { describe, expect, it, vi } from 'vitest';

// `slugifyOrgName` is a pure helper, but it lives in `$lib/server/orgs`, which
// eagerly opens the DB connection on import (src/lib/server/db/index.ts:
// `export const db = createDb()`). Mock the db module so importing orgs here NEVER
// touches a real database — the unit env would otherwise resolve DATABASE_URL to
// the dev DB (project memory: never point tests at ./data/baskets.db).
vi.mock('$lib/server/db', () => ({
	db: {},
	withTransaction: vi.fn()
}));

import { slugifyOrgName } from '$lib/server/orgs';

describe('slugifyOrgName (ADR-062 D1)', () => {
	it.each([
		['Acme Inc', 'acme-inc'],
		['  Padded  Name  ', 'padded-name'],
		['UPPER', 'upper'],
		['My Org 2', 'my-org-2'],
		['a__b--c', 'a-b-c'],
		['Foo & Bar', 'foo-bar'],
		['trailing---', 'trailing'],
		['---leading', 'leading']
	])('%j → %j', (input, expected) => {
		expect(slugifyOrgName(input)).toBe(expected);
	});

	it('collapses weird unicode / all-symbol / empty names to the "org" fallback', () => {
		expect(slugifyOrgName('')).toBe('org');
		expect(slugifyOrgName('   ')).toBe('org');
		expect(slugifyOrgName('---')).toBe('org');
		expect(slugifyOrgName('🚀🔥')).toBe('org'); // emoji → all stripped
		expect(slugifyOrgName('Ω≈ç√')).toBe('org'); // non-latin symbols → stripped
	});

	it('keeps latin alphanumerics but drops accents/diacritics (ASCII-only slug)', () => {
		// é is not [a-z0-9] → replaced by a separator, then trimmed
		expect(slugifyOrgName('Café')).toBe('caf');
		expect(slugifyOrgName('naïve org')).toBe('na-ve-org');
	});
});
