<script lang="ts">
	import { enhance } from '$app/forms';
	import { fly } from 'svelte/transition';
	import StatusSelect from '$lib/components/StatusSelect.svelte';
	import PriorityBadge from '$lib/components/PriorityBadge.svelte';
	import { t } from '$lib/i18n';

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
		dueDate: Date | string | null;
	};
	type Status = { id: string; name: string; category: string };

	let {
		task,
		tasks,
		users,
		statuses,
		milestones,
		labels,
		taskLabels,
		taskDeps,
		canEditTask,
		onClose
	}: {
		task: Task;
		tasks: Task[];
		users: { id: string; name: string }[];
		statuses: Status[];
		milestones: { id: string; name: string }[];
		labels: { id: string; name: string }[];
		taskLabels: { taskId: string; labelId: string }[];
		taskDeps: { taskId: string; dependsOnId: string }[];
		canEditTask: (t: { id: string; parentId: string | null }) => boolean;
		onClose: () => void;
	} = $props();

	const editable = $derived(canEditTask(task));
	const subs = $derived(tasks.filter((t) => t.parentId === task.id));
	const cat = (id: string) => statuses.find((s) => s.id === id)?.category ?? 'todo';
	const labelsOf = (taskId: string) =>
		taskLabels
			.filter((l) => l.taskId === taskId)
			.map((l) => labels.find((x) => x.id === l.labelId))
			.filter(Boolean);
	const deps = $derived(
		taskDeps
			.filter((d) => d.taskId === task.id)
			.map((d) => tasks.find((t) => t.id === d.dependsOnId))
			.filter(Boolean)
	);
	const userName = (id: string | null) => users.find((u) => u.id === id)?.name ?? null;
	const milestoneName = (id: string | null) => milestones.find((m) => m.id === id)?.name ?? null;

	function fmtDate(d: Date | string | null) {
		if (!d) return null;
		return new Date(d).toISOString().slice(0, 10);
	}
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onClose()} />

