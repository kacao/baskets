<script lang="ts">
	import Icon from '$lib/components/Icon.svelte';
	import MilestonesManager from '$lib/components/MilestonesManager.svelte';
	import { t } from '$lib/i18n';
	import type { ProjectSettingsData } from '../settings/+page.server';

	let { data, form }: { data: ProjectSettingsData; form?: { message?: string } | null } = $props();
</script>

<svelte:head><title>{data.project.name} — {$t('Milestones')} — Baskets</title></svelte:head>

<p class="u-tiny" style="margin-bottom: var(--sp-2);">
	<a href="/projects/{data.project.id}" class="u-flex" style="gap: 4px;"><Icon name="arrow-left" size={12} /> {data.project.name}</a>
</p>
<h2 style="margin-bottom: var(--sp-2);">{$t('Milestones')}</h2>
<p class="u-small u-muted" style="margin-bottom: var(--sp-4);">
	{$t('Group tasks into milestones, track their progress, set dates and dependencies, and drag to reorder.')}
</p>

{#if form?.message}
	<div class="alert alert-error" role="alert" style="margin-bottom: var(--sp-3);">{form.message}</div>
{/if}

<div class="section">
	<MilestonesManager
		milestones={data.milestones}
		progress={data.milestoneProgress}
		milestoneDeps={data.milestoneDeps}
	/>
</div>

<style>
	.section {
		max-width: 640px;
		margin-bottom: var(--sp-3);
	}
</style>
