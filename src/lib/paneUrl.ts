import { pushState, replaceState } from '$app/navigation';
import { page } from '$app/state';

// Reflect an open/closed side pane in the URL search params (so a pane is
// addressable — copy the URL, open it elsewhere, and the page restores the pane).
// Uses SvelteKit shallow routing, so load() does NOT re-run (no refetch/flash).
//
// `changes` maps param → value; a null/'' value deletes the param.
//
// History semantics (unless overridden by `push`): OPENING a pane (a param going
// absent → present) PUSHES one entry, so browser Back closes the pane and restores
// the pre-open URL — including the active `?view=` tab, which a replace would
// overwrite (Back then skipped to the previously-viewed tab). Changing a present
// param's value (in-pane task→task nav) and clearing it (close) REPLACE, so
// drilling around inside a pane doesn't fill history.
//
// The base is `window.location.href`, NOT `page.url`: SvelteKit's shallow
// replaceState/pushState update the address bar but do NOT refresh `$app/state`'s
// `page.url` synchronously, so building on `page.url` reads a stale URL and a
// second update (e.g. close after open) would dedup against the wrong base and
// no-op. `window.location` always reflects the live URL.
export function setPaneUrl(changes: Record<string, string | null>, push?: boolean): void {
	if (typeof window === 'undefined') return;
	const url = new URL(window.location.href);
	let opensPane = false;
	for (const [key, value] of Object.entries(changes)) {
		if (value == null || value === '') {
			url.searchParams.delete(key);
		} else {
			if (url.searchParams.get(key) == null) opensPane = true;
			url.searchParams.set(key, value);
		}
	}
	if (url.href === window.location.href) return;
	((push ?? opensPane) ? pushState : replaceState)(url, page.state);
}

// Read a pane URL param (e.g. 'task', 'pane') for a view's read-effect. Touches
// `page.url` so REAL navigations (back/forward) still re-run the caller's $effect
// — but returns the value from the LIVE address bar (`window.location`). This
// matters because `setPaneUrl` writes via shallow routing, leaving `page.url`
// stale (missing the param). Without this, an `invalidateAll()` (e.g. an input's
// blur auto-save) churns the `page` object, re-runs the read-effect with that
// stale URL, and clobbers a shallow-routed pane selection back to null — closing
// the pane on any click-out of a pane input. `window.location` is always current.
export function readPaneParam(key: string): string | null {
	void page.url; // subscribe so back/forward still triggers the caller's effect
	if (typeof window === 'undefined') return null;
	return new URL(window.location.href).searchParams.get(key);
}
