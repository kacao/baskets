<script lang="ts">
	import { page } from '$app/state';
	import { slide } from 'svelte/transition';
	import StatusSelect from '$lib/components/StatusSelect.svelte';
	import PriorityBadge from '$lib/components/PriorityBadge.svelte';
	import TaskPanel from '$lib/components/TaskPanel.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { t as i18n } from '$lib/i18n';
	import { fieldAggregations } from '$lib/customFields';
	import { sortTasks } from '$lib/taskSort';
	import { selection } from '$lib/selection.svelte';
	import LabelChip from '$lib/components/LabelChip.svelte';

	type Task = {
		id: string;
		parentId: string | null;
		title: string;
		description: string | null;
		statusId: string;
		priority: string;
		assigneeId: string | null;
		milestoneId: string | null;
		locationId: string | null;
		location: string | null;
		order: number | null;
		position: number;
		dueDate: Date | string | null;
	};
	type Status = { id: string; name: string; category: string };
	type Location = { id: string; title: string; address: string | null; latitude: number | null; longitude: number | null };
	type CustomFieldDef = { id: string; name: string; type: string; config: Record<string, unknown>; position?: number };
	type CustomFieldOption = { id: string; fieldId: string; title: string; color: string | null; icon: string | null };
	type FileRef = { id: string; taskId: string | null; fieldId: string | null; filename: string; mimeType: string; size: number };

	let {
		tasks,
		statuses,
		users,
		labels,
		taskLabels,
		taskDeps,
		milestones,
		locations,
		customFields = [],
		customFieldOptions = [],
		taskCustomValues = [],
		files = [],
		config = {},
		canEditTask,
		statusDisplay = 'text',
		templates = []
	}: {
		tasks: Task[];
		statuses: Status[];
		users: { id: string; name: string }[];
		labels: { id: string; name: string; color?: string | null; icon?: string | null }[];
		taskLabels: { taskId: string; labelId: string }[];
		taskDeps: { taskId: string; dependsOnId: string }[];
		milestones: { id: string; name: string }[];
		locations: Location[];
		customFields?: CustomFieldDef[];
		customFieldOptions?: CustomFieldOption[];
		taskCustomValues?: { taskId: string; fieldId: string; value: string }[];
		files?: FileRef[];
		config?: Record<string, unknown>;
		canEditTask: (t: { id: string; parentId: string | null }) => boolean;
		statusDisplay?: 'text' | 'icon' | 'text-icon';
		templates?: { id: string; name: string }[];
	} = $props();

	let expanded = $state<Record<string, boolean>>({});
	let selectedId = $state<string | null>(page.url.searchParams.get('task'));
	const selected = $derived(tasks.find((t) => t.id === selectedId) ?? null);

	// order rank first (nulls last), then board position as tiebreaker; then the
	// view's config.sortBy is layered on top via sortTasks (stable). (BASDEV-7)
	const sortBy = $derived(typeof config.sortBy === 'string' ? (config.sortBy as string) : null);
	const statusRank = (id: string) => {
		const i = statuses.findIndex((s) => s.id === id);
		return i < 0 ? Number.MAX_SAFE_INTEGER : i;
	};
	const assigneeName = (id: string | null) => users.find((u) => u.id === id)?.name ?? null;
	const ordered = $derived(
		sortTasks(
			tasks
				.filter((t) => !t.parentId)
				.slice()
				.sort(
					(a, b) =>
						(a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER) ||
						a.position - b.position
				),
			sortBy,
			{ statusRank, assigneeName }
		)
	);
	const orderedIds = $derived(ordered.map((t) => t.id));

	const subsOf = (id: string) => tasks.filter((t) => t.parentId === id);
	const cat = (id: string) => statuses.find((s) => s.id === id)?.category ?? 'backlog';
	const userName = (id: string | null) => users.find((u) => u.id === id)?.name ?? null;
	const milestoneName = (id: string | null) => milestones.find((m) => m.id === id)?.name ?? null;
	const labelsOf = (taskId: string) =>
		taskLabels
			.filter((l) => l.taskId === taskId)
			.map((l) => labels.find((x) => x.id === l.labelId))
			.filter(Boolean);
	const taskLabelIds = (taskId: string) => taskLabels.filter((l) => l.taskId === taskId).map((l) => l.labelId);

	function fmtDate(d: Date | string | null) {
		if (!d) return null;
		return new Date(d).toISOString().slice(0, 10);
	}

	// Group by (config.groupBy): one section per group, like the table view.
	const groupBy = $derived(typeof config.groupBy === 'string' ? (config.groupBy as string) : null);
	// Aggregations (config.aggregations): number field ids summed per group, shown as "(x)".
	const aggFieldIds = $derived(Array.isArray(config.aggregations) ? (config.aggregations as string[]) : []);
	type Group = { key: string; title: string; tasks: Task[] };

	function dueBuckets(rows: Task[]): Group[] {
		const start = new Date();
		start.setHours(0, 0, 0, 0);
		const today = start.getTime();
		const week = today + 7 * 86400000;
		const b: Record<string, Task[]> = { overdue: [], today: [], week: [], later: [], none: [] };
		for (const t of rows) {
			if (!t.dueDate) {
				b.none.push(t);
				continue;
			}
			const ts = new Date(new Date(t.dueDate).setHours(0, 0, 0, 0)).getTime();
			if (ts < today) b.overdue.push(t);
			else if (ts === today) b.today.push(t);
			else if (ts < week) b.week.push(t);
			else b.later.push(t);
		}
		return [
			{ key: 'overdue', title: $i18n('Overdue'), tasks: b.overdue },
			{ key: 'today', title: $i18n('Today'), tasks: b.today },
			{ key: 'week', title: $i18n('Next 7 days'), tasks: b.week },
			{ key: 'later', title: $i18n('Later'), tasks: b.later },
			{ key: 'none', title: $i18n('No due date'), tasks: b.none }
		];
	}

	const groups = $derived.by((): Group[] => {
		const rows = ordered;
		let g: Group[];
		if (groupBy === 'status')
			g = statuses.map((s) => ({ key: s.id, title: s.name, tasks: rows.filter((t) => t.statusId === s.id) }));
		else if (groupBy === 'milestone')
			g = [
				...milestones.map((m) => ({ key: m.id, title: m.name, tasks: rows.filter((t) => t.milestoneId === m.id) })),
				{ key: '_none', title: $i18n('No milestone'), tasks: rows.filter((t) => !t.milestoneId) }
			];
		else if (groupBy === 'assignee')
			g = [
				...users.map((u) => ({ key: u.id, title: u.name, tasks: rows.filter((t) => t.assigneeId === u.id) })),
				{ key: '_none', title: $i18n('Unassigned'), tasks: rows.filter((t) => !t.assigneeId) }
			];
		else if (groupBy === 'due') g = dueBuckets(rows);
		else if (groupBy === 'label')
			g = [
				...labels.map((l) => ({ key: l.id, title: l.name, tasks: rows.filter((t) => taskLabelIds(t.id).includes(l.id)) })),
				{ key: '_none', title: $i18n('No label'), tasks: rows.filter((t) => taskLabelIds(t.id).length === 0) }
			];
		else return [{ key: '_all', title: '', tasks: rows }];
		return g.filter((x) => x.tasks.length > 0);
	});
	let collapsed = $state<Record<string, boolean>>({});
