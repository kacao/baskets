<script lang="ts">
	import { enhance } from '$app/forms';
	import Icon from '$lib/components/Icon.svelte';
	import { tooltip } from '$lib/tooltip';
	import { t } from '$lib/i18n';

	let { data, form } = $props();

	const dependsOn = $derived(data.allProjects.filter((p) => data.projectDependsOn.includes(p.id)));
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
	<a href="/projects/{data.project.id}" class="u-flex" style="gap: 4px;"
		><Icon name="arrow-left" size={12} /> {data.project.name}</a
	>
</p>

<h2 style="margin-bottom: var(--sp-4);">{$t('Project settings')}</h2>

{#if form?.message}
	<div class="alert alert-error" role="alert">{form.message}</div>
{/if}

<!-- General -->
<h4 id="general" class="section-title">{$t('General')}</h4>
<div class="card section">
	<form method="POST" action="?/updateProject" use:enhance>
		<div class="field">
			<input
				id="pname"
				name="name"
				class="input input--bare name-input"
				value={data.project.name}
				placeholder={$t('Project name')}
				required
			/>
		</div>
		<div class="field">
			<textarea
				id="pdesc"
				name="description"
				class="textarea input--bare"
				placeholder={$t('Add a description…')}
				rows="2">{data.project.description ?? ''}</textarea
			>
		</div>
		<div class="u-flex date-row" style="gap: var(--sp-4); margin-bottom: var(--sp-3);">
			<div class="field" style="margin: 0;">
				<label class="label" for="pstart">{$t('Start date')}</label>
				<input
					id="pstart"
					name="startDate"
					type="date"
					class="input"
					style="width: auto;"
					value={data.project.startDate
						? new Date(data.project.startDate).toISOString().slice(0, 10)
						: ''}
				/>
			</div>
			<div class="field" style="margin: 0;">
				<label class="label" for="pdue">{$t('Due date')}</label>
				<input
					id="pdue"
					name="dueDate"
					type="date"
					class="input"
					style="width: auto;"
					value={data.project.dueDate
						? new Date(data.project.dueDate).toISOString().slice(0, 10)
						: ''}
				/>
			</div>
		</div>
		<button class="btn btn-sm btn-primary" type="submit">{$t('Save')}</button>
	</form>
</div>

<!-- Dependencies -->
<h4 class="section-title">{$t('Depends on projects')}</h4>
<div class="card section">
	<div class="chips-row">
		{#each dependsOn as p (p.id)}
			<form method="POST" action="?/removeProjectDep" use:enhance>
				<input type="hidden" name="dependsOnId" value={p.id} />
				<button class="chip chip--on" type="submit" use:tooltip={$t('Remove dependency')}
					>{p.name} ×</button
				>
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

{#if data.perm.admin}
	<!-- Permissions -->
	<h4 class="section-title">{$t('Edit grants')}</h4>
	<div class="card section">
		{#each data.grants as g (g.id)}
			<div class="u-flex grant-row" style="margin-bottom: var(--sp-1);">
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
			<button class="btn btn-sm" type="submit">{$t('Grant')}</button>
		</form>
	</div>
{/if}

<!-- Import / Export -->
<h4 class="section-title">{$t('Import / Export')}</h4>
<div class="card section">
	<div class="u-flex" style="gap: var(--sp-2); flex-wrap: wrap; margin-bottom: var(--sp-3);">
		<a class="btn btn-sm" href="/api/projects/{data.project.id}/export?format=json">
			{$t('Export project (JSON)')}
		</a>
		<a class="btn btn-sm" href="/api/projects/{data.project.id}/export?format=csv">
			{$t('Export tasks (CSV)')}
		</a>
	</div>
	<form
		method="POST"
		action="?/importProject"
		enctype="multipart/form-data"
		use:enhance
		class="u-flex"
		style="gap: var(--sp-2); flex-wrap: wrap; align-items: center;"
	>
		<input
			type="file"
			name="file"
			accept="application/json,.json"
			required
			class="input"
			style="width: auto;"
		/>
		<button class="btn btn-sm btn-primary" type="submit">{$t('Import')}</button>
	</form>
	<p class="u-tiny u-muted" style="margin-top: var(--sp-2);">
		{$t(
			'Creates a new project in this workspace. Assignees, attachments, and people fields are not imported.'
		)}
	</p>
</div>

<!-- Danger -->
<h4 class="section-title">{$t('Danger zone')}</h4>
<div class="card section">
	<form
		method="POST"
		action="?/deleteProject"
		use:enhance={({ cancel }) => {
			if (!confirm($t('Delete this project and all its tasks?'))) cancel();
			return async ({ update }) => update();
		}}
	>
		<button class="btn btn-sm btn-error" type="submit">{$t('Delete project')}</button>
	</form>
</div>

<style>
	.section {
		max-width: 640px;
		margin-bottom: var(--sp-3);
	}

	.section :global(.btn-primary) {
		transition: transform var(--dur-fast) ease;
	}

	.section :global(.btn-primary:active) {
		transform: scale(0.96);
	}

	.section-title {
		max-width: 640px;
		margin: var(--sp-5) 0 var(--sp-2);
		font-size: 15px;
		font-weight: 600;
		color: var(--color-fg);
		scroll-margin-top: var(--sp-3);
	}

	/* first section title sits right under the page heading — less top gap */
	.section-title:first-of-type {
		margin-top: var(--sp-2);
	}

	.chips-row {
		display: flex;
		align-items: center;
		gap: var(--sp-1);
		flex-wrap: wrap;
		margin-bottom: var(--sp-2);
	}

	.input--bare {
		width: 100%;
		border: none;
		box-shadow: none;
		outline: none;
		background: transparent;
		padding-left: 0;
		padding-right: 0;
	}

	.name-input {
		font-size: 22px;
		font-weight: 600;
		line-height: 1.3;
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
			background var(--dur) ease,
			color var(--dur) ease;
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

	.x-btn {
		position: relative;
		border: none;
		background: none;
		font-size: 18px;
		line-height: 1;
		cursor: pointer;
		color: var(--color-muted);
		padding: 2px 6px;
		transition: color var(--dur-fast) ease;
	}

	.x-btn::before {
		content: '';
		position: absolute;
		inset: 50% 50% 50% 50%;
		width: 32px;
		height: 32px;
		transform: translate(-50%, -50%);
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
