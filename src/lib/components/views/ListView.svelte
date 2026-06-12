<script lang="ts">
	import { page } from '$app/state';
	import { slide } from 'svelte/transition';
	import StatusSelect from '$lib/components/StatusSelect.svelte';
	import PriorityBadge from '$lib/components/PriorityBadge.svelte';
	import TaskPanel from '$lib/components/TaskPanel.svelte';
	import { t as i18n } from '$lib/i18n';

	type Task = {
		id: string;
		parentId: string | null;
		title: string;
		description: string | null;
		statusId: string;
		priority: string;
		assigneeId: string | null;
		milestoneId: string | null;
		location: string | null;
		order: number | null;
		position: number;
		dueDate: Date | string | null;
	};
	type Status = { id: string; name: string; category: string };

	let {
		tasks,
		statuses,
		users,
		labels,
		taskLabels,
		taskDeps,
		milestones,
		canEditTask
	}: {
		tasks: Task[];
		statuses: Status[];
		users: { id: string; name: string }[];
		labels: { id: string; name: string }[];
		taskLabels: { taskId: string; labelId: string }[];
		taskDeps: { taskId: string; dependsOnId: string }[];
		milestones: { id: string; name: string }[];
		canEditTask: (t: { id: string; parentId: string | null }) => boolean;
	} = $props();

	let expanded = $state<Record<string, boolean>>({});
	let selectedId = $state<string | null>(page.url.searchParams.get('task'));
	const selected = $derived(tasks.find((t) => t.id === selectedId && !t.parentId) ?? null);

	// order rank first (nulls last), then board position as tiebreaker
	const ordered = $derived(
		tasks
			.filter((t) => !t.parentId)
			.slice()
			.sort(
				(a, b) =>
					(a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER) ||
					a.position - b.position
			)
	);

	const subsOf = (id: string) => tasks.filter((t) => t.parentId === id);
	const cat = (id: string) => statuses.find((s) => s.id === id)?.category ?? 'todo';
	const userName = (id: string | null) => users.find((u) => u.id === id)?.name ?? null;
	const milestoneName = (id: string | null) => milestones.find((m) => m.id === id)?.name ?? null;
	const labelsOf = (taskId: string) =>
		taskLabels
			.filter((l) => l.taskId === taskId)
			.map((l) => labels.find((x) => x.id === l.labelId))
			.filter(Boolean);

	function fmtDate(d: Date | string | null) {
		if (!d) return null;
		return new Date(d).toISOString().slice(0, 10);
	}
</script>