</script>

<div class="list-wrap">
	{#if ordered.length === 0}
		<div class="card" style="text-align: center;">
			<p class="u-muted">{$i18n('No tasks yet.')}</p>
		</div>
	{:else if groupBy}
		{#each groups as grp (grp.key)}
			<div class="list-group-head">
				<button
					class="chev"
					type="button"
					aria-expanded={!collapsed[grp.key]}
					aria-label={$i18n('Toggle group')}
					onclick={() => (collapsed[grp.key] = !collapsed[grp.key])}
				>
					<Icon name={collapsed[grp.key] ? 'nav-arrow-right' : 'nav-arrow-down'} size={14} />
				</button>
				<span class="group-title">{grp.title}</span>
				<span class="group-count">{grp.tasks.length}</span>
				{#each fieldAggregations(aggFieldIds, customFields, grp.tasks, taskCustomValues, tasks) as a (a.id)}
					<span class="group-agg" title={a.name}>({a.text})</span>
				{/each}
			</div>
			{#if !collapsed[grp.key]}
				<ul class="rows">
					{#each grp.tasks as t (t.id)}{@render rowItem(t)}{/each}
				</ul>
			{/if}
		{/each}
	{:else}
		<ul class="rows">
			{#each ordered as t (t.id)}{@render rowItem(t)}{/each}
		</ul>
	{/if}

	{#if selected}
		<TaskPanel
			task={selected}
			{tasks}
			{users}
			{statuses}
			{milestones}
			{locations}
			{labels}
			{taskLabels}
			{taskDeps}
			{customFields}
			{customFieldOptions}
			{taskCustomValues}
			{files}
			{canEditTask}
			{templates}
			{statusDisplay}
			onClose={() => (selectedId = null)}
			onSelectTask={(id) => (selectedId = id)}
		/>
	{/if}
</div>

{#snippet rowItem(t: Task)}
	{@const subs = subsOf(t.id)}
	{@const doneSubs = subs.filter((s) => cat(s.statusId) === 'completed').length}
	<li class="item">
		<div class="row" class:is-done={cat(t.statusId) === 'completed'}>
			<input
				type="checkbox"
				class="bulk-check"
				aria-label={$i18n('Select task')}
				checked={selection.has(t.id)}
				onclick={(e) => {
					e.stopPropagation();
					if ((e as MouseEvent).shiftKey) selection.range(t.id, orderedIds);
					else selection.toggle(t.id);
				}}
			/>
			{#if subs.length > 0}
				<button
					class="chev"
					aria-expanded={expanded[t.id] ?? false}
					aria-label={$i18n('Toggle sub-tasks')}
					onclick={() => (expanded[t.id] = !expanded[t.id])}
				>
					{#if expanded[t.id]}
						<Icon name="nav-arrow-down" size={12} />
					{:else}
						<Icon name="nav-arrow-right" size={12} />
					{/if}
				</button>
			{/if}
			{#if t.order !== null}
				<span class="order mono">{t.order}</span>
			{:else}
				<span class="order"></span>
			{/if}
			<StatusSelect taskId={t.id} statusId={t.statusId} {statuses} canEdit={canEditTask(t)} display={statusDisplay} />
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
					<LabelChip label={l!} />
				{/each}
				{#if milestoneName(t.milestoneId)}
					<span class="badge">{milestoneName(t.milestoneId)}</span>
				{/if}
				{#if subs.length > 0}
					<span class="badge">{doneSubs}/{subs.length}</span>
				{/if}
				{#if userName(t.assigneeId)}
					<span class="badge badge-neutral">{userName(t.assigneeId)}</span>
				{/if}
				{#if t.dueDate}
					<span class="badge mono">{fmtDate(t.dueDate)}</span>
				{/if}
			</div>
		</div>

		{#if expanded[t.id] && subs.length > 0}
			<ul class="subs" transition:slide={{ duration: 120 }}>
				{#each subs as s (s.id)}
					<li class="row sub" class:is-done={cat(s.statusId) === 'completed'}>
						<span class="chev chev--blank"></span>
						<span class="order"></span>
						<StatusSelect
							taskId={s.id}
							statusId={s.statusId}
							{statuses}
							canEdit={canEditTask(s)}
							display={statusDisplay}
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
{/snippet}

<style>
	.list-wrap {
		max-width: 1200px;
	}

	.list-group-head {
		display: flex;
		align-items: center;
		gap: var(--sp-1);
		margin: var(--sp-3) 0 var(--sp-1);
	}

	.list-group-head:first-child {
		margin-top: 0;
	}

	.group-title {
		font-size: 14px;
		font-weight: 600;
		color: var(--color-fg);
	}

	.group-count {
		font-size: 12px;
		color: var(--color-muted);
	}

	.group-agg {
		font-size: 12px;
		color: var(--color-muted);
		font-variant-numeric: tabular-nums;
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

	.bulk-check {
		flex: 0 0 auto;
		cursor: pointer;
		opacity: 0;
		transition: opacity var(--dur-fast) ease;
	}

	.row:hover .bulk-check,
	.bulk-check:checked {
		opacity: 1;
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
