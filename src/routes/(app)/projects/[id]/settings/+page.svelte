<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import Icon from '$lib/components/Icon.svelte';
	import EntityIcon from '$lib/components/EntityIcon.svelte';
	import IconPicker from '$lib/components/IconPicker.svelte';
	import Popover from '$lib/components/Popover.svelte';
	import LabelChip from '$lib/components/LabelChip.svelte';
	import StatusEditor from '$lib/components/StatusEditor.svelte';
	import CustomFieldEditor from '$lib/components/CustomFieldEditor.svelte';
	import { t } from '$lib/i18n';

	let { data, form } = $props();

	let editingLocation = $state<string | null>(null);

	let newProjLabelIcon = $state('');
	async function patchProjectLabel(id: string, field: 'color' | 'icon' | 'name', value: string) {
		const fd = new FormData();
		fd.set('id', id);
		fd.set(field, value);
		await fetch('?/updateProjectLabel', { method: 'POST', body: fd });
		await invalidateAll();
	}

	const dependsOn = $derived(
		data.allProjects.filter((p) => data.projectDependsOn.includes(p.id))
	);
	const userName = (id: string) => data.users.find((u) => u.id === id)?.name ?? id;
	const numberFields = $derived(data.customFields.filter((f) => f.type === 'number'));
	const grantLabel = (g: { resourceType: string; resourceId: string }) => {
		if (g.resourceType === 'project') return $t('project');
		if (g.resourceType === 'view')
			return `${$t('view')}: ${data.views.find((v) => v.id === g.resourceId)?.name ?? g.resourceId}`;
		return `${$t('task')}: ${g.resourceId}`;
	};
</script>

<svelte:head><title>{data.project.name} — {$t('Settings')} — Baskets</title></svelte:head>

<p class="u-tiny" style="margin-bottom: var(--sp-2);">
	<a href="/projects/{data.project.id}" class="u-flex" style="gap: 4px;"><Icon name="arrow-left" size={12} /> {data.project.name}</a>
</p>

<h2 style="margin-bottom: var(--sp-4);">{$t('Project settings')}</h2>

