import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// paneUrl reads `page.state` and writes via `$app/navigation`, and reads `page.url`
// ONLY to subscribe to real navigations — it must NOT trust page.url's value (which
// goes stale under shallow routing). Mock page.url to a DELIBERATELY STALE value so
// the tests prove readPaneParam/setPaneUrl use the live window.location instead.
vi.mock('$app/navigation', () => ({ pushState: vi.fn(), replaceState: vi.fn() }));
vi.mock('$app/state', () => ({
	page: { url: new URL('http://localhost/STALE?task=stale-value&pane=stale'), state: { snap: 1 } }
}));

import { pushState, replaceState } from '$app/navigation';
import { readPaneParam, setPaneUrl } from '$lib/paneUrl';

const setLocation = (pathAndQuery: string) =>
	window.history.replaceState(null, '', pathAndQuery);

beforeEach(() => {
	setLocation('/projects/p1?view=v1');
	vi.mocked(pushState).mockClear();
	vi.mocked(replaceState).mockClear();
});

afterEach(() => {
	setLocation('/');
});

describe('readPaneParam', () => {
	it('reads the param from the LIVE address bar, not the stale page.url', () => {
		// window.location says task=live-42; the mocked page.url says task=stale-value.
		setLocation('/projects/p1?task=live-42');
		expect(readPaneParam('task')).toBe('live-42');
	});

	it('returns null when the param is absent from the live URL', () => {
		setLocation('/projects/p1?view=v1');
		expect(readPaneParam('task')).toBeNull();
	});

	it('reflects a later address-bar change without a page.url update (shallow routing)', () => {
		setLocation('/projects/p1'); // no task
		expect(readPaneParam('task')).toBeNull();
		setLocation('/projects/p1?task=abc'); // shallow-routed open
		expect(readPaneParam('task')).toBe('abc');
		setLocation('/projects/p1'); // shallow-routed close
		expect(readPaneParam('task')).toBeNull();
	});

	it('reads other pane params too (e.g. pane)', () => {
		setLocation('/projects/p1?pane=customize');
		expect(readPaneParam('pane')).toBe('customize');
	});
});

describe('setPaneUrl', () => {
	it('adds a param via replaceState, based on the live URL (not page.url)', () => {
		setLocation('/projects/p1?view=v1');
		setPaneUrl({ task: 't-9' });
		expect(replaceState).toHaveBeenCalledTimes(1);
		const [url] = vi.mocked(replaceState).mock.calls[0];
		expect(String(url)).toContain('/projects/p1');
		expect((url as URL).searchParams.get('task')).toBe('t-9');
		// pre-existing params are preserved
		expect((url as URL).searchParams.get('view')).toBe('v1');
	});

	it('deletes the param when the value is null or empty', () => {
		setLocation('/projects/p1?view=v1&task=t-9');
		setPaneUrl({ task: null });
		const [url] = vi.mocked(replaceState).mock.calls[0];
		expect((url as URL).searchParams.has('task')).toBe(false);
		expect((url as URL).searchParams.get('view')).toBe('v1');
	});

	it('no-ops (no history write) when the resulting URL is unchanged', () => {
		setLocation('/projects/p1?task=same');
		setPaneUrl({ task: 'same' });
		expect(replaceState).not.toHaveBeenCalled();
		expect(pushState).not.toHaveBeenCalled();
	});

	it('uses pushState (a history entry) when push=true', () => {
		setLocation('/projects/p1');
		setPaneUrl({ task: 't-1' }, true);
		expect(pushState).toHaveBeenCalledTimes(1);
		expect(replaceState).not.toHaveBeenCalled();
	});

	it('passes the current page.state snapshot through to the history call', () => {
		setLocation('/projects/p1');
		setPaneUrl({ task: 't-2' });
		const [, state] = vi.mocked(replaceState).mock.calls[0];
		expect(state).toEqual({ snap: 1 });
	});
});
