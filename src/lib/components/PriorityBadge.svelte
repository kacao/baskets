<script lang="ts">
	import { t } from '$lib/i18n';

	let { priority }: { priority: string } = $props();
</script>

{#if priority !== 'none'}
	<span
		class="badge"
		class:badge--error={priority === 'urgent'}
		class:badge--warning={priority === 'high'}
		class:badge--info={priority === 'medium'}
	>
		{$t(priority)}
	</span>
{/if}
