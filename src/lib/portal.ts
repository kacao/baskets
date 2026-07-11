// Relocate a node into a host elsewhere in the DOM while keeping its Svelte
// identity (props, transitions, teardown) — only its DOM parent changes. Used to
// hoist the side pane up beside the scrollable content ([data-pane-host]) and to
// lift a page header into the shell topbar ([data-page-header]).
export function portal(node: HTMLElement, target = '[data-pane-host]') {
	const move = (sel: string) => document.querySelector(sel)?.appendChild(node);
	move(target);
	// Mark the node as relocated. This action is client-only, so on SSR/first paint
	// the node still sits in its authored DOM position; callers can hide it until
	// this attribute lands (e.g. `.proj-topbar:not([data-portaled])`) to avoid a
	// flash where the header renders in .content before hydration moves it up.
	node.setAttribute('data-portaled', '');
	return {
		update(next: string) {
			move(next);
		},
		destroy() {
			node.remove();
		}
	};
}
