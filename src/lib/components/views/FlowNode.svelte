<script lang="ts">
	import { Handle, Position } from '@xyflow/svelte';
	import Icon from '$lib/components/Icon.svelte';

	let {
		data
	}: {
		data: {
			kind: 'task' | 'milestone';
			label: string;
			color?: string;
			sub?: boolean;
			hasSubs?: boolean;
			expanded?: boolean;
			onSelect?: () => void;
			onOpen?: () => void;
			onToggle?: () => void;
		};
	} = $props();
</script>

<Handle type="target" position={Position.Left} />
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
	class="fn-node"
	class:milestone={data.kind === 'milestone'}
	class:sub={data.sub}
	role="button"
	tabindex="0"
	style:--c={data.color ?? 'var(--color-primary)'}
	onclick={(e) => {
		e.stopPropagation();
		data.onSelect?.();
	}}
	ondblclick={(e) => {
		e.stopPropagation();
		data.onOpen?.();
	}}
	onkeydown={(e) => {
		if (e.key === 'Enter') {
			e.preventDefault();
			data.onSelect?.();
		}
	}}
>
	{#if data.hasSubs}
		<button
			class="fn-expand"
			type="button"
			aria-label="Toggle sub-tasks"
			onclick={(e) => {
				e.stopPropagation();
				data.onToggle?.();
			}}
		>
			<Icon name={data.expanded ? 'nav-arrow-down' : 'nav-arrow-right'} size={12} />
		</button>
	{/if}
	{#if data.kind === 'task'}<span class="fn-dot"></span>{/if}
	<span class="fn-label">{data.label}</span>
</div>
<Handle type="source" position={Position.Right} />

<style>
	.fn-node {
		display: flex;
		align-items: center;
		gap: 6px;
		max-width: 220px;
		border: 1px solid var(--color-base-300);
		border-radius: var(--radius-field, 0.25rem);
		background: var(--color-base-100);
		color: var(--color-base-content);
		font-family: var(--font-body);
		font-size: 12px;
		font-weight: 500;
		line-height: 1.3;
		text-align: left;
		padding: 6px 10px;
		cursor: pointer;
		transition:
			border-color var(--dur-fast) ease,
			box-shadow var(--dur-fast) ease;
	}

	.fn-node:hover {
		border-color: var(--color-base-content);
	}

	.fn-node.milestone {
		background: color-mix(in oklab, var(--color-primary) 14%, var(--color-base-100));
		border-color: color-mix(in oklab, var(--color-primary) 45%, transparent);
		font-weight: 600;
	}

	.fn-node.sub {
		font-weight: 400;
		font-size: 11px;
		padding: 4px 8px;
		background: var(--color-base-200);
	}

	.fn-expand {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex: 0 0 auto;
		border: none;
		background: none;
		color: var(--color-muted);
		cursor: pointer;
		padding: 0;
		margin: -2px -2px -2px -4px;
	}

	.fn-expand:hover {
		color: var(--color-fg);
	}

	.fn-dot {
		width: 8px;
		height: 8px;
		flex: 0 0 auto;
		border-radius: 999px;
		background: var(--c);
	}

	.fn-label {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
