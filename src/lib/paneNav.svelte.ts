// Shared task-pane "drill-nav" state (ADR-055) used by every view that opens
// TaskPanel in the shared SidePane: a `?task=` URL-addressable selection plus a
// back-stack for in-pane task→task navigation (sub-task/cf-link/dep/mention).
//
// MUST be called at a component's <script> top level (component init) — $state/
// $effect only work wired into that reactive context, not inside a handler.
//
// The initial `selectedId`/`lastTaskParam` read `page.url` directly (NOT
// `readPaneParam`, which is guarded to return null when `window` is undefined) so
// a `?task=` deep link still opens the pane on a full SSR page load. The two
// effects below use `readPaneParam`/`setPaneUrl` + an `untrack()`-read sentinel,
// exactly as ADR-055 requires, so a pane-input blur (which triggers
// `invalidateAll()`) can never clobber the open selection.
import { untrack } from 'svelte';
import { page } from '$app/state';
import { setPaneUrl, readPaneParam } from '$lib/paneUrl';

export function createPaneNav<T extends { id: string }>(getAllTasks: () => T[]) {
	let selectedId = $state<string | null>(page.url.searchParams.get('task'));
	let backStack = $state<string[]>([]);
	let lastTaskParam = $state<string | null>(page.url.searchParams.get('task'));

	$effect(() => {
		const fromUrl = readPaneParam('task');
		if (fromUrl !== untrack(() => lastTaskParam)) {
			lastTaskParam = fromUrl;
			selectedId = fromUrl;
			backStack = [];
		}
	});
	$effect(() => {
		const id = selectedId;
		if (id !== untrack(() => lastTaskParam)) {
			lastTaskParam = id;
			setPaneUrl({ task: id });
		}
	});

	const selected = $derived(getAllTasks().find((t) => t.id === selectedId) ?? null);
	const backTask = $derived(
		backStack.length ? (getAllTasks().find((t) => t.id === backStack[backStack.length - 1]) ?? null) : null
	);

	function openDetail(t: T) {
		selectedId = selectedId === t.id ? null : t.id;
		backStack = [];
	}
	function navTask(id: string) {
		if (id === selectedId) return;
		if (selectedId) backStack = [...backStack, selectedId];
		selectedId = id;
	}
	function navBack() {
		selectedId = backStack[backStack.length - 1] ?? null;
		backStack = backStack.slice(0, -1);
	}

	return {
		get selectedId(): string | null {
			return selectedId;
		},
		set selectedId(v: string | null) {
			selectedId = v;
		},
		get backStack(): string[] {
			return backStack;
		},
		set backStack(v: string[]) {
			backStack = v;
		},
		get selected(): T | null {
			return selected;
		},
		get backTask(): T | null {
			return backTask;
		},
		openDetail,
		navTask,
		navBack
	};
}
