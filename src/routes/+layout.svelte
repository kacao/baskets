<script lang="ts">
	import '../app.css';
	import '$lib/print.css';
	import { locale } from '$lib/i18n';

	let { data, children } = $props();

	// set synchronously before the tree renders (SSR-safe: render is sync after load)
	// svelte-ignore state_referenced_locally
	locale.set(data.locale);

	$effect(() => {
		locale.set(data.locale);
	});
</script>

{@render children()}
