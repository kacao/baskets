<script lang="ts">
	import { enhance } from '$app/forms';
	import { slide, fly } from 'svelte/transition';
	import StatusButton from '$lib/components/StatusButton.svelte';
	import PriorityBadge from '$lib/components/PriorityBadge.svelte';

	let { data, form } = $props();

	let filter = $state<'all' | 'todo' | 'in_progress' | 'done'>('all');
	let expanded = $state<Record<string, boolean>>({});
	let editing = $state<string | null>(null);
	let editingProject = $state(false);

	const topTasks = $derived(
		data.tasks
			.filter((t) => !t.parentId)
			.filter((t) => filter === 'all' || t.status === filter)
	);

	function subsOf(id: string) {
		return data.tasks.filter((t) => t.parentId === id);
	}

	function userName(id: string | null) {
		if (!id) return null;
		return data.users.find((u) => u.id === id)?.name ?? null;
	}

	function fmtDate(d: Date | string | null) {
		if (!d) return null;
		return new Date(d).toISOString().slice(0, 10);
	}

	const filters = [
		{ key: 'all', label: 'All' },
		{ key: 'todo', label: 'To do' },
		{ key: 'in_progress', label: 'In progress' },
		{ key: 'done', label: 'Done' }
	] as const;
</script>

<svelte:head><title>{data.project.name} — Baskets</title></svelte:head>

<p class="u-tiny" style="margin-bottom: var(--sp-2);">
	<a href="/projects">← Projects</a>
</p>

