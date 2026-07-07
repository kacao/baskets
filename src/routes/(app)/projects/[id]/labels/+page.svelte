<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import Icon from '$lib/components/Icon.svelte';
	import EntityIcon from '$lib/components/EntityIcon.svelte';
	import IconPicker from '$lib/components/IconPicker.svelte';
	import ColorPicker from '$lib/components/ColorPicker.svelte';
	import Popover from '$lib/components/Popover.svelte';
	import LabelChip from '$lib/components/LabelChip.svelte';
	import { t } from '$lib/i18n';
	import type { ProjectSettingsData } from '../settings/+page.server';

	let { data, form }: { data: ProjectSettingsData; form?: { message?: string } | null } = $props();

	let newProjLabelIcon = $state('');
	let newProjLabelColor = $state('#71717a');
	async function patchProjectLabel(id: string, field: 'color' | 'icon' | 'name', value: string) {
		const fd = new FormData();
		fd.set('id', id);
		fd.set(field, value);
		await fetch('?/updateProjectLabel', { method: 'POST', body: fd });
		await invalidateAll();
	}
</script>

<svelte:head><title>{data.project.name} — {$t('Labels')} — Baskets</title></svelte:head>

<p class="u-tiny" style="margin-bottom: var(--sp-2);">
	<a href="/projects/{data.project.id}" class="u-flex" style="gap: 4px;"><Icon name="arrow-left" size={12} /> {data.project.name}</a>
</p>
<h2 style="margin-bottom: var(--sp-4);">{$t('Labels')}</h2>

{#if form?.message}
	<div class="alert alert-error" role="alert">{form.message}</div>
{/if}

<div class="card section">
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
			<Popover ariaLabel={$t('Label color')}>
				{#snippet trigger()}
					<span class="cp-swatch" style="--c: {l.color ?? 'var(--color-border-subtle)'}" aria-hidden="true"></span>
				{/snippet}
				{#snippet panel(close)}
					<ColorPicker
						value={l.color ?? ''}
						onSelect={(v) => {
							patchProjectLabel(l.id, 'color', v);
							close();
						}}
						onRemove={() => {
							patchProjectLabel(l.id, 'color', '');
							close();
						}}
					/>
				{/snippet}
			</Popover>
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
			newProjLabelColor = '#71717a';
			await update();
		}}
		class="u-flex label-create"
		style="flex-wrap: wrap; margin-top: var(--sp-1);"
	>
		<input name="name" class="input name-in" style="width: 200px; max-width: 100%;" placeholder={$t('New project label…')} required maxlength="40" />
		<Popover ariaLabel={$t('Label color')}>
			{#snippet trigger()}
				<span class="cp-swatch" style="--c: {newProjLabelColor}" aria-hidden="true"></span>
			{/snippet}
			{#snippet panel(close)}
				<ColorPicker
					value={newProjLabelColor}
					onSelect={(v) => {
						newProjLabelColor = v;
						close();
					}}
				/>
			{/snippet}
		</Popover>
		<input type="hidden" name="color" value={newProjLabelColor} />
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

<style>
	.section {
		max-width: 640px;
		margin-bottom: var(--sp-3);
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

	.cp-swatch {
		display: block;
		width: 18px;
		height: 18px;
		border-radius: var(--radius-field, 0.25rem);
		background: var(--c, var(--color-muted));
		border: 1px solid color-mix(in oklab, var(--color-fg) 18%, transparent);
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

	@media (max-width: 720px) {
		.label-create .name-in,
		.label-create :global(.select),
		.label-create :global(.btn) {
			width: 100%;
		}

		.label-create :global(input[type='date']),
		.label-create :global(input[type='time']) {
			width: 100%;
		}
	}
</style>
