<script lang="ts">
	import { enhance } from '$app/forms';
	import Icon from '$lib/components/Icon.svelte';
	import StatusEditor from '$lib/components/StatusEditor.svelte';
	import { t } from '$lib/i18n';

	let { data, form } = $props();

	const userName = (id: string) => data.users.find((u) => u.id === id)?.name ?? id;
	const grouped = $derived([
		...data.groups.map((g) => ({
			group: g as { id: string; name: string } | null,
			labels: data.labels.filter((l) => l.groupId === g.id)
		})),
		{ group: null, labels: data.labels.filter((l) => !l.groupId) }
	]);
</script>

<svelte:head><title>{data.workspace.name} — {$t('Settings')} — Baskets</title></svelte:head>

<p class="u-tiny" style="margin-bottom: var(--sp-2);">
	<a href="/workspaces" class="u-flex" style="gap: 4px;"><Icon name="arrow-left" size={12} /> {$t('Workspaces')}</a>
</p>

<h2 style="margin-bottom: var(--sp-4);">{$t('Workspace settings')}</h2>

{#if form?.message}
	<div class="alert alert-error" role="alert">{form.message}</div>
{/if}

<!-- General -->
<div class="card section">
	<h4 style="margin-bottom: var(--sp-2);">{$t('General')}</h4>
	<form method="POST" action="?/updateWorkspace" use:enhance>
		<div class="field">
			<label class="label" for="wname">{$t('Name')}</label>
			<input id="wname" name="name" class="input" value={data.workspace.name} required maxlength="120" />
		</div>
		<p class="u-tiny u-muted" style="margin-bottom: var(--sp-2);">
			{$t('Owner')}: {userName(data.workspace.ownerId)}
		</p>
		<button class="btn btn-sm btn-primary" type="submit">{$t('Save')}</button>
	</form>
</div>

<!-- Statuses -->
<div class="card section">
	<h4 style="margin-bottom: var(--sp-2);">{$t('Statuses')}</h4>
	<p class="u-small u-muted" style="margin-bottom: var(--sp-3);">
		{$t('The five default statuses are fixed. Statuses added here are available to every project in this workspace.')}
	</p>

	<StatusEditor categories={data.categories} inherited={data.defaults} statuses={data.customStatuses} />
</div>

<!-- Labels -->
<div class="card section">
	<h4 style="margin-bottom: var(--sp-2);">{$t('Labels')}</h4>
	<p class="u-small u-muted" style="margin-bottom: var(--sp-3);">
		{$t('Labels can be attached to projects and tasks in this workspace. A label may belong to a group, but doesn’t have to.')}
	</p>

	{#each grouped as section (section.group?.id ?? 'ungrouped')}
		<div style="margin-bottom: var(--sp-3);">
			<div class="u-between" style="margin-bottom: var(--sp-1);">
				<span class="label">{section.group?.name ?? $t('No group')}</span>
				{#if section.group}
					<form method="POST" action="?/deleteGroup" use:enhance>
						<input type="hidden" name="id" value={section.group.id} />
						<button class="btn btn-sm btn-error" type="submit">{$t('Delete group')}</button>
					</form>
				{/if}
			</div>
			{#each section.labels as l (l.id)}
				<div class="row">
					<span class="badge">{l.name}</span>
					<span class="u-tiny u-muted">{$t('{n} use(s)', { n: l.inUse })}</span>
					<span style="flex: 1;"></span>
					<form method="POST" action="?/deleteLabel" use:enhance>
						<input type="hidden" name="id" value={l.id} />
						<button class="btn btn-sm btn-error" type="submit">{$t('Delete')}</button>
					</form>
				</div>
			{:else}
				<p class="u-tiny u-muted">{$t('No labels.')}</p>
			{/each}
		</div>
	{/each}

	<form method="POST" action="?/createLabel" use:enhance class="u-flex" style="flex-wrap: wrap; margin-bottom: var(--sp-2);">
		<input name="name" class="input" style="flex: 1; min-width: 140px;" placeholder={$t('New label…')} required maxlength="40" />
		<select name="groupId" class="select" style="width: auto;">
			<option value="">{$t('no group')}</option>
			{#each data.groups as g (g.id)}
				<option value={g.id}>{g.name}</option>
			{/each}
		</select>
		<button class="btn btn-sm btn-primary" type="submit">{$t('Add')}</button>
	</form>
	<form method="POST" action="?/createGroup" use:enhance class="u-flex" style="flex-wrap: wrap;">
		<input name="name" class="input" style="flex: 1; min-width: 140px;" placeholder={$t('New group…')} required />
		<button class="btn btn-sm" type="submit">{$t('Add group')}</button>
	</form>
</div>

<!-- Projects -->
<div class="card section">
	<h4 style="margin-bottom: var(--sp-2);">{$t('Projects')}</h4>
	{#each data.projects as p (p.id)}
		<div class="row">
			<a href="/projects/{p.id}" class="u-small">{p.name}</a>
		</div>
	{:else}
		<p class="u-tiny u-muted">{$t('No projects in this workspace yet.')}</p>
	{/each}
</div>

{#if data.perm.admin || data.perm.owner}
	<!-- Grants -->
	<div class="card section">
		<h4 style="margin-bottom: var(--sp-2);">{$t('Edit grants')}</h4>
		<p class="u-small u-muted" style="margin-bottom: var(--sp-2);">
			{$t('Granted users can edit this workspace and the structure of every project in it.')}
		</p>
		{#each data.grants as g (g.id)}
			<div class="u-flex" style="margin-bottom: var(--sp-1);">
				<span class="u-small">{userName(g.userId)}</span>
				<span class="badge">{$t('workspace')}</span>
				<form method="POST" action="?/revokePermission" use:enhance>
					<input type="hidden" name="id" value={g.id} />
					<button class="x-btn" type="submit" aria-label={$t('Revoke')}>×</button>
				</form>
			</div>
		{:else}
			<p class="u-tiny u-muted" style="margin-bottom: var(--sp-1);">{$t('No grants yet.')}</p>
		{/each}
		<form method="POST" action="?/grantPermission" use:enhance class="u-flex" style="flex-wrap: wrap;">
			<select class="select" name="userId" required style="width: auto; flex: 1; min-width: 140px;">
				<option value="">{$t('user…')}</option>
				{#each data.users.filter((u) => u.id !== data.workspace.ownerId) as u (u.id)}
					<option value={u.id}>{u.name}</option>
				{/each}
			</select>
			<button class="btn btn-sm" type="submit">{$t('Grant')}</button>
		</form>
	</div>
{/if}

<!-- Danger -->
<div class="card section">
	<h4 style="margin-bottom: var(--sp-2);">{$t('Danger zone')}</h4>
	<p class="u-tiny u-muted" style="margin-bottom: var(--sp-2);">
		{$t('A workspace can only be deleted when it has no projects.')}
	</p>
	<form
		method="POST"
		action="?/deleteWorkspace"
		use:enhance={({ cancel }) => {
			if (!confirm($t('Delete this workspace?'))) cancel();
			return async ({ update }) => update();
		}}
	>
		<button class="btn btn-sm btn-error" type="submit" disabled={data.projects.length > 0}>
			{$t('Delete workspace')}
		</button>
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
</style>
