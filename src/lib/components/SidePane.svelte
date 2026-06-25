<script lang="ts">
	import type { Snippet } from 'svelte';
	import { onMount, onDestroy } from 'svelte';
	import { fly } from 'svelte/transition';
	import { openPane, closePane } from '$lib/sidePaneRegistry';
	import { portal } from '$lib/portal';
	import Icon from '$lib/components/Icon.svelte';
	import { t } from '$lib/i18n';

	// Reusable right-side pane chrome (ADR-025): a flex sibling of the scrollable main
	// content (portaled up to the app shell's `[data-pane-host]`), so the content keeps
	// its own horizontal + vertical scrollbars beside it. Slides in, closes on Escape,
	// scrolls its own body, and is resizable via a left-edge drag handle. Callers supply
	// a `title` (or a `header` snippet) and the body via `children`. Width persists
	// (localStorage). On narrow screens it falls back to a fixed full-width overlay.
	let {
		title = '',
		onClose,
		width = 400,
		ariaLabel,
		header,
		children
	}: {
		title?: string;
		onClose: () => void;
		width?: number;
		ariaLabel?: string;
		header?: Snippet;
		children: Snippet;
	} = $props();

	const MIN_W = 320;
	const maxW = () => Math.min(900, Math.round(window.innerWidth * 0.92));
	const clamp = (n: number) => Math.max(MIN_W, Math.min(maxW(), n));

	// Hydrate the persisted width SYNCHRONOUSLY at init so the pane opens at its
	// final width — a post-mount width change would retrigger the layout below and
	// make the open animation jerk. (SSR-safe: no localStorage on the server.)
	function initWidth() {
		if (typeof localStorage === 'undefined') return width;
		const saved = Number(localStorage.getItem('sidePaneWidth'));
		return saved ? clamp(saved) : width;
	}
	// svelte-ignore state_referenced_locally
	let w = $state(initWidth());
	let dragging = $state(false);

	// only one SidePane open at a time: opening this one closes the previous
	const paneId = {};
	onMount(() => openPane(paneId, onClose));
	onDestroy(() => {
		closePane(paneId);
		// drop the host var on close (only here, not on every w change — removing it
		// per-change flashed .content to full width and jerked the animation)
		(document.querySelector('[data-pane-host]') as HTMLElement | null)?.style.removeProperty(
			'--pane-w'
		);
	});

	// Expose the live pane width on the shared portal host (an ancestor of BOTH
	// .content and this pane) so .content can keep its children at their pre-open
	// width (scroll instead of reflow). Just updates the value; cleared in onDestroy.
	$effect(() => {
		const host = document.querySelector('[data-pane-host]') as HTMLElement | null;
		if (host) host.style.setProperty('--pane-w', `${w}px`);
	});

	function startResize(e: PointerEvent) {
		e.preventDefault();
		dragging = true;
		document.body.style.userSelect = 'none';
		const startX = e.clientX;
		const startW = w;
		const onMove = (ev: PointerEvent) => {
			// pane is on the right: dragging the handle left widens it
			w = clamp(startW + (startX - ev.clientX));
		};
		const onUp = () => {
			dragging = false;
			document.body.style.userSelect = '';
			localStorage.setItem('sidePaneWidth', String(w));
			window.removeEventListener('pointermove', onMove);
			window.removeEventListener('pointerup', onUp);
		};
		window.addEventListener('pointermove', onMove);
		window.addEventListener('pointerup', onUp);
	}
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onClose()} />

<aside
	class="side-pane"
	class:dragging
	style="--pane-w: {w}px"
	use:portal
	transition:fly={{ x: 16, duration: 150 }}
	aria-label={ariaLabel ?? title}
>
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="pane-resizer"
		onpointerdown={startResize}
		role="separator"
		aria-orientation="vertical"
		aria-label={$t('Resize panel')}
	></div>
	<div class="pane-head">
		{#if header}{@render header()}{:else}<h3 class="pane-title">{title}</h3>{/if}
		<span class="pane-spacer"></span>
		<button class="pane-x" type="button" onclick={onClose} aria-label={$t('Close panel')}><Icon name="xmark" size={18} /></button>
	</div>
	<div class="pane-body">
		{@render children()}
	</div>
</aside>

<style>
	.side-pane {
		/* in-flow flex sibling of .content inside the shell's [data-pane-host] row, so
		   the content area keeps its own scrollbars beside it. Fills the row height. */
		position: relative;
		flex: 0 0 var(--pane-w, 400px);
		align-self: stretch;
		min-height: 0;
		max-width: 92vw;
		display: flex;
		flex-direction: column;
		background: var(--color-bg);
		border-left: 1px solid var(--color-border-subtle);
		z-index: 8;
	}

	.pane-resizer {
		position: absolute;
		top: 0;
		left: -3px;
		width: 7px;
		height: 100%;
		cursor: ew-resize;
		z-index: 2;
		touch-action: none;
	}

	.pane-resizer::after {
		content: '';
		position: absolute;
		top: 0;
		left: 3px;
		width: 2px;
		height: 100%;
		background: transparent;
		transition: background var(--dur-fast) ease;
	}

	.pane-resizer:hover::after,
	.side-pane.dragging .pane-resizer::after {
		background: var(--color-link);
	}

	.pane-head {
		display: flex;
		align-items: center;
		gap: var(--sp-1);
		padding: var(--sp-3) var(--sp-3) var(--sp-2);
		border-bottom: 1px solid var(--color-border-subtle);
	}

	.pane-title {
		font-size: 16px;
		font-weight: 600;
		overflow-wrap: anywhere;
	}

	.pane-spacer {
		flex: 1;
	}

	.pane-x {
		flex: 0 0 auto;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		margin: -5px -6px;
		border: none;
		background: none;
		font-size: 18px;
		line-height: 1;
		cursor: pointer;
		color: var(--color-muted);
		border-radius: var(--radius);
		transition: color var(--dur-fast) ease, background var(--dur-fast) ease;
	}

	.pane-x:hover {
		color: var(--color-fg);
		background: var(--color-surface-muted);
	}

	.pane-body {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		overscroll-behavior: contain;
		padding: var(--sp-3) var(--sp-3) var(--sp-4);
	}

	@media (max-width: 900px) {
		/* fixed full-width overlay on narrow screens so content isn't squeezed */
		.side-pane {
			position: fixed;
			inset: 49px 0 0 0;
			flex: none;
			width: auto;
			max-width: 100%;
		}

		.pane-resizer {
			display: none;
		}
	}
</style>
