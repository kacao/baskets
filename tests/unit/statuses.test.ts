import { describe, expect, it } from 'vitest';
import {
	STATUS_CATEGORIES,
	CATEGORY_LABELS,
	categoryLabel,
	DONE_CATEGORY,
	INITIAL_CATEGORY
} from '$lib/statuses';

describe('STATUS_CATEGORIES', () => {
	it('lists exactly the five built-in buckets in order', () => {
		expect(STATUS_CATEGORIES).toEqual([
			'backlog',
			'planned',
			'in-progress',
			'completed',
			'canceled'
		]);
	});

	it('has no duplicate entries', () => {
		expect(new Set(STATUS_CATEGORIES).size).toBe(STATUS_CATEGORIES.length);
	});

	it('has a display label for every category', () => {
		for (const c of STATUS_CATEGORIES) {
			expect(CATEGORY_LABELS[c]).toBeTruthy();
		}
	});
});

describe('CATEGORY_LABELS', () => {
	it('maps each category to its human-readable label', () => {
		expect(CATEGORY_LABELS).toEqual({
			backlog: 'Backlog',
			planned: 'Planned',
			'in-progress': 'In progress',
			completed: 'Completed',
			canceled: 'Canceled'
		});
	});
});

describe('categoryLabel', () => {
	it('returns the mapped label for a known category', () => {
		expect(categoryLabel('in-progress')).toBe('In progress');
		expect(categoryLabel('completed')).toBe('Completed');
	});

	it('falls back to the raw input for an unknown category', () => {
		expect(categoryLabel('mystery')).toBe('mystery');
	});

	it('falls back to an empty string unchanged', () => {
		expect(categoryLabel('')).toBe('');
	});
});

describe('category constants', () => {
	it('DONE_CATEGORY is "completed" and a member of STATUS_CATEGORIES', () => {
		expect(DONE_CATEGORY).toBe('completed');
		expect(STATUS_CATEGORIES).toContain(DONE_CATEGORY);
	});

	it('INITIAL_CATEGORY is "backlog" and a member of STATUS_CATEGORIES', () => {
		expect(INITIAL_CATEGORY).toBe('backlog');
		expect(STATUS_CATEGORIES).toContain(INITIAL_CATEGORY);
	});

	it('initial and done categories are distinct', () => {
		expect(INITIAL_CATEGORY).not.toBe(DONE_CATEGORY);
	});
});
