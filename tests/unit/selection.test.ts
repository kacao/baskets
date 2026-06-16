import { beforeEach, describe, expect, it } from 'vitest';
import { createSelection, selection } from '$lib/selection.svelte';

// `createSelection()` returns an isolated store so each test starts clean;
// the exported `selection` singleton is exercised separately (and reset first).

describe('selection store', () => {
	describe('basic add / remove / toggle', () => {
		it('starts empty', () => {
			const s = createSelection();
			expect(s.size).toBe(0);
			expect(s.ids).toEqual([]);
			expect(s.has('a')).toBe(false);
		});

		it('toggle adds then removes an id', () => {
			const s = createSelection();
			s.toggle('a');
			expect(s.has('a')).toBe(true);
			expect(s.size).toBe(1);
			s.toggle('a');
			expect(s.has('a')).toBe(false);
			expect(s.size).toBe(0);
		});

		it('toggles independent ids without affecting each other', () => {
			const s = createSelection();
			s.toggle('a');
			s.toggle('b');
			expect(s.ids).toEqual(['a', 'b']);
			s.toggle('a');
			expect(s.ids).toEqual(['b']);
		});

		it('set(id, true) adds and set(id, false) removes (explicit)', () => {
			const s = createSelection();
			s.set('a', true);
			expect(s.has('a')).toBe(true);
			s.set('a', true); // idempotent add
			expect(s.size).toBe(1);
			s.set('a', false);
			expect(s.has('a')).toBe(false);
			s.set('a', false); // idempotent remove
			expect(s.size).toBe(0);
		});

		it('exposes a stable array via ids', () => {
			const s = createSelection();
			s.toggle('x');
			s.toggle('y');
			const first = s.ids;
			expect(Array.isArray(first)).toBe(true);
			// mutating the returned array must not change the store
			first.push('z');
			expect(s.has('z')).toBe(false);
		});
	});

	describe('clear', () => {
		it('empties the selection', () => {
			const s = createSelection();
			s.toggle('a');
			s.toggle('b');
			s.clear();
			expect(s.size).toBe(0);
			expect(s.ids).toEqual([]);
		});

		it('resets the range anchor so next range falls back to toggle', () => {
			const s = createSelection();
			s.toggle('a'); // anchor = a
			s.clear(); // anchor reset to null
			const ordered = ['a', 'b', 'c'];
			s.range('c', ordered); // no anchor -> plain toggle of c only
			expect(s.ids).toEqual(['c']);
		});

		it('is a no-op on an already-empty selection', () => {
			const s = createSelection();
			s.clear();
			expect(s.size).toBe(0);
		});
	});

	describe('selectAll / allSelected', () => {
		it('selectAll selects every ordered id', () => {
			const s = createSelection();
			const ordered = ['a', 'b', 'c'];
			s.selectAll(ordered);
			expect(s.size).toBe(3);
			expect(s.allSelected(ordered)).toBe(true);
		});

		it('selectAll replaces the existing selection', () => {
			const s = createSelection();
			s.toggle('z');
			s.selectAll(['a', 'b']);
			expect(s.ids).toEqual(['a', 'b']);
			expect(s.has('z')).toBe(false);
		});

		it('allSelected is false when one id is missing', () => {
			const s = createSelection();
			s.toggle('a');
			s.toggle('b');
			expect(s.allSelected(['a', 'b', 'c'])).toBe(false);
		});

		it('allSelected is false for an empty ordered list', () => {
			const s = createSelection();
			expect(s.allSelected([])).toBe(false);
		});
	});

	describe('range / shift behavior', () => {
		const ordered = ['a', 'b', 'c', 'd', 'e'];

		it('selects the inclusive span between anchor and target (forward)', () => {
			const s = createSelection();
			s.toggle('b'); // anchor = b
			s.range('d', ordered);
			expect(s.ids).toEqual(['b', 'c', 'd']);
		});

		it('selects the inclusive span when target precedes anchor (backward)', () => {
			const s = createSelection();
			s.toggle('d'); // anchor = d
			s.range('b', ordered);
			expect(new Set(s.ids)).toEqual(new Set(['b', 'c', 'd']));
		});

		it('keeps the anchor so a subsequent shift re-ranges from it', () => {
			const s = createSelection();
			s.toggle('b'); // anchor = b
			s.range('d', ordered); // b..d
			s.range('a', ordered); // re-range from b -> a..b
			expect(new Set(s.ids)).toEqual(new Set(['a', 'b', 'c', 'd']));
		});

		it('falls back to a plain toggle when there is no anchor', () => {
			const s = createSelection();
			s.range('c', ordered);
			expect(s.ids).toEqual(['c']);
		});

		it('falls back to a plain toggle when anchor === target', () => {
			const s = createSelection();
			s.toggle('c'); // anchor = c, selected
			s.range('c', ordered); // same -> toggle off
			expect(s.has('c')).toBe(false);
		});

		it('falls back to toggle when the target is not in ordered', () => {
			const s = createSelection();
			s.toggle('b'); // anchor = b
			s.range('zzz', ordered);
			expect(s.ids).toEqual(['b', 'zzz']);
		});

		it('falls back to toggle when the anchor is not in ordered', () => {
			const s = createSelection();
			s.toggle('gone'); // anchor = gone, not in ordered
			s.range('c', ordered);
			expect(s.ids).toEqual(['gone', 'c']);
		});

		it('unions the range with already-selected ids', () => {
			const s = createSelection();
			s.toggle('e'); // pre-select e, anchor = e
			s.toggle('a'); // anchor moves to a
			s.range('c', ordered); // a..c
			expect(new Set(s.ids)).toEqual(new Set(['a', 'b', 'c', 'e']));
		});
	});

	describe('prune', () => {
		it('drops selected ids no longer present in ordered', () => {
			const s = createSelection();
			s.selectAll(['a', 'b', 'c']);
			s.prune(['a', 'c']); // b removed (e.g. deleted row)
			expect(new Set(s.ids)).toEqual(new Set(['a', 'c']));
		});

		it('leaves the selection untouched when all ids still present', () => {
			const s = createSelection();
			s.selectAll(['a', 'b']);
			const before = s.ids;
			s.prune(['a', 'b', 'c']);
			expect(s.ids).toEqual(before);
		});
	});

	describe('shared singleton', () => {
		beforeEach(() => selection.clear());

		it('is a working Selection instance', () => {
			selection.toggle('a');
			expect(selection.has('a')).toBe(true);
			selection.clear();
			expect(selection.size).toBe(0);
		});

		it('is isolated from createSelection() instances', () => {
			const s = createSelection();
			s.toggle('a');
			expect(selection.has('a')).toBe(false);
		});
	});
});
