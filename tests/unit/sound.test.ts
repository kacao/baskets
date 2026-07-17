import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/vendor/cuelume/index.js', () => ({
	play: vi.fn(),
	setEnabled: vi.fn()
}));

import { play, setEnabled } from '$lib/vendor/cuelume/index.js';
import {
	initSound,
	playSound,
	setSoundEnabled,
	shouldChimeCompletion,
	soundOn
} from '$lib/sound.svelte';

beforeEach(() => {
	vi.mocked(play).mockClear();
	vi.mocked(setEnabled).mockClear();
	document.cookie = 'sound=; path=/; max-age=0';
});

describe('sound preference wrapper', () => {
	it('initSound seeds the engine + shared state without touching the cookie or playing', () => {
		initSound(true);
		expect(setEnabled).toHaveBeenCalledWith(true);
		expect(soundOn()).toBe(true);
		expect(document.cookie).not.toContain('sound=on');
		expect(play).not.toHaveBeenCalled();
		initSound(false);
		expect(soundOn()).toBe(false);
	});

	it('enabling persists the cookie, updates the shared state, and confirms with a toggle cue', () => {
		setSoundEnabled(true);
		expect(setEnabled).toHaveBeenCalledWith(true);
		expect(soundOn()).toBe(true);
		expect(document.cookie).toContain('sound=on');
		expect(play).toHaveBeenCalledWith('toggle');
	});

	it('disabling clears the cookie and stays silent', () => {
		setSoundEnabled(true);
		vi.mocked(play).mockClear();
		setSoundEnabled(false);
		expect(setEnabled).toHaveBeenLastCalledWith(false);
		expect(document.cookie).not.toContain('sound=on');
		expect(play).not.toHaveBeenCalled();
	});

	it('playSound forwards to the engine (which gates on enabled itself)', () => {
		playSound('success');
		expect(play).toHaveBeenCalledWith('success');
	});
});

describe('shouldChimeCompletion', () => {
	const done = { category: 'completed' };
	const doneAlt = { category: 'completed' };
	const open = { category: 'in-progress' };

	it('chimes when a not-done status lands in the done bucket', () => {
		expect(shouldChimeCompletion(open, done)).toBe(true);
	});

	it('chimes when the previous status is unknown', () => {
		expect(shouldChimeCompletion(undefined, done)).toBe(true);
		expect(shouldChimeCompletion(null, done)).toBe(true);
	});

	it('stays silent when the target status is not in the done bucket', () => {
		expect(shouldChimeCompletion(open, { category: 'planned' })).toBe(false);
		expect(shouldChimeCompletion(open, undefined)).toBe(false);
	});

	it('stays silent re-picking the same done status', () => {
		expect(shouldChimeCompletion(done, done)).toBe(false);
	});

	it('stays silent moving between two done-category statuses', () => {
		expect(shouldChimeCompletion(done, doneAlt)).toBe(false);
	});
});
