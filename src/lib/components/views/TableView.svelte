<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { slide, fly } from 'svelte/transition';
	import StatusSelect from '$lib/components/StatusSelect.svelte';
	import PriorityBadge from '$lib/components/PriorityBadge.svelte';

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
		dueDate: Date | string | null;
	};
	type Status = { id: string; name: string; category: string };

	let {
		tasks,
		users,
		statuses,
		milestones,
		labels,
		taskLabels,
		taskDeps,
		config,
		canEditTask
	}: {
		tasks: Task[];
		users: { id: string; name: string }[];
		statuses: Status[];
		milestones: { id: string; name: string }[];
		labels: { id: string; name: string }[];
		taskLabels: { taskId: string; labelId: string }[];
		taskDeps: { taskId: string; dependsOnId: string }[];
		config: Record<string, unknown>;
		canEditTask: (t: Task) => boolean;
	} = $props();

	let filter = $state<string>('all');
	// ?task= deep-links a task open (used by board card clicks)
	const linkedTask = page.url.searchParams.get('task');
	let expanded = $state<Record<string, boolean>>(linkedTask ? { [linkedTask]: true } : {});
	let editing = $state<string | null>(null);

	const show = (key: string) => config[key] !== false; // columns default on
	const statusFilter = $derived(
		Array.isArray(config.statusIds) ? (config.statusIds as string[]) : null
	);

	const visibleStatuses = $derived(
		statusFilter ? statuses.filter((s) => statusFilter.includes(s.id)) : statuses
	);

	const topTasks = $derived(
		tasks
			.filter((t) => !t.parentId)
			.filter((t) => !statusFilter || statusFilter.includes(t.statusId))
			.filter((t) => filter === 'all' || t.statusId === filter)
	);

	const cat = (id: string) => statuses.find((s) => s.id === id)?.category ?? 'todo';
	const isDone = (t: Task) => cat(t.statusId) === 'done';
	const subsOf = (id: string) => tasks.filter((t) => t.parentId === id);
	const userName = (id: string | null) => users.find((u) => u.id === id)?.name ?? null;
	const milestoneName = (id: string | null) => milestones.find((m) => m.id === id)?.name ?? null;
	const labelsOf = (taskId: string) =>
		taskLabels.filter((l) => l.taskId === taskId).map((l) => labels.find((x) => x.id === l.labelId)).filter(Boolean);
	const depsOf = (taskId: string) =>
		taskDeps.filter((d) => d.taskId === taskId).map((d) => tasks.find((t) => t.id === d.dependsOnId)).filter(Boolean);

	function fmtDate(d: Date | string | null) {
		if (!d) return null;
		return new Date(d).toISOString().slice(0, 10);
	}
</script>

