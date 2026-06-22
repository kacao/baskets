<script lang="ts">
	import { enhance } from '$app/forms';
	import Icon from '$lib/components/Icon.svelte';
	import { t } from '$lib/i18n';
	import type { ProjectSettingsData } from '../settings/+page.server';

	let { data, form }: { data: ProjectSettingsData; form?: { message?: string } | null } = $props();
</script>

<svelte:head><title>{data.project.name} — {$t('Milestones')} — Baskets</title></svelte:head>

<p class="u-tiny" style="margin-bottom: var(--sp-2);">
	<a href="/projects/{data.project.id}" class="u-flex" style="gap: 4px;"><Icon name="arrow-left" size={12} /> {data.project.name}</a>
</p>
<h2 style="margin-bottom: var(--sp-4);">{$t('Milestones')}</h2>

{#if form?.message}
	<div class="alert alert-error" role="alert">{form.message}</div>
{/if}

<div class="card section">
	{#each data.milestones as m (m.id)}
		<div class="u-flex" style="margin-bottom: var(--sp-1);">
			<span class="u-small">{m.name}</span>
			{#if m.startDate}
				<span class="u-tiny u-muted mono tabular-nums">{new Date(m.startDate).toISOString().slice(0, 10)} →</span>
			{/if}
			{#if m.targetDate}
				<span class="u-tiny u-muted mono tabular-nums">{new Date(m.targetDate).toISOString().slice(0, 10)}</span>
			{/if}
			<form method="POST" action="?/deleteMilestone" use:enhance>
				<input type="hidden" name="id" value={m.id} />
				<button class="x-btn" type="submit" aria-label={$t('Delete milestone')}>×</button>
			</form>
		</div>
	{/each}
	<form method="POST" action="?/createMilestone" use:enhance class="u-flex" style="flex-wrap: wrap;">
		<input name="name" class="input" style="flex: 1; min-width: 140px;" placeholder={$t('New milestone…')} required />
		<input name="startDate" type="date" class="input" style="width: auto;" aria-label={$t('Start date')} />
		<input name="targetDate" type="date" class="input" style="width: auto;" aria-label={$t('Target date')} />
		<button class="btn btn-sm" type="submit">{$t('Add')}</button>
	</form>
</div>

<style>
	.section {
		max-width: 640px;
		margin-bottom: var(--sp-3);
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
</style>
