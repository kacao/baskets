import { describe, expect, it } from 'vitest';
import { buildTaskCfSearch, encodeIds, isValidUrl, decodeValue } from '$lib/customFields';

const resolvers = {
	option: (id: string) => `opt:${id}`,
	user: (id: string) => `user:${id}`,
	location: (id: string) => `loc:${id}`,
	task: (id: string) => `task:${id}`,
	file: (id: string) => `file:${id}`
};

describe('buildTaskCfSearch', () => {
	it('returns an empty map when there are no fields or values', () => {
		expect(buildTaskCfSearch([], [], resolvers).size).toBe(0);
		expect(
			buildTaskCfSearch([{ id: 'f1', type: 'text' }], [], resolvers).size
		).toBe(0);
	});

	it('excludes rollup-type field values', () => {
		const out = buildTaskCfSearch(
			[{ id: 'r', type: 'rollup' }],
			[{ taskId: 't1', fieldId: 'r', value: '42' }],
			resolvers
		);
		expect(out.has('t1')).toBe(false);
	});

	it('excludes checkbox-type field values', () => {
		const out = buildTaskCfSearch(
			[{ id: 'c', type: 'checkbox' }],
			[{ taskId: 't1', fieldId: 'c', value: 'true' }],
			resolvers
		);
		expect(out.has('t1')).toBe(false);
	});

	it('resolves a select value via the option resolver', () => {
		const out = buildTaskCfSearch(
			[{ id: 'f', type: 'select' }],
			[{ taskId: 't1', fieldId: 'f', value: '["a","b"]' }],
			resolvers
		);
		expect(out.get('t1')).toBe('opt:a opt:b');
	});

	it('resolves a person value via the user resolver', () => {
		const out = buildTaskCfSearch(
			[{ id: 'f', type: 'person' }],
			[{ taskId: 't1', fieldId: 'f', value: '["u1","u2"]' }],
			resolvers
		);
		expect(out.get('t1')).toBe('user:u1 user:u2');
	});

	it('resolves a place value via the location resolver', () => {
		const out = buildTaskCfSearch(
			[{ id: 'f', type: 'place' }],
			[{ taskId: 't1', fieldId: 'f', value: '["p1"]' }],
			resolvers
		);
		expect(out.get('t1')).toBe('loc:p1');
	});

	it('resolves a task value via the task resolver', () => {
		const out = buildTaskCfSearch(
			[{ id: 'f', type: 'task' }],
			[{ taskId: 't1', fieldId: 'f', value: '["k1","k2"]' }],
			resolvers
		);
		expect(out.get('t1')).toBe('task:k1 task:k2');
	});

	it('resolves a files value via the file resolver', () => {
		const out = buildTaskCfSearch(
			[{ id: 'f', type: 'files' }],
			[{ taskId: 't1', fieldId: 'f', value: '["x1"]' }],
			resolvers
		);
		expect(out.get('t1')).toBe('file:x1');
	});

	it('uses String(decodeValue) for a scalar text value', () => {
		const out = buildTaskCfSearch(
			[{ id: 'f', type: 'text' }],
			[{ taskId: 't1', fieldId: 'f', value: 'hello world' }],
			resolvers
		);
		expect(out.get('t1')).toBe('hello world');
	});

	it('skips a value whose field id is unknown', () => {
		const out = buildTaskCfSearch(
			[{ id: 'known', type: 'text' }],
			[{ taskId: 't1', fieldId: 'ghost', value: 'orphan' }],
			resolvers
		);
		expect(out.size).toBe(0);
	});

	it('does not add an entry when the resolved text is blank', () => {
		const out = buildTaskCfSearch(
			[{ id: 'f', type: 'text' }],
			[{ taskId: 't1', fieldId: 'f', value: '   ' }],
			resolvers
		);
		expect(out.has('t1')).toBe(false);
	});

	it('concatenates multiple field values for the same task with a space', () => {
		const out = buildTaskCfSearch(
			[
				{ id: 'a', type: 'text' },
				{ id: 'b', type: 'select' }
			],
			[
				{ taskId: 't1', fieldId: 'a', value: 'note' },
				{ taskId: 't1', fieldId: 'b', value: '["x"]' }
			],
			resolvers
		);
		expect(out.get('t1')).toBe('note opt:x');
	});
});

describe('encodeIds', () => {
	it('encodes an id array as a JSON string', () => {
		expect(encodeIds(['a', 'b', 'c'])).toBe('["a","b","c"]');
	});

	it('dedupes repeated ids', () => {
		expect(encodeIds(['a', 'a', 'b'])).toBe('["a","b"]');
	});

	it('preserves the order of first occurrence when deduping', () => {
		expect(encodeIds(['b', 'a', 'b', 'c', 'a'])).toBe('["b","a","c"]');
	});

	it('encodes an empty array as an empty JSON array', () => {
		expect(encodeIds([])).toBe('[]');
	});
});

describe('isValidUrl', () => {
	it('accepts an http url', () => {
		expect(isValidUrl('http://example.com')).toBe(true);
	});

	it('accepts an https url', () => {
		expect(isValidUrl('https://example.com/path?q=1')).toBe(true);
	});

	it('accepts an IPv6 loopback http url', () => {
		expect(isValidUrl('http://[::1]')).toBe(true);
	});

	it('accepts a percent-encoded http url', () => {
		expect(isValidUrl('https://example.com/a%20b')).toBe(true);
	});

	it('rejects a javascript: url', () => {
		expect(isValidUrl('javascript:alert(1)')).toBe(false);
	});

	it('rejects an ftp: url', () => {
		expect(isValidUrl('ftp://x')).toBe(false);
	});

	it('rejects a non-url string', () => {
		expect(isValidUrl('not a url')).toBe(false);
	});

	it('rejects a protocol-relative url', () => {
		expect(isValidUrl('//example.com')).toBe(false);
	});

	it('rejects an empty string', () => {
		expect(isValidUrl('')).toBe(false);
	});
});

describe('decodeValue', () => {
	it('returns [] for an empty multi-capable value and null for an empty scalar', () => {
		expect(decodeValue({ type: 'select' }, null)).toEqual([]);
		expect(decodeValue({ type: 'select' }, '')).toEqual([]);
		expect(decodeValue({ type: 'text' }, null)).toBeNull();
		expect(decodeValue({ type: 'text' }, '')).toBeNull();
	});

	it('decodes a checkbox "true" to boolean true', () => {
		expect(decodeValue({ type: 'checkbox' }, 'true')).toBe(true);
	});

	it('recovers a legacy scalar task id as a single-element array', () => {
		expect(decodeValue({ type: 'task' }, 'legacy-id')).toEqual(['legacy-id']);
	});

	it('returns [] for malformed JSON on a non-task multi type', () => {
		expect(decodeValue({ type: 'select' }, '{bad json')).toEqual([]);
		expect(decodeValue({ type: 'person' }, 'not-json')).toEqual([]);
	});
});
