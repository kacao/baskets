import { beforeEach, describe, expect, it } from 'vitest';
import { loadCollapsed, storeCollapsed } from '$lib/cfCollapse';

describe('loadCollapsed', () => {
	beforeEach(() => {
		localStorage.clear();
	});

	it('returns the fallback when nothing is stored', () => {
		expect(loadCollapsed('task-1', 'field-1', true)).toBe(true);
		expect(loadCollapsed('task-1', 'field-1', false)).toBe(false);
	});

	it('reads a stored collapsed state of true regardless of the fallback', () => {
		storeCollapsed('task-1', 'field-1', true);
		expect(loadCollapsed('task-1', 'field-1', false)).toBe(true);
	});

	it('reads a stored collapsed state of false regardless of the fallback', () => {
		storeCollapsed('task-1', 'field-1', false);
		expect(loadCollapsed('task-1', 'field-1', true)).toBe(false);
	});

	it('treats any stored value other than the string one as not collapsed', () => {
		localStorage.setItem('cfCollapse:task-1:field-1', 'garbage');
		expect(loadCollapsed('task-1', 'field-1', true)).toBe(false);
	});

	it('does not collide across distinct scopes for the same field', () => {
		storeCollapsed('task-1', 'field-1', true);
		storeCollapsed('task-2', 'field-1', false);
		expect(loadCollapsed('task-1', 'field-1', false)).toBe(true);
		expect(loadCollapsed('task-2', 'field-1', true)).toBe(false);
	});

	it('does not collide across distinct fields in the same scope', () => {
		storeCollapsed('task-1', 'field-a', true);
		storeCollapsed('task-1', 'field-b', false);
		expect(loadCollapsed('task-1', 'field-a', false)).toBe(true);
		expect(loadCollapsed('task-1', 'field-b', true)).toBe(false);
	});
});

describe('storeCollapsed', () => {
	beforeEach(() => {
		localStorage.clear();
	});

	it('persists true as the string one under the namespaced key', () => {
		storeCollapsed('proj-9', 'field-x', true);
		expect(localStorage.getItem('cfCollapse:proj-9:field-x')).toBe('1');
	});

	it('persists false as the string zero under the namespaced key', () => {
		storeCollapsed('proj-9', 'field-x', false);
		expect(localStorage.getItem('cfCollapse:proj-9:field-x')).toBe('0');
	});

	it('round-trips a stored value back through loadCollapsed', () => {
		storeCollapsed('proj-9', 'field-x', true);
		expect(loadCollapsed('proj-9', 'field-x', false)).toBe(true);
		storeCollapsed('proj-9', 'field-x', false);
		expect(loadCollapsed('proj-9', 'field-x', true)).toBe(false);
	});
});
