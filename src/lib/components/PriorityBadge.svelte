<script lang="ts">
	import { t } from '$lib/i18n';
	import PriorityIcon from '$lib/components/PriorityIcon.svelte';

	let { priority }: { priority: string } = $props();
</script>

{#if priority !== 'none'}
	<span class="pri-badge">
		<PriorityIcon {priority} />
		{$t(priority)}
	</span>
{/if}

<style>
	.pri-badge {
		display: inline-flex;
		align-items: center;
		gap: var(--sp-1);
		color: var(--color-fg);
		font-size: 0.8125rem;
		line-height: 1;
		white-space: nowrap;
	}
</style>
