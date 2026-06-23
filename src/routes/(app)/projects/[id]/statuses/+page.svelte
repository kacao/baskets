<script lang="ts">
	import { enhance } from '$app/forms';
	import Icon from '$lib/components/Icon.svelte';
	import StatusEditor from '$lib/components/StatusEditor.svelte';
	import { t } from '$lib/i18n';
	import type { ProjectSettingsData } from '../settings/+page.server';

	let { data, form }: { data: ProjectSettingsData; form?: { message?: string } | null } = $props();
</script>

<svelte:head><title>{data.project.name} — {$t('Statuses')} — Baskets</title></svelte:head>

<p class="u-tiny" style="margin-bottom: var(--sp-2);">
	<a href="/projects/{data.project.id}" class="u-flex" style="gap: 4px;"><Icon name="arrow-left" size={12} /> {data.project.name}</a>
</p>
<h2 style="margin-bottom: var(--sp-4);">{$t('Statuses')}</h2>

{#if form?.message}
	<div class="alert alert-error" role="alert">{form.message}</div>
{/if}

<div class="card section">
	<p class="u-small u-muted" style="margin-bottom: var(--sp-3);">
		{$t('Pick which default and workspace statuses this project uses, and add statuses that only exist in this project.')}
	</p>

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

	.chips-row {
		display: flex;
		align-items: center;
		gap: var(--sp-1);
		flex-wrap: wrap;
		margin-bottom: var(--sp-2);
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

	.rule {
		border: none;
		border-top: 1px solid var(--color-border-subtle);
		margin: var(--sp-3) 0;
	}
</style>
