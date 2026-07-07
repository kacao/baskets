<script lang="ts">
	import { base } from '$app/paths';

	// Renders one icon from the external sprite (static/heroicons.svg, built by
	// scripts/build-heroicons-sprite.mjs from the Heroicons 24px outline set; ADR-052).
	// Icons are 24x24 stroke glyphs on currentColor, so they inherit the surrounding
	// text color. `name` is a Heroicon name OR a legacy iconoir token (aliased in the
	// sprite). Decorative by default; pass `label` to expose it to assistive tech.
	let {
		name,
		size = 16,
		label,
		class: klass = ''
	}: { name: string; size?: number | string; label?: string; class?: string } = $props();

	const dim = $derived(typeof size === 'number' ? `${size}px` : size);
</script>

<svg
	class="io {klass}"
	width={dim}
	height={dim}
	viewBox="0 0 24 24"
	role={label ? 'img' : undefined}
	aria-label={label}
	aria-hidden={label ? undefined : 'true'}
	focusable="false"
>
	<use href="{base}/heroicons.svg#{name}" />
</svg>

<style>
	.io {
		display: inline-block;
		flex: 0 0 auto;
		vertical-align: middle;
		color: inherit;
	}
</style>
