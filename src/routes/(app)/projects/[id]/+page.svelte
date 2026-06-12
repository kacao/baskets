<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { slide } from 'svelte/transition';
	import TableView from '$lib/components/views/TableView.svelte';
	import BoardView from '$lib/components/views/BoardView.svelte';
	import ListView from '$lib/components/views/ListView.svelte';
	import DashboardView from '$lib/components/views/DashboardView.svelte';
	import MapView from '$lib/components/views/MapView.svelte';
	import { t } from '$lib/i18n';

	let { data, form } = $props();

	let editingProject = $state(false);
	let editingView = $state(false);
	let addingView = $state(false);

	const requestedView = $derived(page.url.searchParams.get('view'));
	const activeView = $derived(
		data.views.find((v) => v.id === requestedView) ??
			data.views.find((v) => v.isDefault) ??
			data.views[0]
	);
	const viewConfig = $derived.by(() => {
		try {
			return JSON.parse(activeView?.config ?? '{}') as Record<string, unknown>;
		} catch {
			return {};
		}
	});
	const canEditActiveView = $derived(Boolean(activeView && data.perm.views[activeView.id]));

	// view edit form state (initialized when panel opens)
	let cfgColumns = $state<Record<string, boolean>>({});
	let cfgStatusIds = $state<string[]>([]);
	function openViewEditor() {
		cfgColumns = {
			priority: viewConfig.priority !== false,
			assignee: viewConfig.assignee !== false,
			due: viewConfig.due !== false,
			milestone: viewConfig.milestone !== false,
			labels: viewConfig.labels !== false
		};
		cfgStatusIds = Array.isArray(viewConfig.statusIds)
			? (viewConfig.statusIds as string[])
			: data.statuses.map((s) => s.id);
		editingView = true;
	}
	const builtConfig = $derived(
		JSON.stringify({
			...cfgColumns,
			statusIds:
				cfgStatusIds.length === data.statuses.length ? undefined : cfgStatusIds
		})
	);

	// Tasks are editable by every signed-in member; grants gate structure only
	function canEditTask(_t: { id: string; parentId: string | null }) {
		return Boolean(data.user);
	}

	const userName = (id: string | null) => data.users.find((u) => u.id === id)?.name ?? id;
	const grantLabel = (g: { resourceType: string; resourceId: string }) => {
		if (g.resourceType === 'project') return $t('project');
		if (g.resourceType === 'view')
			return $t('view: {name}', { name: data.views.find((v) => v.id === g.resourceId)?.name ?? g.resourceId });
		return $t('task: {name}', { name: data.tasks.find((t) => t.id === g.resourceId)?.title ?? g.resourceId });
	};

	const VIEW_TYPES = ['table', 'board', 'list', 'dashboard', 'map'] as const;
	const disabledViewTypes = $derived(
		VIEW_TYPES.filter((vt) => !data.views.some((v) => v.type === vt))
	);

	const projectLabels = $derived(
		data.labels.filter((l) => data.projectLabelIds.includes(l.id))
	);
	const dependsOn = $derived(
		data.allProjects.filter((p) => data.projectDependsOn.includes(p.id))
	);
</script>

<svelte:head><title>{data.project.name} — Baskets</title></svelte:head>

<p class="u-tiny" style="margin-bottom: var(--sp-2);">
	<a href="/projects">← {$t('Projects')}</a>
</p>