<!-- Status filter -->
<div class="filterbar" role="tablist" aria-label="Filter tasks">
	<button
		class="filter-btn"
		class:active={filter === 'all'}
		role="tab"
		aria-selected={filter === 'all'}
		onclick={() => (filter = 'all')}
	>
		All
	</button>
	{#each visibleStatuses as s (s.id)}
		<button
			class="filter-btn"
			class:active={filter === s.id}
			role="tab"
			aria-selected={filter === s.id}
			onclick={() => (filter = s.id)}
		>
			{s.name}
		</button>
	{/each}
</div>

{#if topTasks.length === 0}
	<div class="card" style="text-align: center;">
		<p class="u-muted">No tasks here.</p>
	</div>
{:else}
	<ul class="task-list">
		{#each topTasks as t, i (t.id)}
			{@const subs = subsOf(t.id)}
			{@const doneSubs = subs.filter((s) => isDone(s)).length}
			{@const editable = canEditTask(t)}
			{@const deps = depsOf(t.id)}
			<li class="task" transition:fly={{ y: 8, duration: 120, delay: i * 20 }}>
				<div class="task-row" class:is-done={isDone(t)}>
					<StatusSelect taskId={t.id} statusId={t.statusId} {statuses} canEdit={editable} />
					<button
						class="task-title"
						onclick={() => (expanded[t.id] = !expanded[t.id])}
						aria-expanded={expanded[t.id] ?? false}
					>
						<span class="title-text">{t.title}</span>
					</button>
					<div class="task-meta">
						{#if deps.length > 0}
							<span class="badge" title="Blocked by {deps.map((d) => d!.title).join(', ')}">
								⛓ {deps.length}
							</span>
						{/if}
						{#if show('priority')}
							<PriorityBadge priority={t.priority} />
						{/if}
						{#if show('labels')}
							{#each labelsOf(t.id) as l (l!.id)}
								<span class="badge">{l!.name}</span>
							{/each}
						{/if}
						{#if show('milestone') && milestoneName(t.milestoneId)}
							<span class="badge">◇ {milestoneName(t.milestoneId)}</span>
						{/if}
						{#if subs.length > 0}
							<span class="badge">{doneSubs}/{subs.length}</span>
						{/if}
						{#if show('assignee') && userName(t.assigneeId)}
							<span class="badge badge--inverted">{userName(t.assigneeId)}</span>
						{/if}
						{#if show('due') && t.dueDate}
							<span class="badge mono">{fmtDate(t.dueDate)}</span>
						{/if}
						<button
							class="expand-btn"
							onclick={() => (expanded[t.id] = !expanded[t.id])}
							aria-label="Toggle details"
						>
							{expanded[t.id] ? '−' : '+'}
						</button>
					</div>
				</div>

				{#if expanded[t.id]}
					<div class="task-detail" transition:slide={{ duration: 150 }}>
						{#if t.description}
							<p class="u-small" style="margin-bottom: var(--sp-3); white-space: pre-wrap;">
								{t.description}
							</p>
						{/if}

						{#if editing === t.id && editable}
							<form
								method="POST"
								action="?/updateTask"
								use:enhance={() =>
									({ update }) => {
										editing = null;
										update();
									}}
								class="edit-form"
							>
								<input type="hidden" name="id" value={t.id} />
								<div class="field">
									<label class="label" for="title-{t.id}">Title</label>
									<input id="title-{t.id}" name="title" class="input" value={t.title} required />
								</div>
								<div class="field">
									<label class="label" for="desc-{t.id}">Description</label>
									<textarea id="desc-{t.id}" name="description" class="textarea" rows="3"
										>{t.description ?? ''}</textarea
									>
								</div>
								<div class="edit-grid">
									<div class="field">
										<label class="label" for="prio-{t.id}">Priority</label>
										<select id="prio-{t.id}" name="priority" class="select">
											{#each ['none', 'low', 'medium', 'high', 'urgent'] as p (p)}
												<option value={p} selected={t.priority === p}>{p}</option>
											{/each}
										</select>
									</div>
									<div class="field">
										<label class="label" for="asg-{t.id}">Assignee</label>
										<select id="asg-{t.id}" name="assigneeId" class="select">
											<option value="">— unassigned</option>
											{#each users as u (u.id)}
												<option value={u.id} selected={t.assigneeId === u.id}>{u.name}</option>
											{/each}
										</select>
									</div>
									<div class="field">
										<label class="label" for="mst-{t.id}">Milestone</label>
										<select id="mst-{t.id}" name="milestoneId" class="select">
											<option value="">— none</option>
											{#each milestones as m (m.id)}
												<option value={m.id} selected={t.milestoneId === m.id}>{m.name}</option>
											{/each}
										</select>
									</div>
									<div class="field">
										<label class="label" for="due-{t.id}">Due date</label>
										<input
											id="due-{t.id}"
											name="dueDate"
											type="date"
											class="input"
											value={fmtDate(t.dueDate) ?? ''}
										/>
									</div>
									<div class="field">
										<label class="label" for="loc-{t.id}">Location (lat, lng)</label>
										<input
											id="loc-{t.id}"
											name="location"
											class="input mono"
											placeholder="52.37, 4.90"
											value={t.location ?? ''}
										/>
									</div>
								</div>
								<div class="u-flex">
									<button class="btn btn--sm btn--primary" type="submit">Save</button>
									<button class="btn btn--sm" type="button" onclick={() => (editing = null)}>
										Cancel
									</button>
								</div>
							</form>
						{:else if editable}
							<div class="u-flex" style="margin-bottom: var(--sp-3); flex-wrap: wrap;">
								<button class="btn btn--sm" onclick={() => (editing = t.id)}>Edit</button>
								<form
									method="POST"
									action="?/deleteTask"
									use:enhance
									onsubmit={(e) => {
										if (!confirm('Delete this task and its sub-tasks?')) e.preventDefault();
									}}
								>
									<input type="hidden" name="id" value={t.id} />
									<button class="btn btn--sm btn--danger" type="submit">Delete</button>
								</form>
							</div>
						{/if}

						{#if editable && labels.length > 0}
							<div class="chips-row">
								<span class="label" style="margin: 0;">Labels</span>
								{#each labels as l (l.id)}
									{@const active = labelsOf(t.id).some((x) => x!.id === l.id)}
									<form method="POST" action="?/toggleTaskLabel" use:enhance>
										<input type="hidden" name="taskId" value={t.id} />
										<input type="hidden" name="labelId" value={l.id} />
										<button class="chip" class:chip--on={active} type="submit">{l.name}</button>
									</form>
								{/each}
							</div>
						{/if}

						<!-- Dependencies (top-level: other top-level tasks) -->
						<div class="chips-row">
							<span class="label" style="margin: 0;">Blocked by</span>
							{#each deps as d (d!.id)}
								<form method="POST" action="?/removeTaskDep" use:enhance>
									<input type="hidden" name="taskId" value={t.id} />
									<input type="hidden" name="dependsOnId" value={d!.id} />
									<button class="chip chip--on" type="submit" title="Remove dependency">
										{d!.title} ×
									</button>
								</form>
							{:else}
								<span class="u-tiny u-muted">none</span>
							{/each}
							{#if editable}
								<form method="POST" action="?/addTaskDep" use:enhance class="u-flex">
									<input type="hidden" name="taskId" value={t.id} />
									<select
										class="select select--mini"
										name="dependsOnId"
										onchange={(e) => {
											if (e.currentTarget.value) e.currentTarget.form?.requestSubmit();
										}}
									>
										<option value="">+ add</option>
										{#each tasks.filter((x) => !x.parentId && x.id !== t.id && !deps.some((d) => d!.id === x.id)) as opt (opt.id)}
											<option value={opt.id}>{opt.title}</option>
										{/each}
									</select>
								</form>
							{/if}
						</div>

						<!-- Sub-tasks -->
						<div class="subtasks">
							<span class="label">Sub-tasks</span>
							{#each subs as s (s.id)}
								{@const subDeps = depsOf(s.id)}
								{@const subEditable = canEditTask(s)}
								<div class="sub-row" class:is-done={isDone(s)} transition:slide={{ duration: 120 }}>
									<StatusSelect taskId={s.id} statusId={s.statusId} {statuses} canEdit={subEditable} />
									<span class="sub-title title-text">{s.title}</span>
									{#each subDeps as d (d!.id)}
										<form method="POST" action="?/removeTaskDep" use:enhance>
											<input type="hidden" name="taskId" value={s.id} />
											<input type="hidden" name="dependsOnId" value={d!.id} />
											<button class="chip chip--on" type="submit" title="Remove dependency">
												⛓ {d!.title} ×
											</button>
										</form>
									{/each}
									{#if subEditable && subs.length > 1}
										<form method="POST" action="?/addTaskDep" use:enhance>
											<input type="hidden" name="taskId" value={s.id} />
											<select
												class="select select--mini"
												name="dependsOnId"
												aria-label="Add dependency"
												onchange={(e) => {
													if (e.currentTarget.value) e.currentTarget.form?.requestSubmit();
												}}
											>
												<option value="">⛓+</option>
												{#each subs.filter((x) => x.id !== s.id && !subDeps.some((d) => d!.id === x.id)) as opt (opt.id)}
													<option value={opt.id}>{opt.title}</option>
												{/each}
											</select>
										</form>
									{/if}
									<PriorityBadge priority={s.priority} />
									{#if subEditable}
										<form method="POST" action="?/deleteTask" use:enhance>
											<input type="hidden" name="id" value={s.id} />
											<button class="x-btn" type="submit" aria-label="Delete sub-task">×</button>
										</form>
									{/if}
								</div>
							{/each}
							{#if editable}
								<form method="POST" action="?/createTask" use:enhance class="sub-add">
									<input type="hidden" name="parentId" value={t.id} />
									<input
										name="title"
										class="input"
										placeholder="Add a sub-task…"
										required
										maxlength="240"
										autocomplete="off"
									/>
									<button class="btn btn--sm" type="submit">Add</button>
								</form>
							{/if}
						</div>
					</div>
				{/if}
			</li>
		{/each}
	</ul>
{/if}

<style>
	.filterbar {
		display: flex;
		gap: var(--sp-1);
		margin-bottom: var(--sp-3);
		width: fit-content;
		max-width: 100%;
		overflow-x: auto;
	}

	.filter-btn {
		border: var(--border-width) solid var(--color-border-subtle);
		background: var(--color-bg);
		color: var(--color-muted);
		font-family: var(--font-body);
		font-size: 13px;
		font-weight: 500;
		padding: 4px 12px;
		cursor: pointer;
		white-space: nowrap;
		transition:
			background 0.15s ease,
			color 0.15s ease;
	}

	.filter-btn:hover {
		background: var(--color-surface-muted);
		color: var(--color-fg);
	}

	.filter-btn.active {
		background: var(--color-fg);
		border-color: var(--color-fg);
		color: var(--color-bg);
	}

	.task-list {
		list-style: none;
		padding: 0;
		border: var(--border-width) solid var(--color-border-subtle);
	}

	.task {
		border-bottom: var(--border-width) solid var(--color-border-subtle);
	}

	.task:last-child {
		border-bottom: none;
	}

	.task-row {
		display: flex;
		align-items: center;
		gap: var(--sp-2);
		padding: var(--sp-2) var(--sp-3);
	}

	.task-row.is-done .title-text,
	.sub-row.is-done .title-text {
		text-decoration: line-through;
		color: var(--color-muted);
	}

	.task-title {
		flex: 1;
		min-width: 0;
		border: none;
		background: none;
		font-family: var(--font-body);
		font-size: 16px;
		font-weight: 500;
		color: var(--color-fg);
		text-align: left;
		cursor: pointer;
		padding: 4px 0;
		overflow-wrap: anywhere;
	}

	.task-meta {
		display: flex;
		align-items: center;
		gap: var(--sp-1);
		flex-wrap: wrap;
		justify-content: flex-end;
	}

	.expand-btn {
		width: 24px;
		height: 24px;
		border: 1px solid var(--color-border-subtle);
		background: var(--color-bg);
		font-size: 14px;
		line-height: 1;
		cursor: pointer;
		transition: background 0.15s ease;
	}

	.expand-btn:hover {
		background: var(--color-surface-muted);
	}

	.task-detail {
		padding: var(--sp-3);
		border-top: 1px solid var(--color-border-subtle);
		background: var(--color-surface-muted);
	}

	.edit-form {
		margin-bottom: var(--sp-3);
	}

	.edit-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
		gap: var(--sp-2);
	}

	.chips-row {
		display: flex;
		align-items: center;
		gap: var(--sp-1);
		flex-wrap: wrap;
		margin-bottom: var(--sp-2);
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

	.subtasks {
		border-top: 1px solid var(--color-border-subtle);
		padding-top: var(--sp-2);
	}

	.sub-row {
		display: flex;
		align-items: center;
		gap: var(--sp-2);
		padding: var(--sp-1) 0;
		flex-wrap: wrap;
	}

	.sub-title {
		flex: 1;
		min-width: 120px;
		font-size: 14px;
		overflow-wrap: anywhere;
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
		color: var(--color-error);
	}

	.sub-add {
		display: flex;
		gap: var(--sp-2);
		margin-top: var(--sp-2);
	}

	.sub-add .input {
		flex: 1;
		padding: 6px 10px;
		font-size: 14px;
	}

	@media (max-width: 600px) {
		.task-row {
			flex-wrap: wrap;
		}

		.task-meta {
			width: 100%;
		}
	}
</style>
