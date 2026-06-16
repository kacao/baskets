<script lang="ts">
	import EntityIcon from '$lib/components/EntityIcon.svelte';

	let {
		label,
		size = 12
	}: {
		label: { name: string; color?: string | null; icon?: string | null };
		size?: number;
	} = $props();
</script>

<span class="lchip" style="--c: {label.color || 'var(--color-border-subtle)'}">
	{#if label.icon}<EntityIcon value={label.icon} {size} />{/if}
	<span>{label.name}</span>
</span>

<style>
	.lchip {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-size: 12px;
		line-height: 1.5;
		border-radius: 999px;
		padding: 0 8px;
		background: color-mix(in oklab, var(--c) 12%, transparent);
		border: 1px solid color-mix(in oklab, var(--c) 40%, transparent);
		color: var(--color-fg);
	}
</style>