{#if form?.message}
	<div class="alert alert-error" role="alert">{form.message}</div>
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
		<button class="btn btn-sm btn-primary" type="submit">{$t('Save')}</button>
	</form>
</div>

<!-- Statuses -->
<div class="card section">
	<h4 style="margin-bottom: var(--sp-2);">{$t('Statuses')}</h4>
	<p class="u-small u-muted" style="margin-bottom: var(--sp-3);">
		{$t('Pick which default and workspace statuses this project uses, and add statuses that only exist in this project.')}
	</p>

	<div class="u-flex" style="margin-bottom: var(--sp-3); gap: var(--sp-2);">
		<span class="label" style="margin: 0;">{$t('Status display')}</span>
		<form method="POST" action="?/setStatusDisplay" use:enhance>
			<select
				name="statusDisplay"
				class="select"
				style="width: auto;"
				onchange={(e) => e.currentTarget.form?.requestSubmit()}
			>
				<option value="text" selected={data.project.statusDisplay === 'text'}>{$t('Text only')}</option>
				<option value="icon" selected={data.project.statusDisplay === 'icon'}>{$t('Icon only')}</option>
				<option value="text-icon" selected={data.project.statusDisplay === 'text-icon'}>{$t('Text & icon')}</option>
			</select>
		</form>
	</div>

	<form method="POST" action="?/updateProjectStatuses" use:enhance>
		<span class="label">{$t('Eligible statuses')}</span>
		<div class="chips-row">
			{#each [...data.globalStatuses, ...data.workspaceStatuses, ...data.customStatuses] as s (s.id)}
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
					{:else if s.workspaceId}
						<span class="u-tiny u-muted">({$t('workspace')})</span>
					{/if}
				</label>
			{/each}
		</div>
		<button class="btn btn-sm" type="submit">{$t('Save statuses')}</button>
	</form>

	<hr class="rule" />

	<span class="label">{$t('Project statuses')}</span>
	<p class="u-tiny u-muted" style="margin-bottom: var(--sp-2);">
		{$t('Statuses that only exist in this project. Default and workspace statuses are shown for context and managed elsewhere.')}
	</p>
	<StatusEditor
		categories={data.categories}
		inherited={[...data.globalStatuses, ...data.workspaceStatuses]}
		statuses={data.customStatuses}
	/>
</div>

<!-- Custom fields -->
<div class="card section">
	<h4 style="margin-bottom: var(--sp-2);">{$t('Custom fields')}</h4>
	<p class="u-small u-muted" style="margin-bottom: var(--sp-3);">
		{$t('Project-specific fields shown on every task. Type is fixed once a field is created.')}
	</p>
	<CustomFieldEditor fields={data.customFields} options={data.customFieldOptions} fieldTypes={data.fieldTypes} />
</div>

<!-- Budget (BASDEV-10) -->
<div class="card section">
	<h4 style="margin-bottom: var(--sp-2);">{$t('Budget')}</h4>
	<p class="u-small u-muted" style="margin-bottom: var(--sp-3);">
		{$t('Choose which number fields hold estimated and actual cost. The Milestones pane rolls them up per milestone.')}
	</p>
	{#if numberFields.length}
		<form method="POST" action="?/setBudgetFields" use:enhance class="u-flex" style="flex-wrap: wrap; gap: var(--sp-3);">
			<div class="field" style="margin: 0;">
				<label class="label" for="estField">{$t('Estimated cost field')}</label>
				<select id="estField" name="estimatedCostFieldId" class="select" style="width: auto;">
					<option value="">{$t('none')}</option>
					{#each numberFields as f (f.id)}
						<option value={f.id} selected={data.project.estimatedCostFieldId === f.id}>{f.name}</option>
					{/each}
				</select>
			</div>
			<div class="field" style="margin: 0;">
				<label class="label" for="actField">{$t('Actual cost field')}</label>
				<select id="actField" name="actualCostFieldId" class="select" style="width: auto;">
					<option value="">{$t('none')}</option>
					{#each numberFields as f (f.id)}
						<option value={f.id} selected={data.project.actualCostFieldId === f.id}>{f.name}</option>
					{/each}
				</select>
			</div>
			<button class="btn btn-sm btn-primary" type="submit" style="align-self: flex-end;">{$t('Save')}</button>
		</form>
	{:else}
		<p class="u-tiny u-muted">{$t('Create a Number custom field first, then pick it here.')}</p>
	{/if}
</div>

<!-- Labels -->
<div class="card section">
	<h4 style="margin-bottom: var(--sp-2);">{$t('Labels')}</h4>
	<span class="label">{$t('Workspace labels')}</span>
	<div class="chips-row" style="margin-bottom: var(--sp-3);">
		{#each data.labels.filter((l) => l.workspaceId) as l (l.id)}
			{@const on = data.projectLabelIds.includes(l.id)}
			<form method="POST" action="?/toggleProjectLabel" use:enhance>
				<input type="hidden" name="labelId" value={l.id} />
				<button class="chip" class:chip--on={on} type="submit">{l.name}</button>
			</form>
		{:else}
			<span class="u-tiny u-muted">{$t('No workspace labels — create them in the workspace settings.')}</span>
		{/each}
	</div>

	<span class="label">{$t('Project labels')}</span>
	<p class="u-tiny u-muted" style="margin-bottom: var(--sp-1);">
		{$t('Labels owned by this project — always available to its tasks.')}
	</p>
	{#each data.projectScopedLabels as l (l.id)}
		<div class="lrow">
			<LabelChip label={l} />
			<span style="flex: 1;"></span>
			<input
				type="color"
				class="color-in"
				value={l.color ?? '#71717a'}
				aria-label={$t('Label color')}
				onchange={(e) => patchProjectLabel(l.id, 'color', e.currentTarget.value)}
			/>
			<Popover ariaLabel={$t('Label icon')}>
				{#snippet trigger()}
					{#if l.icon}<EntityIcon value={l.icon} size={16} />{:else}<Icon name="plus" size={14} />{/if}
				{/snippet}
				{#snippet panel(close)}
					<IconPicker
						value={l.icon ?? ''}
						onSelect={(v) => {
							patchProjectLabel(l.id, 'icon', v);
							close();
						}}
						onRemove={() => {
							patchProjectLabel(l.id, 'icon', '');
							close();
						}}
					/>
				{/snippet}
			</Popover>
			<form method="POST" action="?/deleteProjectLabel" use:enhance>
				<input type="hidden" name="id" value={l.id} />
				<button class="btn btn-sm btn-error" type="submit">{$t('Delete')}</button>
			</form>
		</div>
	{/each}
	<form
		method="POST"
		action="?/createProjectLabel"
		use:enhance={() => async ({ update }) => {
			newProjLabelIcon = '';
			await update();
		}}
		class="u-flex"
		style="flex-wrap: wrap; margin-top: var(--sp-1);"
	>
		<input name="name" class="input" style="flex: 1; min-width: 140px;" placeholder={$t('New project label…')} required maxlength="40" />
		<input type="color" name="color" class="color-in" value="#71717a" aria-label={$t('Label color')} />
		<Popover ariaLabel={$t('Label icon')}>
			{#snippet trigger()}
				{#if newProjLabelIcon}<EntityIcon value={newProjLabelIcon} size={16} />{:else}<Icon name="plus" size={14} />{/if}
			{/snippet}
			{#snippet panel(close)}
				<IconPicker
					value={newProjLabelIcon}
					onSelect={(v) => {
						newProjLabelIcon = v;
						close();
					}}
					onRemove={() => {
						newProjLabelIcon = '';
						close();
					}}
				/>
			{/snippet}
		</Popover>
		<input type="hidden" name="icon" value={newProjLabelIcon} />
		<button class="btn btn-sm btn-primary" type="submit">{$t('Add')}</button>
	</form>
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
			<span class="u-small">{m.name}</span>
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
		<button class="btn btn-sm" type="submit">{$t('Add')}</button>
	</form>
</div>

<!-- Locations -->
<div class="card section">
	<h4 style="margin-bottom: var(--sp-2);">{$t('Locations')}</h4>
	{#each data.locations as l (l.id)}
		<div class="row">
			{#if editingLocation === l.id}
				<form
					method="POST"
					action="?/updateLocation"
					use:enhance={() =>
						({ update }) => {
							editingLocation = null;
							update();
						}}
					class="u-flex"
					style="flex: 1; flex-wrap: wrap;"
				>
					<input type="hidden" name="id" value={l.id} />
					<input name="title" class="input" value={l.title} placeholder={$t('Title')} required style="flex: 1; min-width: 120px;" />
					<input name="address" class="input" value={l.address ?? ''} placeholder={$t('Address (optional)')} style="flex: 1; min-width: 120px;" />
					<input name="latitude" class="input mono" value={l.latitude ?? ''} placeholder={$t('Latitude')} style="width: 90px;" />
					<input name="longitude" class="input mono" value={l.longitude ?? ''} placeholder={$t('Longitude')} style="width: 90px;" />
					<button class="btn btn-sm btn-primary" type="submit">{$t('Save')}</button>
					<button class="btn btn-sm" type="button" onclick={() => (editingLocation = null)}>{$t('Cancel')}</button>
				</form>
			{:else}
				<span class="name">{l.title}</span>
				{#if l.address}<span class="u-tiny u-muted">{l.address}</span>{/if}
				{#if l.latitude != null && l.longitude != null}
					<span class="u-tiny u-muted mono">{l.latitude}, {l.longitude}</span>
				{/if}
				<span style="flex: 1;"></span>
				<button class="btn btn-sm" onclick={() => (editingLocation = l.id)}>{$t('Edit')}</button>
				<form method="POST" action="?/deleteLocation" use:enhance>
					<input type="hidden" name="id" value={l.id} />
					<button class="btn btn-sm btn-error" type="submit">{$t('Delete')}</button>
				</form>
			{/if}
		</div>
	{:else}
		<p class="u-tiny u-muted" style="margin-bottom: var(--sp-2);">{$t('No locations yet.')}</p>
	{/each}
	<form method="POST" action="?/createLocation" use:enhance class="u-flex" style="flex-wrap: wrap; margin-top: var(--sp-2);">
		<input name="title" class="input" style="flex: 1; min-width: 120px;" placeholder={$t('Location name…')} required />
		<input name="address" class="input" style="flex: 1; min-width: 120px;" placeholder={$t('Address (optional)')} />
		<input name="latitude" class="input mono" style="width: 90px;" placeholder={$t('Latitude')} />
		<input name="longitude" class="input mono" style="width: 90px;" placeholder={$t('Longitude')} />
		<button class="btn btn-sm" type="submit">{$t('Add')}</button>
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
			<button class="btn btn-sm" type="submit">{$t('Grant')}</button>
		</form>
	</div>
{/if}

<!-- Danger -->
<div class="card section">
	<h4 style="margin-bottom: var(--sp-2);">{$t('Danger zone')}</h4>
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

	.lrow {
		display: flex;
		align-items: center;
		gap: var(--sp-2);
		padding: var(--sp-1) 0;
		border-bottom: 1px solid var(--color-border-subtle);
	}

	.color-in {
		width: 28px;
		height: 24px;
		padding: 0;
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-field, 0.25rem);
		background: none;
		cursor: pointer;
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