<div class="list-wrap" class:with-panel={Boolean(selected)}>
	{#if ordered.length === 0}
		<div class="card" style="text-align: center;">
			<p class="u-muted">{$i18n('No tasks yet.')}</p>
		</div>
	{:else}
		<ul class="rows">
			{#each ordered as t (t.id)}
				{@const subs = subsOf(t.id)}
				{@const doneSubs = subs.filter((s) => cat(s.statusId) === 'done').length}
				<li class="item">
					<div class="row" class:is-done={cat(t.statusId) === 'done'}>
						{#if subs.length > 0}
							<button
								class="chev"
								aria-expanded={expanded[t.id] ?? false}
								aria-label={$i18n('Toggle sub-tasks')}
								onclick={() => (expanded[t.id] = !expanded[t.id])}
							>
								{expanded[t.id] ? '▾' : '▸'}
							</button>
						{:else}
							<span class="chev chev--blank"></span>
						{/if}
						{#if t.order !== null}
							<span class="order mono">{t.order}</span>
						{:else}
							<span class="order"></span>
						{/if}
						<StatusSelect taskId={t.id} statusId={t.statusId} {statuses} canEdit={canEditTask(t)} />
						<button
							class="row-title"
							class:selected={selectedId === t.id}
							onclick={() => (selectedId = selectedId === t.id ? null : t.id)}
						>
							<span class="title-text">{t.title}</span>
						</button>
						<div class="row-meta">
							<PriorityBadge priority={t.priority} />
							{#each labelsOf(t.id) as l (l!.id)}
								<span class="badge">{l!.name}</span>
							{/each}
							{#if milestoneName(t.milestoneId)}
								<span class="badge">◇ {milestoneName(t.milestoneId)}</span>
							{/if}
							{#if subs.length > 0}
								<span class="badge">{doneSubs}/{subs.length}</span>
							{/if}
							{#if userName(t.assigneeId)}
								<span class="badge badge--inverted">{userName(t.assigneeId)}</span>
							{/if}
							{#if t.dueDate}
								<span class="badge mono">{fmtDate(t.dueDate)}</span>
							{/if}
						</div>
					</div>

					{#if expanded[t.id] && subs.length > 0}
						<ul class="subs" transition:slide={{ duration: 120 }}>
							{#each subs as s (s.id)}
								<li class="row sub" class:is-done={cat(s.statusId) === 'done'}>
									<span class="chev chev--blank"></span>
									<span class="order"></span>
									<StatusSelect
										taskId={s.id}
										statusId={s.statusId}
										{statuses}
										canEdit={canEditTask(s)}
									/>
									<span class="title-text sub-title">{s.title}</span>
									<div class="row-meta">
										<PriorityBadge priority={s.priority} />
									</div>
								</li>
							{/each}
						</ul>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}

	{#if selected}
		<TaskPanel
			task={selected}
			{tasks}
			{users}
			{statuses}
			{milestones}
			{labels}
			{taskLabels}
			{taskDeps}
			{canEditTask}
			onClose={() => (selectedId = null)}
		/>
	{/if}
</div>

<style>
	.list-wrap.with-panel {
		padding-right: 416px;
	}

	@media (max-width: 900px) {
		.list-wrap.with-panel {
			padding-right: 0;
		}
	}

	.rows,
	.subs {
		list-style: none;
		padding: 0;
		margin: 0;
	}

	.rows {
		border: 1px solid var(--color-border-subtle);
	}

	.item {
		border-bottom: 1px solid var(--color-border-subtle);
	}

	.item:last-child {
		border-bottom: none;
	}

	.row {
		display: flex;
		align-items: center;
		gap: var(--sp-2);
		padding: var(--sp-1) var(--sp-2);
	}

	.row.sub {
		padding-left: var(--sp-5);
		border-top: 1px solid var(--color-border-subtle);
		background: var(--color-surface-muted);
	}

	.row.is-done .title-text {
		text-decoration: line-through;
		color: var(--color-muted);
	}

	.chev {
		width: 18px;
		flex: 0 0 18px;
		border: none;
		background: none;
		color: var(--color-muted);
		font-size: 11px;
		cursor: pointer;
		padding: 0;
		text-align: center;
	}

	.chev:hover {
		color: var(--color-fg);
	}

	.chev--blank {
		cursor: default;
	}

	.order {
		width: 22px;
		flex: 0 0 22px;
		font-size: 11px;
		color: var(--color-muted);
		text-align: right;
	}

	.row-title {
		flex: 1;
		min-width: 0;
		border: none;
		background: none;
		font-family: var(--font-body);
		font-size: 15px;
		font-weight: 500;
		color: var(--color-fg);
		text-align: left;
		cursor: pointer;
		padding: 4px 0;
		overflow-wrap: anywhere;
	}

	.row-title.selected .title-text {
		text-decoration: underline;
		text-underline-offset: 3px;
	}

	.sub-title {
		flex: 1;
		min-width: 0;
		font-size: 14px;
		overflow-wrap: anywhere;
	}

	.row-meta {
		display: flex;
		align-items: center;
		gap: var(--sp-1);
		flex-wrap: wrap;
		justify-content: flex-end;
	}

	@media (max-width: 600px) {
		.row {
			flex-wrap: wrap;
		}

		.row-meta {
			width: 100%;
		}
	}
</style>
