import { describe, expect, it } from 'vitest';
import {
	DEFAULT_SIDEBAR_ITEMS,
	PROJECT_NAV_KEYS,
	parseSidebarItems,
	projectNavHref,
	PROJECT_NAV_ITEMS
} from '$lib/projectNav';

describe('parseSidebarItems', () => {
	it('null / undefined fall back to the default set (tasks + milestones)', () => {
		expect(parseSidebarItems(null)).toEqual(['tasks', 'milestones']);
		expect(parseSidebarItems(undefined)).toEqual(DEFAULT_SIDEBAR_ITEMS);
	});

	it('an explicit empty array means show none (distinct from unset)', () => {
		expect(parseSidebarItems('[]')).toEqual([]);
	});

	it('returns stored keys in canonical nav order regardless of stored order', () => {
		expect(parseSidebarItems('["settings","overview","tasks"]')).toEqual([
			'overview',
			'tasks',
			'settings'
		]);
	});

	it('drops unknown keys and non-string members', () => {
		expect(parseSidebarItems('["tasks","bogus",42,null]')).toEqual(['tasks']);
	});

	it('malformed JSON and non-array JSON fall back to the default set', () => {
		expect(parseSidebarItems('not json')).toEqual(DEFAULT_SIDEBAR_ITEMS);
		expect(parseSidebarItems('{"tasks":true}')).toEqual(DEFAULT_SIDEBAR_ITEMS);
		expect(parseSidebarItems('"tasks"')).toEqual(DEFAULT_SIDEBAR_ITEMS);
	});

	it('the default set contains only known keys', () => {
		for (const k of DEFAULT_SIDEBAR_ITEMS) expect(PROJECT_NAV_KEYS).toContain(k);
	});
});

describe('projectNavHref', () => {
	it('builds the project route from the item path (tasks = project root)', () => {
		const tasks = PROJECT_NAV_ITEMS.find((i) => i.key === 'tasks')!;
		const files = PROJECT_NAV_ITEMS.find((i) => i.key === 'files')!;
		expect(projectNavHref('p1', tasks)).toBe('/projects/p1');
		expect(projectNavHref('p1', files)).toBe('/projects/p1/files');
	});
});
