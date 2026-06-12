<script lang="ts">
	import StatusSelect from '$lib/components/StatusSelect.svelte';
	import PriorityBadge from '$lib/components/PriorityBadge.svelte';

	type Task = {
		id: string;
		parentId: string | null;
		title: string;
		statusId: string;
		priority: string;
		assigneeId: string | null;
	};
	type Status = { id: string; name: string; category: string };

	let {
		tasks,
		statuses,
		users,
		canEditTask
	}: {
		tasks: Task[];
		statuses: Status[];
		users: { id: string; name: string }[];
		canEditTask: (t: Task) => boolean;
	} = $props();

	const topTasks = $derived(tasks.filter((t) => !t.parentId));
	const inColumn = (statusId: string) => topTasks.filter((t) => t.statusId === statusId);
	const userName = (id: string | null) => users.find((u) => u.id === id)?.name ?? null;
</script>

<div class="board">
	{#each statuses as s (s.id)}
		{@const col = inColumn(s.id)}
		<div class="column">
			<div class="col-head">
				<span class="col-name">{s.name}</span>
				<span class="col-count mono">{col.length}</span>
			</div>
			{#each col as t (t.id)}
				<div class="bcard">
					<p class="bcard-title">{t.title}</p>
					<div class="bcard-meta">
						<StatusSelect taskId={t.id} statusId={t.statusId} {statuses} canEdit={canEditTask(t)} />
						<PriorityBadge priority={t.priority} />
						{#if userName(t.assigneeId)}
							<span class="badge">{userName(t.assigneeId)}</span>
						{/if}
					</div>
				</div>
			{:else}
				<p class="u-tiny u-muted empty">—</p>
			{/each}
		</div>
	{/each}
</div>

<style>
	.board {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
		gap: var(--sp-2);
		align-items: start;
	}

	.column {
		border: 1px solid var(--color-border-subtle);
		background: var(--color-bg);
	}

	.col-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--sp-1) var(--sp-2);
		border-bottom: 1px solid var(--color-border-subtle);
	}

	.col-name {
		font-size: 13px;
		font-weight: 600;
	}

	.col-count {
		font-size: 11px;
		color: var(--color-muted);
	}

	.bcard {
		border-bottom: 1px solid var(--color-border-subtle);
		padding: var(--sp-2);
	}

	.bcard:last-child {
		border-bottom: none;
	}

	.bcard-title {
		font-size: 14px;
		font-weight: 500;
		margin-bottom: var(--sp-1);
		overflow-wrap: anywhere;
	}

	.bcard-meta {
		display: flex;
		align-items: center;
		gap: var(--sp-1);
		flex-wrap: wrap;
	}

	.empty {
		padding: var(--sp-2);
	}
</style>