{#if editingProject}
	<div class="card" style="margin-bottom: var(--sp-4);" transition:slide={{ duration: 150 }}>
		<form
			method="POST"
			action="?/updateProject"
			use:enhance={() =>
				({ update }) => {
					editingProject = false;
					update();
				}}
		>
			<div class="field">
				<label class="label" for="pname">Name</label>
				<input id="pname" name="name" class="input" value={data.project.name} required />
			</div>
			<div class="field">
				<label class="label" for="pdesc">Description</label>
				<textarea id="pdesc" name="description" class="textarea" rows="2"
					>{data.project.description ?? ''}</textarea
				>
			</div>
			<div class="u-flex">
				<button class="btn btn--primary" type="submit">Save</button>
				<button class="btn" type="button" onclick={() => (editingProject = false)}>Cancel</button>
			</div>
		</form>
	</div>
{:else}
	<div class="u-between" style="margin-bottom: var(--sp-2); flex-wrap: wrap;">
		<h2 style="overflow-wrap: anywhere;">{data.project.name}</h2>
		<div class="u-flex">
			<button class="btn btn--sm" onclick={() => (editingProject = true)}>Edit</button>
			<form
				method="POST"
				action="?/deleteProject"
				use:enhance
				onsubmit={(e) => {
					if (!confirm('Delete this project and all its tasks?')) e.preventDefault();
				}}
			>
				<button class="btn btn--sm btn--danger" type="submit">Delete</button>
			</form>
		</div>
	</div>
	{#if data.project.description}
		<p class="u-muted" style="margin-bottom: var(--sp-4); max-width: 65ch;">
			{data.project.description}
		</p>
	{/if}
{/if}

{#if form?.message}
	<div class="alert alert--error" role="alert">{form.message}</div>
{/if}

<!-- Add task -->
<form method="POST" action="?/createTask" use:enhance class="add-task">
	<input
		name="title"
		class="input"
		placeholder="Add a task…"
		required
		maxlength="240"
		autocomplete="off"
	/>
	<select name="priority" class="select" style="width: auto;">
		<option value="none">— priority</option>
		<option value="low">Low</option>
		<option value="medium">Medium</option>
		<option value="high">High</option>
		<option value="urgent">Urgent</option>
	</select>
	<button class="btn btn--primary" type="submit">Add</button>
</form>

<!-- Filters -->
<div class="filterbar" role="tablist" aria-label="Filter tasks">
	{#each filters as f (f.key)}
		<button
			class="filter-btn"
			class:active={filter === f.key}
			role="tab"
			aria-selected={filter === f.key}
			onclick={() => (filter = f.key)}
		>
			{f.label}
		</button>
	{/each}
</div>

<!-- Task list -->
{#if topTasks.length === 0}
	<div class="card" style="text-align: center;">
		<p class="u-muted">No tasks {filter === 'all' ? 'yet' : `in “${filter.replace('_', ' ')}”`}.</p>
	</div>
{:else}
	<ul class="task-list">
		{#each topTasks as t, i (t.id)}
			{@const subs = subsOf(t.id)}
			{@const doneSubs = subs.filter((s) => s.status === 'done').length}
			<li class="task" transition:fly={{ y: 8, duration: 120, delay: i * 20 }}>
				<div class="task-row" class:is-done={t.status === 'done'}>
					<StatusButton taskId={t.id} status={t.status} />
					<button
						class="task-title"
						onclick={() => (expanded[t.id] = !expanded[t.id])}
						aria-expanded={expanded[t.id] ?? false}
					>
						<span class="title-text">{t.title}</span>
					</button>
					<div class="task-meta">
						<PriorityBadge priority={t.priority} />
						{#if subs.length > 0}
							<span class="badge">{doneSubs}/{subs.length}</span>
						{/if}
						{#if userName(t.assigneeId)}
							<span class="badge badge--inverted">{userName(t.assigneeId)}</span>
						{/if}
						{#if t.dueDate}
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

						{#if editing === t.id}
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
											{#each data.users as u (u.id)}
												<option value={u.id} selected={t.assigneeId === u.id}>{u.name}</option>
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
								</div>
								<div class="u-flex">
									<button class="btn btn--sm btn--primary" type="submit">Save</button>
									<button class="btn btn--sm" type="button" onclick={() => (editing = null)}>
										Cancel
									</button>
								</div>
							</form>
						{:else}
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

						<!-- Sub-tasks -->
						<div class="subtasks">
							<span class="label">Sub-tasks</span>
							{#each subs as s (s.id)}
								<div class="sub-row" class:is-done={s.status === 'done'} transition:slide={{ duration: 120 }}>
									<StatusButton taskId={s.id} status={s.status} />
									<span class="sub-title title-text">{s.title}</span>
									<PriorityBadge priority={s.priority} />
									<form method="POST" action="?/deleteTask" use:enhance>
										<input type="hidden" name="id" value={s.id} />
										<button class="x-btn" type="submit" aria-label="Delete sub-task">×</button>
									</form>
								</div>
							{/each}
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
						</div>
					</div>
				{/if}
			</li>
		{/each}
	</ul>
{/if}

<style>
	.add-task {
		display: flex;
		gap: var(--sp-2);
		margin-bottom: var(--sp-3);
		flex-wrap: wrap;
	}

	.add-task .input {
		flex: 1;
		min-width: 200px;
	}

	.filterbar {
		display: flex;
		margin-bottom: var(--sp-3);
		border: var(--border-width) solid var(--color-fg);
		width: fit-content;
		max-width: 100%;
		overflow-x: auto;
	}

	.filter-btn {
		border: none;
		border-right: var(--border-width) solid var(--color-fg);
		background: var(--color-bg);
		color: var(--color-fg);
		font-family: var(--font-body);
		font-size: 12px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		padding: 6px 14px;
		cursor: pointer;
		white-space: nowrap;
	}

	.filter-btn:last-child {
		border-right: none;
	}

	.filter-btn:hover,
	.filter-btn.active {
		background: var(--color-fg);
		color: var(--color-bg);
	}

	.task-list {
		list-style: none;
		padding: 0;
		border: var(--border-width) solid var(--color-fg);
	}

	.task {
		border-bottom: var(--border-width) solid var(--color-fg);
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
		border: 2px solid var(--color-fg);
		background: var(--color-bg);
		font-size: 14px;
		line-height: 1;
		cursor: pointer;
	}

	.expand-btn:hover {
		background: var(--color-fg);
		color: var(--color-bg);
	}

	.task-detail {
		padding: var(--sp-3);
		border-top: 2px dashed var(--color-fg);
		background: #fafafa;
	}

	.edit-form {
		margin-bottom: var(--sp-3);
	}

	.edit-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
		gap: var(--sp-2);
	}

	.subtasks {
		border-top: 2px solid var(--color-fg);
		padding-top: var(--sp-2);
	}

	.sub-row {
		display: flex;
		align-items: center;
		gap: var(--sp-2);
		padding: var(--sp-1) 0;
	}

	.sub-title {
		flex: 1;
		min-width: 0;
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
		border-width: 2px;
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
