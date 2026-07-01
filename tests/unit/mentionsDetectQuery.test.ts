import { describe, expect, it } from 'vitest';
import { detectQuery } from '$lib/mentions';

describe('detectQuery happy path', () => {
	it('detects a plain @foo with the caret at the end', () => {
		const value = '@foo';
		expect(detectQuery(value, value.length)).toEqual({ query: 'foo', start: 0 });
	});

	it('detects an @ at the very start of the string with caret 1', () => {
		expect(detectQuery('@', 1)).toEqual({ query: '', start: 0 });
	});

	it('detects a query right after a space with the caret at the end', () => {
		const value = 'hi @ab';
		expect(detectQuery(value, value.length)).toEqual({ query: 'ab', start: 3 });
	});

	it('points start at the @ index not at the query', () => {
		const value = 'hello @world';
		const result = detectQuery(value, value.length);
		expect(result?.start).toBe(6);
		expect(value[result!.start]).toBe('@');
	});

	it('fires immediately after @ with an empty query when caret sits just past it', () => {
		const value = 'say @';
		expect(detectQuery(value, value.length)).toEqual({ query: '', start: 4 });
	});
});

describe('detectQuery leading-character rule', () => {
	it('returns null for an email-ish a@foo with no whitespace before the @', () => {
		const value = 'a@foo';
		expect(detectQuery(value, value.length)).toBeNull();
	});

	it('fires when the @ is preceded by an opening parenthesis', () => {
		const value = '(@foo';
		expect(detectQuery(value, value.length)).toEqual({ query: 'foo', start: 1 });
	});
});

describe('detectQuery query-content rules', () => {
	it('returns null when whitespace appears inside the query before the caret', () => {
		const value = '@foo bar';
		expect(detectQuery(value, value.length)).toBeNull();
	});

	it('returns null when a closing bracket appears in the query', () => {
		const value = '@foo]';
		expect(detectQuery(value, value.length)).toBeNull();
	});

	it('returns null when the query is longer than 40 characters', () => {
		const query = 'x'.repeat(41);
		const value = '@' + query;
		expect(detectQuery(value, value.length)).toBeNull();
	});

	it('accepts a query that is exactly 40 characters long', () => {
		const query = 'x'.repeat(40);
		const value = '@' + query;
		expect(detectQuery(value, value.length)).toEqual({ query, start: 0 });
	});
});

describe('detectQuery backward-scan limits', () => {
	it('returns null when a non-whitespace run of 60+ chars precedes the caret with no @', () => {
		const value = 'x'.repeat(70);
		expect(detectQuery(value, value.length)).toBeNull();
	});

	it('returns null when the caret is at position 0', () => {
		expect(detectQuery('@foo', 0)).toBeNull();
	});
});

describe('detectQuery consecutive @@ handling', () => {
	it('returns null for @@ because the second @ is preceded by another @', () => {
		const value = '@@';
		expect(detectQuery(value, value.length)).toBeNull();
	});

	it('returns null for text @@ with a leading space since the inner @ is not a boundary', () => {
		const value = 'hi @@';
		expect(detectQuery(value, value.length)).toBeNull();
	});
});
