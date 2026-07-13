<script lang="ts">
	let { priority }: { priority: string } = $props();

	// Linear-style signal bars; urgent is a filled box with "!"
	const bars: Record<string, number> = { low: 1, medium: 2, high: 3 };
	const n = $derived(bars[priority] ?? 0);
</script>

{#if priority === 'urgent'}
	<svg class="pri" viewBox="0 0 12 12" aria-label="Urgent priority" role="img">
		<rect x="0" y="0" width="12" height="12" fill="currentColor" />
		<text x="6" y="9.5" text-anchor="middle" font-size="9" font-weight="700" fill="var(--color-bg)"
			>!</text
		>
	</svg>
{:else}
	<svg
		class="pri"
		class:pri--none={priority === 'none'}
		viewBox="0 0 12 12"
		aria-label="{priority} priority"
		role="img"
	>
		<rect x="0.5" y="7" width="3" height="5" fill="currentColor" opacity={n >= 1 ? 1 : 0.25} />
		<rect x="4.5" y="4" width="3" height="8" fill="currentColor" opacity={n >= 2 ? 1 : 0.25} />
		<rect x="8.5" y="1" width="3" height="11" fill="currentColor" opacity={n >= 3 ? 1 : 0.25} />
	</svg>
{/if}

<style>
	.pri {
		width: 12px;
		height: 12px;
		flex: 0 0 12px;
		color: var(--color-fg);
		display: block;
	}

	.pri--none {
		color: var(--color-muted);
	}
</style>
