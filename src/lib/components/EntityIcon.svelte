<script lang="ts">
	import Icon from '$lib/components/Icon.svelte';

	// Renders an entity icon value: an `iconoir:<name>` reference → <Icon>, or a
	// plain emoji/glyph string → text. Backward compatible with emoji-era values.
	let {
		value,
		size = 16,
		label,
		class: klass = ''
	}: { value?: string | null; size?: number | string; label?: string; class?: string } = $props();

	const iconName = $derived(
		typeof value === 'string' && value.startsWith('iconoir:') ? value.slice(8) : null
	);
	const dim = $derived(typeof size === 'number' ? `${size}px` : size);
</script>

{#if iconName}
	<Icon name={iconName} {size} {label} class={klass} />
{:else if value}
	<span
		class="ei-emoji {klass}"
		style="font-size: {dim}; line-height: 1;"
		role={label ? 'img' : undefined}
		aria-label={label}>{value}</span
	>
{/if}

<style>
	.ei-emoji {
		display: inline-block;
		flex: 0 0 auto;
		vertical-align: middle;
	}
</style>
