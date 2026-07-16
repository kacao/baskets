import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/vendor/cuelume/index.js', () => ({
	play: vi.fn(),
	setEnabled: vi.fn()
}));

import { play, setEnabled } from '$lib/vendor/cuelume/index.js';
import { initSound, playSound, setSoundEnabled, soundOn } from '$lib/sound.svelte';

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