{#if editingProject && data.perm.project}
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
				<label class="label" for="pname">{$t('Name')}</label>
				<input id="pname" name="name" class="input" value={data.project.name} required />
			</div>
			<div class="field">
				<label class="label" for="pdesc">{$t('Description')}</label>
				<textarea id="pdesc" name="description" class="textarea" rows="2"
					>{data.project.description ?? ''}</textarea
				>
			</div>
			<div class="u-flex">
				<button class="btn btn--primary" type="submit">{$t('Save')}</button>
				<button class="btn" type="button" onclick={() => (editingProject = false)}>{$t('Cancel')}</button>
			</div>
		</form>

		<hr class="rule" />

		<!-- Eligible statuses -->
		<form method="POST" action="?/updateProjectStatuses" use:enhance>
			<span class="label">{$t('Eligible statuses')}</span>
			<div class="chips-row">
				{#each data.allStatuses as s (s.id)}
					<label class="chip-check">
						<input
							type="checkbox"
							name="statusIds"
							value={s.id}
							checked={data.statuses.some((x) => x.id === s.id)}
						/>
						{s.name}
					</label>
				{/each}
			</div>
			<button class="btn btn--sm" type="submit">{$t('Save statuses')}</button>
		</form>

		<hr class="rule" />

		<!-- Project labels -->
		<span class="label">{$t('Labels')}</span>
		<div class="chips-row">
			{#each data.labels as l (l.id)}
				{@const on = data.projectLabelIds.includes(l.id)}
				<form method="POST" action="?/toggleProjectLabel" use:enhance>
					<input type="hidden" name="labelId" value={l.id} />
					<button class="chip" class:chip--on={on} type="submit">{l.name}</button>
				</form>
			{:else}
				<span class="u-tiny u-muted">{$t('No labels yet — create them in Settings → Labels.')}</span>
			{/each}
		</div>

		<hr class="rule" />

		<!-- Project dependencies -->
		<span class="label">{$t('Depends on projects')}</span>
		<div class="chips-row">
			{#each dependsOn as p (p.id)}
				<form method="POST" action="?/removeProjectDep" use:enhance>
					<input type="hidden" name="dependsOnId" value={p.id} />
					<button class="chip chip--on" type="submit" title={$t('Remove dependency')}>{p.name} ×</button>
				</form>
			{:else}
				<span class="u-tiny u-muted">{$t('none')}</span>
			{/each}
			<form method="POST" action="?/addProjectDep" use:enhance>
				<select
					class="select select--mini"
					name="dependsOnId"
					onchange={(e) => {
						if (e.currentTarget.value) e.currentTarget.form?.requestSubmit();
					}}
				>
					<option value="">{$t('+ add')}</option>
					{#each data.allProjects.filter((p) => p.id !== data.project.id && !data.projectDependsOn.includes(p.id)) as p (p.id)}
						<option value={p.id}>{p.name}</option>
					{/each}
				</select>
			</form>
		</div>

		<hr class="rule" />

		<!-- Milestones -->
		<span class="label">{$t('Milestones')}</span>
		{#each data.milestones as m (m.id)}
			<div class="u-flex" style="margin-bottom: var(--sp-1);">
				<span class="u-small">◇ {m.name}</span>
				{#if m.targetDate}
					<span class="u-tiny u-muted mono">{new Date(m.targetDate).toISOString().slice(0, 10)}</span>
				{/if}
				<form method="POST" action="?/deleteMilestone" use:enhance>
					<input type="hidden" name="id" value={m.id} />
					<button class="x-btn" type="submit" aria-label={$t('Delete milestone')}>×</button>
				</form>
			</div>
		{/each}
		<form method="POST" action="?/createMilestone" use:enhance class="u-flex" style="flex-wrap: wrap;">
			<input name="name" class="input" style="flex: 1; min-width: 140px;" placeholder={$t('New milestone…')} required />
			<input name="targetDate" type="date" class="input" style="width: auto;" />
			<button class="btn btn--sm" type="submit">{$t('Add')}</button>
		</form>

		{#if data.perm.admin}
			<hr class="rule" />

			<!-- Permissions (admin) -->
			<span class="label">{$t('Edit grants')}</span>
			{#each data.grants as g (g.id)}
				<div class="u-flex" style="margin-bottom: var(--sp-1);">
					<span class="u-small">{userName(g.userId)}</span>
					<span class="badge">{grantLabel(g)}</span>
					<form method="POST" action="?/revokePermission" use:enhance>
						<input type="hidden" name="id" value={g.id} />
						<button class="x-btn" type="submit" aria-label={$t('Revoke')}>×</button>
					</form>
				</div>
			{:else}
				<p class="u-tiny u-muted" style="margin-bottom: var(--sp-1);">{$t('No grants yet.')}</p>
			{/each}
			<form method="POST" action="?/grantPermission" use:enhance class="grant-form">
				<select class="select" name="userId" required>
					<option value="">{$t('user…')}</option>
					{#each data.users as u (u.id)}
						<option value={u.id}>{u.name}</option>
					{/each}
				</select>
				<select class="select" name="resourceType" value="project">
					<option value="project">{$t('whole project')}</option>
					<option value="view">{$t('a view')}</option>
				</select>
				<select class="select" name="resourceId">
					<option value={data.project.id}>{$t('this project')}</option>
					{#each data.views as v (v.id)}
						<option value={v.id}>{$t('view: {name}', { name: v.name })}</option>
					{/each}
				</select>
				<button class="btn btn--sm" type="submit">{$t('Grant')}</button>
			</form>
			<p class="u-tiny u-muted">{$t('Pick the matching resource for the chosen scope.')}</p>
		{/if}
	</div>
{:else}
	<div class="u-between" style="margin-bottom: var(--sp-2); flex-wrap: wrap;">
		<h2 style="overflow-wrap: anywhere;">{data.project.name}</h2>
		{#if data.perm.project}
			<div class="u-flex">
				<button class="btn btn--sm" onclick={() => (editingProject = true)}>{$t('Edit')}</button>
				<form
					method="POST"
					action="?/deleteProject"
					use:enhance
					onsubmit={(e) => {
						if (!confirm($t('Delete this project and all its tasks?'))) e.preventDefault();
					}}
				>
					<button class="btn btn--sm btn--danger" type="submit">{$t('Delete')}</button>
				</form>
			</div>
		{/if}
	</div>
	{#if data.project.description}
		<p class="u-muted" style="margin-bottom: var(--sp-2); max-width: 65ch;">
			{data.project.description}
		</p>
	{/if}
	{#if projectLabels.length > 0 || dependsOn.length > 0}
		<div class="chips-row" style="margin-bottom: var(--sp-3);">
			{#each projectLabels as l (l.id)}
				<span class="badge">{l.name}</span>
			{/each}
			{#each dependsOn as p (p.id)}
				<a class="badge" href="/projects/{p.id}" style="text-decoration: none;">⛓ {p.name}</a>
			{/each}
		</div>
	{/if}
{/if}

{#if form?.message}
	<div class="alert alert--error" role="alert">{form.message}</div>
{/if}

<!-- View tabs -->
<div class="viewbar">
	{#each data.views as v (v.id)}
		<a
			class="view-tab"
			class:active={activeView?.id === v.id}
			href="?view={v.id}"
			data-sveltekit-noscroll
		>
			{v.name}
		</a>
	{/each}
	{#if data.perm.project && disabledViewTypes.length > 0}
		<div class="add-view">
			<button
				class="view-tab view-tab--ghost"
				aria-expanded={addingView}
				aria-label={$t('Enable a view')}
				onclick={() => (addingView = !addingView)}
			>
				+
			</button>
			{#if addingView}
				<div class="add-view-menu" transition:slide={{ duration: 120 }}>
					{#each disabledViewTypes as vt (vt)}
						<form
							method="POST"
							action="?/createView"
							use:enhance={() =>
								({ update }) => {
									addingView = false;
									update();
								}}
						>
							<input type="hidden" name="type" value={vt} />
							<button class="add-view-item" type="submit">
								{$t(vt[0].toUpperCase() + vt.slice(1))}
							</button>
						</form>
					{/each}
				</div>
			{/if}
		</div>
	{/if}
	{#if canEditActiveView}
		<span style="flex: 1;"></span>
		<button class="btn btn--sm" onclick={() => (editingView ? (editingView = false) : openViewEditor())}>
			{editingView ? $t('Done') : $t('Edit view')}
		</button>
	{/if}
</div>

{#if editingView && activeView && canEditActiveView}
	<div class="card" style="margin-bottom: var(--sp-3);" transition:slide={{ duration: 150 }}>
		<form
			method="POST"
			action="?/updateView"
			use:enhance={() =>
				({ update }) => {
					editingView = false;
					update();
				}}
		>
			<input type="hidden" name="id" value={activeView.id} />
			<input type="hidden" name="config" value={builtConfig} />
			<div class="edit-grid">
				<div class="field">
					<label class="label" for="vname">{$t('View name')}</label>
					<input id="vname" name="name" class="input" value={activeView.name} required />
				</div>
				<div class="field">
					<span class="label">{$t('Type')}</span>
					<span class="badge">{activeView.type}</span>
				</div>
			</div>

			{#if activeView.type === 'table'}
				<span class="label">{$t('Columns')}</span>
				<div class="chips-row">
					{#each Object.keys(cfgColumns) as key (key)}
						<label class="chip-check">
							<input type="checkbox" bind:checked={cfgColumns[key]} />
							{$t(key)}
						</label>
					{/each}
				</div>
				<span class="label">{$t('Statuses shown')}</span>
				<div class="chips-row">
					{#each data.statuses as s (s.id)}
						<label class="chip-check">
							<input type="checkbox" bind:group={cfgStatusIds} value={s.id} />
							{s.name}
						</label>
					{/each}
				</div>
			{/if}

			<div class="u-flex" style="margin-top: var(--sp-2);">
				<button class="btn btn--sm btn--primary" type="submit">{$t('Save view')}</button>
			</div>
		</form>
		{#if data.views.length > 1}
			<form
				method="POST"
				action="?/deleteView"
				use:enhance
				style="margin-top: var(--sp-2);"
				onsubmit={(e) => {
					if (!confirm($t('Delete this view?'))) e.preventDefault();
				}}
			>
				<input type="hidden" name="id" value={activeView.id} />
				<button class="btn btn--sm btn--danger" type="submit">{$t('Delete view')}</button>
			</form>
		{/if}
	</div>
{/if}

<!-- Add task (table + board) -->
{#if activeView && ['table', 'board', 'list'].includes(activeView.type)}
	<form method="POST" action="?/createTask" use:enhance class="add-task">
		<input
			name="title"
			class="input"
			placeholder={$t('Add a task…')}
			required
			maxlength="240"
			autocomplete="off"
		/>
		<select name="priority" class="select" style="width: auto;">
			<option value="none">{$t('— priority')}</option>
			<option value="low">{$t('Low')}</option>
			<option value="medium">{$t('Medium')}</option>
			<option value="high">{$t('High')}</option>
			<option value="urgent">{$t('Urgent')}</option>
		</select>
		<button class="btn btn--primary" type="submit">{$t('Add')}</button>
	</form>
{/if}

<!-- Active view -->
{#if activeView?.type === 'table'}
	<TableView
		tasks={data.tasks}
		users={data.users}
		statuses={data.statuses}
		milestones={data.milestones}
		labels={data.labels}
		taskLabels={data.taskLabels}
		taskDeps={data.taskDeps}
		config={viewConfig}
		{canEditTask}
	/>
{:else if activeView?.type === 'board'}
	<BoardView
		tasks={data.tasks}
		statuses={data.statuses}
		users={data.users}
		labels={data.labels}
		taskLabels={data.taskLabels}
		taskDeps={data.taskDeps}
		milestones={data.milestones}
		{canEditTask}
	/>
{:else if activeView?.type === 'list'}
	<ListView
		tasks={data.tasks}
		statuses={data.statuses}
		users={data.users}
		labels={data.labels}
		taskLabels={data.taskLabels}
		taskDeps={data.taskDeps}
		milestones={data.milestones}
		{canEditTask}
	/>
{:else if activeView?.type === 'dashboard'}
	<DashboardView tasks={data.tasks} statuses={data.statuses} milestones={data.milestones} />
{:else if activeView?.type === 'map'}
	<MapView tasks={data.tasks} />
{/if}

<style>
	.viewbar {
		display: flex;
		align-items: center;
		gap: var(--sp-1);
		border-bottom: 1px solid var(--color-border-subtle);
		margin-bottom: var(--sp-3);
		padding-bottom: 0;
		flex-wrap: wrap;
	}

	.view-tab {
		font-size: 14px;
		font-weight: 400;
		color: var(--color-muted);
		text-decoration: none;
		padding: var(--sp-1) var(--sp-2);
		border: none;
		background: none;
		cursor: pointer;
		border-bottom: 2px solid transparent;
		margin-bottom: -1px;
		transition: color 0.15s ease;
	}

	.view-tab:hover {
		color: var(--color-fg);
	}

	.view-tab.active {
		color: var(--color-fg);
		font-weight: 600;
		border-bottom-color: var(--color-fg);
	}

	.view-tab--ghost {
		font-family: var(--font-body);
		font-size: 15px;
	}

	.add-view {
		position: relative;
	}

	.add-view-menu {
		position: absolute;
		top: 100%;
		left: 0;
		z-index: 9;
		background: var(--color-bg);
		border: 1px solid var(--color-border-subtle);
		min-width: 140px;
	}

	.add-view-item {
		display: block;
		width: 100%;
		border: none;
		background: none;
		font-family: var(--font-body);
		font-size: 14px;
		color: var(--color-fg);
		text-align: left;
		padding: var(--sp-1) var(--sp-2);
		cursor: pointer;
		transition: background 0.15s ease;
	}

	.add-view-item:hover {
		background: var(--color-surface-muted);
	}

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

	.chip-check {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-size: 13px;
		border: 1px solid var(--color-border-subtle);
		padding: 2px 8px;
		cursor: pointer;
	}

	.select--mini {
		width: auto;
		font-size: 12px;
		padding: 2px 4px;
	}

	.rule {
		border: none;
		border-top: 1px solid var(--color-border-subtle);
		margin: var(--sp-3) 0;
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

	.grant-form {
		display: flex;
		gap: var(--sp-1);
		flex-wrap: wrap;
		margin-bottom: var(--sp-1);
	}

	.grant-form .select {
		width: auto;
		flex: 1;
		min-width: 120px;
	}
</style>
