<script lang="ts">
	import { enhance } from '$app/forms';
	import { t } from '$lib/i18n';

	let { data, form } = $props();

	const grouped = $derived([
		...data.groups.map((g) => ({
			group: g as { id: string; name: string } | null,
			labels: data.labels.filter((l) => l.groupId === g.id)
		})),
		{ group: null, labels: data.labels.filter((l) => !l.groupId) }
	]);
</script>

<svelte:head><title>{$t('Labels')} — Baskets</title></svelte:head>

<h2 style="margin-bottom: var(--sp-2);">{$t('Labels')}</h2>
<p class="u-small u-muted" style="margin-bottom: var(--sp-4); max-width: 65ch;">
	{$t('Labels can be attached to projects and tasks. A label may belong to a group, but doesn’t have to.')}
</p>

{#if form?.message}
	<div class="alert alert--error" role="alert">{form.message}</div>
{/if}

{#each grouped as section (section.group?.id ?? 'ungrouped')}
	<div class="card" style="max-width: 640px; margin-bottom: var(--sp-3);">
		<div class="u-between" style="margin-bottom: var(--sp-2);">
			<h4>{section.group?.name ?? $t('No group')}</h4>
			{#if section.group}
				<form method="POST" action="?/deleteGroup" use:enhance>
					<input type="hidden" name="id" value={section.group.id} />
					<button class="btn btn--sm btn--danger" type="submit">{$t('Delete group')}</button>
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
					<button class="btn btn--sm btn--danger" type="submit">{$t('Delete')}</button>
				</form>
			</div>
		{:else}
			<p class="u-tiny u-muted">{$t('No labels.')}</p>
		{/each}
	</div>
{/each}

<div class="card" style="max-width: 640px; margin-bottom: var(--sp-3);">
	<h4 style="margin-bottom: var(--sp-2);">{$t('New label')}</h4>
	<form method="POST" action="?/createLabel" use:enhance class="u-flex" style="flex-wrap: wrap;">
		<input name="name" class="input" style="flex: 1; min-width: 160px;" placeholder={$t('Label name…')} required maxlength="40" />
		<select name="groupId" class="select" style="width: auto;">
			<option value="">{$t('no group')}</option>
			{#each data.groups as g (g.id)}
				<option value={g.id}>{g.name}</option>
			{/each}
		</select>
		<button class="btn btn--primary" type="submit">{$t('Add')}</button>
	</form>
</div>

<div class="card" style="max-width: 640px;">
	<h4 style="margin-bottom: var(--sp-2);">{$t('New group')}</h4>
	<form method="POST" action="?/createGroup" use:enhance class="u-flex" style="flex-wrap: wrap;">
		<input name="name" class="input" style="flex: 1; min-width: 160px;" placeholder={$t('Group name…')} required />
		<button class="btn btn--primary" type="submit">{$t('Add')}</button>
	</form>
</div>

<style>
	.row {
		display: flex;
		align-items: center;
		gap: var(--sp-2);
		padding: var(--sp-1) 0;
		border-bottom: 1px solid var(--color-border-subtle);
	}

	.row:last-child {
		border-bottom: none;
	}
</style>
