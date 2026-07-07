<script lang="ts">
	import { enhance } from '$app/forms';
	import { fly } from 'svelte/transition';
	import { t } from '$lib/i18n';

	let { data, form } = $props();
	let showCreate = $state(false);
</script>

<svelte:head><title>{$t('Workspaces')} — Baskets</title></svelte:head>

<div class="u-between" style="margin-bottom: var(--sp-4); flex-wrap: wrap;">
	<h2>{$t('Workspaces')}</h2>
	<button class="btn btn-primary" onclick={() => (showCreate = !showCreate)}>
		{showCreate ? $t('Cancel') : $t('+ New workspace')}
	</button>
</div>

<p class="u-small u-muted" style="margin-bottom: var(--sp-3); max-width: 65ch; text-wrap: pretty;">
	{$t('A workspace groups projects and owns their custom statuses and labels.')}
</p>

{#if form?.message}
	<div class="alert alert-error" role="alert">{form.message}</div>
{/if}

{#if showCreate}
	<div class="card" style="margin-bottom: var(--sp-4); max-width: 480px;" transition:fly={{ y: -8, duration: 150 }}>
		<form method="POST" action="?/create" use:enhance>
			<div class="field">
				<label class="label" for="wname">{$t('Name')}</label>
				<input id="wname" name="name" class="input" required maxlength="120" />
			</div>
			<button class="btn btn-primary" type="submit">{$t('Create workspace')}</button>
		</form>
	</div>
{/if}

<div class="card" style="max-width: 640px;">
	{#each data.workspaces as w (w.id)}
		<div class="row">
			<span class="name">{w.name}</span>
			<span class="u-tiny u-muted count">{$t('{n} project(s)', { n: w.projectCount })}</span>
			<span class="u-tiny u-muted owner">{$t('owner')}: {w.ownerName ?? w.ownerId}</span>
			<span style="flex: 1;"></span>
			{#if w.editable}
				<a class="btn btn-sm" href="/workspaces/{w.id}/settings">{$t('Settings')}</a>
			{/if}
		</div>
	{:else}
		<p class="u-tiny u-muted">{$t('No workspaces yet.')}</p>
	{/each}
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

	.name {
		font-weight: 500;
	}

	.count {
		font-variant-numeric: tabular-nums;
	}

	.btn-primary {
		transition: transform var(--dur-fast);
	}

	.btn-primary:active {
		transform: scale(0.96);
	}

	@media (max-width: 720px) {
		.row {
			flex-wrap: wrap;
		}

		.name {
			overflow-wrap: anywhere;
			min-width: 0;
		}
	}

	@media (max-width: 375px) {
		.owner {
			display: none;
		}
	}
</style>
