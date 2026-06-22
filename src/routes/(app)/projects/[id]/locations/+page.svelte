<script lang="ts">
	import { enhance } from '$app/forms';
	import Icon from '$lib/components/Icon.svelte';
	import { t } from '$lib/i18n';
	import type { ProjectSettingsData } from '../settings/+page.server';

	let { data, form }: { data: ProjectSettingsData; form?: { message?: string } | null } = $props();

	let editingLocation = $state<string | null>(null);
</script>

<svelte:head><title>{data.project.name} — {$t('Locations')} — Baskets</title></svelte:head>

<p class="u-tiny" style="margin-bottom: var(--sp-2);">
	<a href="/projects/{data.project.id}" class="u-flex" style="gap: 4px;"><Icon name="arrow-left" size={12} /> {data.project.name}</a>
</p>
<h2 style="margin-bottom: var(--sp-4);">{$t('Locations')}</h2>

{#if form?.message}
	<div class="alert alert-error" role="alert">{form.message}</div>
{/if}

<div class="card section">
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
					<span class="u-tiny u-muted mono tabular-nums">{l.latitude}, {l.longitude}</span>
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
</style>
