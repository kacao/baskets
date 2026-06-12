<script lang="ts">
	let { priority }: { priority: string } = $props();
</script>

{#if priority !== 'none'}
	<span
		class="badge"
		class:badge--error={priority === 'urgent'}
		class:badge--warning={priority === 'high'}
		class:badge--info={priority === 'medium'}
	>
		{priority}
	</span>
{/if}
