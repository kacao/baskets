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
	const close = () => (open = false);
	// close on any click outside THIS popover — using a contains-check (not
	// stopPropagation) so clicking another pill closes this one and opens that one.
	const onWindowClick = (e: MouseEvent) => {
		if (open && wrap && !wrap.contains(e.target as Node)) close();
	};
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
		<div class="pop" class:right={align === 'right'} class:up role="dialog" transition:popover>
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

	.pop {
		position: absolute;
		top: calc(100% + 4px);
		left: 0;
		z-index: 40;
		min-width: 200px;
		max-width: 280px;
		max-height: min(320px, 60vh);
		overflow-y: auto;
		overscroll-behavior: contain;
		background: var(--color-base-100);
		border: 1px solid var(--color-base-300);
		border-radius: var(--radius-box, 0.5rem);
		box-shadow: var(--shadow);
		padding: 4px;
		transform-origin: top left;
	}

	.pop.right {
		left: auto;
		right: 0;
		transform-origin: top right;
	}

	/* open upward (e.g. a bottom-anchored bar) */
	.pop.up {
		top: auto;
		bottom: calc(100% + 4px);
		transform-origin: bottom left;
	}

	.pop.up.right {
		transform-origin: bottom right;
	}
</style>
