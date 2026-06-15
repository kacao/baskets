<script lang="ts">
	import { base } from '$app/paths';

	// Renders one iconoir icon from the external sprite (static/iconoir.svg, built
	// by scripts/build-iconoir-sprite.mjs). Icons are 24x24 stroke glyphs that use
	// currentColor, so they inherit the surrounding text color. Decorative by
	// default; pass `label` to expose it to assistive tech.
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
	<use href="{base}/iconoir.svg#{name}" />
</svg>

<style>
	.io {
		display: inline-block;
		flex: 0 0 auto;
		vertical-align: middle;
		color: inherit;
	}
</style>
