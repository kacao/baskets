<script lang="ts">
	import { enhance } from '$app/forms';
	import { t } from '$lib/i18n';

	let { data, form } = $props();

	let editingStatus = $state<string | null>(null);

	const dependsOn = $derived(
		data.allProjects.filter((p) => data.projectDependsOn.includes(p.id))
	);
	const userName = (id: string) => data.users.find((u) => u.id === id)?.name ?? id;
	const grantLabel = (g: { resourceType: string; resourceId: string }) => {
		if (g.resourceType === 'project') return $t('project');
		if (g.resourceType === 'view')
			return `${$t('view')}: ${data.views.find((v) => v.id === g.resourceId)?.name ?? g.resourceId}`;
		return `${$t('task')}: ${g.resourceId}`;
	};
</script>

<svelte:head><title>{data.project.name} — {$t('Settings')} — Baskets</title></svelte:head>

<p class="u-tiny" style="margin-bottom: var(--sp-2);">
	<a href="/projects/{data.project.id}">← {data.project.name}</a>
</p>

<h2 style="margin-bottom: var(--sp-4);">{$t('Project settings')}</h2>

{#if form?.message}
	<div class="alert alert--error" role="alert">{form.message}</div>
{/if}

<!-- General -->
<div class="card section">
	<h4 style="margin-bottom: var(--sp-2);">{$t('General')}</h4>
	<form method="POST" action="?/updateProject" use:enhance>
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
		<button class="btn btn--sm btn--primary" type="submit">{$t('Save')}</button>
	</form>
</div>

<!-- Statuses -->
<div class="card section">
	<h4 style="margin-bottom: var(--sp-2);">{$t('Statuses')}</h4>
	<p class="u-small u-muted" style="margin-bottom: var(--sp-3);">
		{$t('Pick which app-wide statuses this project uses, and add statuses that only exist in this project.')}
	</p>

	<form method="POST" action="?/updateProjectStatuses" use:enhance>
		<span class="label">{$t('Eligible statuses')}</span>
		<div class="chips-row">
			{#each [...data.globalStatuses, ...data.customStatuses] as s (s.id)}
				<label class="chip-check">
					<input
						type="checkbox"
						name="statusIds"
						value={s.id}
						checked={data.eligibleStatusIds.includes(s.id)}
					/>
					{s.name}
					{#if 'inUse' in s}
						<span class="u-tiny u-muted">({$t('project')})</span>
					{/if}
				</label>
			{/each}
		</div>
		<button class="btn btn--sm" type="submit">{$t('Save statuses')}</button>
	</form>

	<hr class="rule" />

	<span class="label">{$t('Project statuses')}</span>
	{#each data.customStatuses as s (s.id)}
		<div class="row">
			{#if editingStatus === s.id}
				<form
					method="POST"
					action="?/updateStatus"
					use:enhance={() =>
						({ update }) => {
							editingStatus = null;
							update();
						}}
					class="u-flex"
					style="flex: 1; flex-wrap: wrap;"
				>
					<input type="hidden" name="id" value={s.id} />
					<input name="name" class="input" value={s.name} style="flex: 1; min-width: 120px;" required maxlength="40" />
					<select name="category" class="select" style="width: auto;">
						{#each data.categories as c (c)}
							<option value={c} selected={s.category === c}>{$t(c)}</option>
						{/each}
					</select>
					<button class="btn btn--sm btn--primary" type="submit">{$t('Save')}</button>
					<button class="btn btn--sm" type="button" onclick={() => (editingStatus = null)}>
						{$t('Cancel')}
					</button>
				</form>
			{:else}
				<span class="name">{s.name}</span>
				<span class="badge">{$t(s.category)}</span>
				<span class="u-tiny u-muted">{$t('{n} task(s)', { n: s.inUse })}</span>
				<span style="flex: 1;"></span>
				<button class="btn btn--sm" onclick={() => (editingStatus = s.id)}>{$t('Edit')}</button>
				<form method="POST" action="?/deleteStatus" use:enhance>
					<input type="hidden" name="id" value={s.id} />
					<button class="btn btn--sm btn--danger" type="submit" disabled={s.inUse > 0}>
						{$t('Delete')}
					</button>
				</form>
			{/if}
		</div>
	{:else}
		<p class="u-tiny u-muted" style="margin-bottom: var(--sp-2);">{$t('No project statuses yet.')}</p>
	{/each}

	<form method="POST" action="?/createStatus" use:enhance class="u-flex" style="flex-wrap: wrap; margin-top: var(--sp-2);">
		<input name="name" class="input" style="flex: 1; min-width: 140px;" placeholder={$t('New status…')} required maxlength="40" />
		<select name="category" class="select" style="width: auto;">
			{#each data.categories as c (c)}
				<option value={c}>{$t(c)}</option>
			{/each}
		</select>
		<button class="btn btn--sm btn--primary" type="submit">{$t('Add')}</button>
	</form>
</div>

<!-- Labels -->
<div class="card section">
	<h4 style="margin-bottom: var(--sp-2);">{$t('Labels')}</h4>
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
</div>

<!-- Dependencies -->
<div class="card section">
	<h4 style="margin-bottom: var(--sp-2);">{$t('Depends on projects')}</h4>
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
</div>

<!-- Milestones -->
<div class="card section">
	<h4 style="margin-bottom: var(--sp-2);">{$t('Milestones')}</h4>
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
</div>

{#if data.perm.admin}
	<!-- Permissions -->
	<div class="card section">
		<h4 style="margin-bottom: var(--sp-2);">{$t('Edit grants')}</h4>
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
					<option value={v.id}>{$t('view')}: {v.name}</option>
				{/each}
			</select>
			<button class="btn btn--sm" type="submit">{$t('Grant')}</button>
		</form>
	</div>
{/if}

<!-- Danger -->
<div class="card section">
	<h4 style="margin-bottom: var(--sp-2);">{$t('Danger zone')}</h4>
	<form
		method="POST"
		action="?/deleteProject"
		use:enhance
		onsubmit={(e) => {
			if (!confirm($t('Delete this project and all its tasks?'))) e.preventDefault();
		}}
	>
		<button class="btn btn--sm btn--danger" type="submit">{$t('Delete project')}</button>
	</form>
</div>

<style>
	.section {
		max-width: 640px;
		margin-bottom: var(--sp-3);
	}

	.row {
		display: flex;
		align-items: center;
		gap: var(--sp-2);
		padding: var(--sp-1) 0;
		border-bottom: 1px solid var(--color-border-subtle);
	}

	.row:last-of-type {
		border-bottom: none;
	}

	.name {
		font-weight: 500;
	}

	.rule {
		border: none;
		border-top: 1px solid var(--color-border-subtle);
		margin: var(--sp-3) 0;
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