<aside class="panel" transition:fly={{ x: 16, duration: 150 }} aria-label={$t('Task details')}>
	<div class="panel-head">
		<StatusSelect taskId={task.id} statusId={task.statusId} {statuses} canEdit={editable} />
		<span style="flex: 1;"></span>
		<button class="x-btn" onclick={onClose} aria-label={$t('Close panel')}>×</button>
	</div>

	{#if editable}
		<form method="POST" action="?/updateTask" use:enhance>
			<input type="hidden" name="id" value={task.id} />
			<div class="field">
				<input
					name="title"
					class="input title-input"
					value={task.title}
					required
					maxlength="240"
					aria-label={$t('Title')}
				/>
			</div>
			<div class="field">
				<textarea
					name="description"
					class="textarea"
					rows="4"
					placeholder={$t('Add a description…')}
					aria-label={$t('Description')}>{task.description ?? ''}</textarea
				>
			</div>
			<div class="grid2">
				<div class="field">
					<span class="label">{$t('Priority')}</span>
					<select name="priority" class="select">
						{#each ['none', 'low', 'medium', 'high', 'urgent'] as p (p)}
							<option value={p} selected={task.priority === p}>{$t(p)}</option>
						{/each}
					</select>
				</div>
				<div class="field">
					<span class="label">{$t('Assignee')}</span>
					<select name="assigneeId" class="select">
						<option value="">{$t('— unassigned')}</option>
						{#each users as u (u.id)}
							<option value={u.id} selected={task.assigneeId === u.id}>{u.name}</option>
						{/each}
					</select>
				</div>
				<div class="field">
					<span class="label">{$t('Milestone')}</span>
					<select name="milestoneId" class="select">
						<option value="">{$t('— none')}</option>
						{#each milestones as m (m.id)}
							<option value={m.id} selected={task.milestoneId === m.id}>{m.name}</option>
						{/each}
					</select>
				</div>
				<div class="field">
					<span class="label">{$t('Due date')}</span>
					<input name="dueDate" type="date" class="input" value={fmtDate(task.dueDate) ?? ''} />
				</div>
				<div class="field">
					<span class="label">{$t('Order')}</span>
					<input
						name="order"
						type="number"
						step="1"
						class="input"
						placeholder="—"
						value={task.order ?? ''}
					/>
				</div>
				<div class="field" style="grid-column: 1 / -1;">
					<span class="label">{$t('Location (lat, lng)')}</span>
					<input name="location" class="input mono" placeholder="52.37, 4.90" value={task.location ?? ''} />
				</div>
			</div>
			<div class="u-flex" style="margin-bottom: var(--sp-3);">
				<button class="btn btn--sm btn--primary" type="submit">{$t('Save')}</button>
			</div>
		</form>
		<form
			method="POST"
			action="?/deleteTask"
			use:enhance={() =>
				({ update }) => {
					onClose();
					update();
				}}
			style="margin-bottom: var(--sp-3);"
			onsubmit={(e) => {
				if (!confirm($t('Delete this task and its sub-tasks?'))) e.preventDefault();
			}}
		>
			<input type="hidden" name="id" value={task.id} />
			<button class="btn btn--sm btn--danger" type="submit">{$t('Delete task')}</button>
		</form>
	{:else}
		<h3 style="margin-bottom: var(--sp-2); overflow-wrap: anywhere;">{task.title}</h3>
		{#if task.description}
			<p class="u-small" style="margin-bottom: var(--sp-3); white-space: pre-wrap;">
				{task.description}
			</p>
		{/if}
		<div class="chips-row">
			<PriorityBadge priority={task.priority} />
			{#if userName(task.assigneeId)}
				<span class="badge badge--inverted">{userName(task.assigneeId)}</span>
			{/if}
			{#if milestoneName(task.milestoneId)}
				<span class="badge">◇ {milestoneName(task.milestoneId)}</span>
			{/if}
			{#if task.dueDate}
				<span class="badge mono">{fmtDate(task.dueDate)}</span>
			{/if}
		</div>
	{/if}

	{#if editable && labels.length > 0}
		<div class="section">
			<span class="label">{$t('Labels')}</span>
			<div class="chips-row">
				{#each labels as l (l.id)}
					{@const active = labelsOf(task.id).some((x) => x!.id === l.id)}
					<form method="POST" action="?/toggleTaskLabel" use:enhance>
						<input type="hidden" name="taskId" value={task.id} />
						<input type="hidden" name="labelId" value={l.id} />
						<button class="chip" class:chip--on={active} type="submit">{l.name}</button>
					</form>
				{/each}
			</div>
		</div>
	{:else if labelsOf(task.id).length > 0}
		<div class="section">
			<span class="label">{$t('Labels')}</span>
			<div class="chips-row">
				{#each labelsOf(task.id) as l (l!.id)}
					<span class="badge">{l!.name}</span>
				{/each}
			</div>
		</div>
	{/if}

	<div class="section">
		<span class="label">{$t('Blocked by')}</span>
		<div class="chips-row">
			{#each deps as d (d!.id)}
				{#if editable}
					<form method="POST" action="?/removeTaskDep" use:enhance>
						<input type="hidden" name="taskId" value={task.id} />
						<input type="hidden" name="dependsOnId" value={d!.id} />
						<button class="chip chip--on" type="submit" title={$t('Remove dependency')}>
							{d!.title} ×
						</button>
					</form>
				{:else}
					<span class="badge">⛓ {d!.title}</span>
				{/if}
			{:else}
				<span class="u-tiny u-muted">{$t('none')}</span>
			{/each}
			{#if editable}
				<form method="POST" action="?/addTaskDep" use:enhance>
					<input type="hidden" name="taskId" value={task.id} />
					<select
						class="select select--mini"
						name="dependsOnId"
						aria-label={$t('Add dependency')}
						onchange={(e) => {
							if (e.currentTarget.value) e.currentTarget.form?.requestSubmit();
						}}
					>
						<option value="">{$t('+ add')}</option>
						{#each tasks.filter((x) => !x.parentId && x.id !== task.id && !deps.some((d) => d!.id === x.id)) as opt (opt.id)}
							<option value={opt.id}>{opt.title}</option>
						{/each}
					</select>
				</form>
			{/if}
		</div>
	</div>

	<div class="section">
		<span class="label">{$t('Sub-tasks')}</span>
		{#each subs as s (s.id)}
			<div class="sub-row" class:is-done={cat(s.statusId) === 'done'}>
				<StatusSelect taskId={s.id} statusId={s.statusId} {statuses} canEdit={canEditTask(s)} />
				<span class="sub-title">{s.title}</span>
				{#if canEditTask(s)}
					<form method="POST" action="?/deleteTask" use:enhance>
						<input type="hidden" name="id" value={s.id} />
						<button class="x-btn" type="submit" aria-label={$t('Delete sub-task')}>×</button>
					</form>
				{/if}
			</div>
		{:else}
			<p class="u-tiny u-muted">{$t('none')}</p>
		{/each}
		{#if editable}
			<form method="POST" action="?/createTask" use:enhance class="sub-add">
				<input type="hidden" name="parentId" value={task.id} />
				<input
					name="title"
					class="input"
					placeholder={$t('Add a sub-task…')}
					required
					maxlength="240"
					autocomplete="off"
				/>
				<button class="btn btn--sm" type="submit">{$t('Add')}</button>
			</form>
		{/if}
	</div>
</aside>

<style>
	.panel {
		/* full content-pane height: from just under the sticky topbar to the
		   bottom of the viewport, flush right (59px matches the topbar, same
		   constant the mobile sidebar uses) */
		position: fixed;
		top: 59px;
		right: 0;
		bottom: 0;
		width: 400px;
		background: var(--color-bg);
		border-left: 1px solid var(--color-border-subtle);
		padding: var(--sp-3) var(--sp-3) var(--sp-4);
		overflow-y: auto;
		z-index: 8;
	}

	.panel-head {
		display: flex;
		align-items: center;
		gap: var(--sp-1);
		margin-bottom: var(--sp-2);
	}

	.title-input {
		font-size: 16px;
		font-weight: 600;
	}

	.grid2 {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--sp-2);
	}

	.section {
		border-top: 1px solid var(--color-border-subtle);
		padding-top: var(--sp-2);
		margin-top: var(--sp-2);
	}

	.chips-row {
		display: flex;
		align-items: center;
		gap: var(--sp-1);
		flex-wrap: wrap;
	}

	.chip {
		border: 1px solid var(--color-border-subtle);
		background: var(--color-bg);
		color: var(--color-muted);
		font-family: var(--font-mono);
		font-size: 11px;
		padding: 1px 8px;
		cursor: pointer;
		transition:
			background 0.15s ease,
			color 0.15s ease;
	}

	.chip:hover {
		border-color: var(--color-fg);
		color: var(--color-fg);
	}

	.chip--on {
		background: var(--color-fg);
		border-color: var(--color-fg);
		color: var(--color-bg);
	}

	.select--mini {
		width: auto;
		font-size: 12px;
		padding: 2px 4px;
	}

	.sub-row {
		display: flex;
		align-items: center;
		gap: var(--sp-1);
		padding: var(--sp-1) 0;
	}

	.sub-row.is-done .sub-title {
		text-decoration: line-through;
		color: var(--color-muted);
	}

	.sub-title {
		flex: 1;
		min-width: 0;
		font-size: 14px;
		overflow-wrap: anywhere;
	}

	.sub-add {
		display: flex;
		gap: var(--sp-1);
		margin-top: var(--sp-1);
	}

	.sub-add .input {
		flex: 1;
		padding: 6px 10px;
		font-size: 14px;
	}

	.x-btn {
		border: none;
		background: none;
		font-size: 18px;
		line-height: 1;
		cursor: pointer;
		color: var(--color-muted);
		padding: 2px 6px;
	}

	.x-btn:hover {
		color: var(--color-fg);
	}

	@media (max-width: 900px) {
		.panel {
			width: 100%;
		}
	}
</style>
