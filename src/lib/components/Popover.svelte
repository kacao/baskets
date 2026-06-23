<script lang="ts">
	import type { Snippet } from 'svelte';
	import { popover } from '$lib/transitions';

	// A pill button that opens a floating popover panel on click. Closes on
	// outside-click (and re-click). The `panel` snippet receives a `close()` so
	// its content can dismiss the popover after an action (pick / create).
	let {
		trigger,
		panel,
		ariaLabel,
		align = 'left',
		up = false
	}: {
		trigger: Snippet;
		panel: Snippet<[() => void]>;
		ariaLabel?: string;
		align?: 'left' | 'right';
		up?: boolean;
	} = $props();

	let open = $state(false);
	let wrap = $state<HTMLElement | null>(null);
	let popEl = $state<HTMLElement | null>(null);
	const close = () => (open = false);
	// close on any click outside THIS popover — the panel is portaled to <body>
	// (outside `wrap`), so check both the trigger wrap AND the panel node.
	const onWindowClick = (e: MouseEvent) => {
		if (!open) return;
		const target = e.target as Node;
		if (wrap?.contains(target) || popEl?.contains(target)) return;
		close();
	};

	// Portal the panel to <body> and position it as `fixed` against the trigger, so no
	// scrollable/overflow ancestor (e.g. the side pane) can clip it. Flips to the opposite
	// edge + clamps to the viewport; repositions on scroll/resize while open.
	function floating(node: HTMLElement) {
		document.body.appendChild(node);
		const place = () => {
			const r = wrap?.getBoundingClientRect();
			if (!r) return;
			const pw = node.offsetWidth;
			const ph = node.offsetHeight;
			const vw = window.innerWidth;
			const vh = window.innerHeight;
			let top = up ? r.top - ph - 4 : r.bottom + 4;
			if (!up && top + ph > vh - 8 && r.top - ph - 4 > 8) top = r.top - ph - 4;
			if (up && top < 8 && r.bottom + ph + 4 < vh - 8) top = r.bottom + 4;
			let left = align === 'right' ? r.right - pw : r.left;
			left = Math.max(8, Math.min(left, vw - pw - 8));
			node.style.top = `${Math.max(8, top)}px`;
			node.style.left = `${left}px`;
		};
		place();
		window.addEventListener('scroll', place, true);
		window.addEventListener('resize', place);
		return {
			destroy() {
				window.removeEventListener('scroll', place, true);
				window.removeEventListener('resize', place);
				node.remove();
			}
		};
	}
</script>

<svelte:window onclick={onWindowClick} />

<div class="pop-wrap" bind:this={wrap}>
	<button
		class="pill"
		type="button"
		aria-haspopup="dialog"
		aria-expanded={open}
		aria-label={ariaLabel}
		onclick={() => (open = !open)}
	>
		{@render trigger()}
	</button>
	{#if open}
		<div
			class="pop"
			class:right={align === 'right'}
			class:up
			role="dialog"
			bind:this={popEl}
			use:floating
			transition:popover
		>
			{@render panel(close)}
		</div>
	{/if}
</div>

<style>
	.pop-wrap {
		position: relative;
		display: inline-flex;
	}

	.pill {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		max-width: 100%;
		border: 1px solid var(--color-border-subtle);
		background: var(--color-bg);
		color: var(--color-fg);
		border-radius: 999px;
		font-family: var(--font-body);
		font-size: 12px;
		line-height: 1.4;
		padding: 3px 10px;
		cursor: pointer;
		white-space: nowrap;
		transition:
			border-color var(--dur-fast) ease,
			background var(--dur-fast) ease;
	}

	.pill:hover {
		border-color: var(--color-fg);
		background: var(--color-surface-muted);
	}

	/* portaled to <body> + positioned by the `floating` action (top/left set inline) */
	.pop {
		position: fixed;
		top: 0;
		left: 0;
		z-index: 50;
		min-width: 200px;
		max-width: 280px;
		max-height: min(320px, 60vh);
		overflow-y: auto;
		/* a popover never scrolls horizontally — clip rather than show an x-scrollbar
		   (e.g. when a vertical scrollbar narrows the panel by a few px) */
		overflow-x: hidden;
		overscroll-behavior: contain;
		background: var(--color-base-100);
		border: 1px solid var(--color-base-300);
		border-radius: var(--radius-box, 0.5rem);
		box-shadow:
			0 1px 2px rgb(0 0 0 / 0.06),
			0 8px 24px rgb(0 0 0 / 0.12);
		padding: 4px;
		transform-origin: top left;
	}

	.pop.right {
		transform-origin: top right;
	}

	/* open upward (e.g. a bottom-anchored bar) */
	.pop.up {
		transform-origin: bottom left;
	}

	.pop.up.right {
		transform-origin: bottom right;
	}
</style>
