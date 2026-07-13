<script lang="ts">
	// Project Overview — a calm, document-like editor for the project title +
	// description. Title is a borderless input; description is a MentionEditor
	// (smaller font than the title). Both auto-save on blur via the shared
	// `updateProject` action. Read-only viewers see a heading + rendered RichText.
	import { enhance } from '$app/forms';
	import Icon from '$lib/components/Icon.svelte';
	import MentionEditor from '$lib/components/MentionEditor.svelte';
	import RichText from '$lib/components/RichText.svelte';
	import { t } from '$lib/i18n';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// Local drafts that resync when the server data changes (after save / realtime).
	let nameDraft = $state('');
	let descDraft = $state('');
	let syncedProjectId = '';
	$effect.pre(() => {
		// seed once per project — not on every data change, so a realtime invalidate
		// mid-edit can't clobber the user's in-progress title/description
		if (data.project.id !== syncedProjectId) {
			syncedProjectId = data.project.id;
			nameDraft = data.project.name;
			descDraft = data.project.description ?? '';
		}
	});
</script>

<svelte:head><title>{$t('Overview')}</title></svelte:head>

<div class="ov-page">
	<a href="/projects/{data.project.id}" class="ov-back u-flex">
		<Icon name="arrow-left" size={12} />
		{data.project.name}
	</a>

	{#if form?.message}
		<div class="alert alert-error">{form.message}</div>
	{/if}

	{#if data.perm.canEdit}
		<form
			method="POST"
			action="?/updateProject"
			use:enhance={() =>
				async ({ update }) =>
					update({ reset: false })}
		>
			<input
				class="ov-title"
				name="name"
				bind:value={nameDraft}
				placeholder={$t('Untitled project')}
				aria-label={$t('Project name')}
				onblur={(e) => e.currentTarget.form?.requestSubmit()}
			/>
			<MentionEditor
				name="description"
				bind:value={descDraft}
				class="ov-desc"
				rows={8}
				placeholder={$t('Add a description…')}
				ariaLabel={$t('Project description')}
				onblur={(e) => e.currentTarget.closest('form')?.requestSubmit()}
				projectId={data.project.id}
				canEditProject={data.perm.canEdit}
				tasks={data.tasks}
				locations={data.locations}
				files={data.files}
				projects={data.projects}
				people={data.people}
			/>
		</form>
	{:else}
		<h1 class="ov-title ov-title--ro">{data.project.name}</h1>
		{#if data.project.description}
			<RichText
				text={data.project.description}
				class="ov-rich"
				tasks={data.tasks}
				locations={data.locations}
				files={data.files}
				projects={data.projects}
				people={data.people}
			/>
		{:else}
			<p class="ov-empty">{$t('No description.')}</p>
		{/if}
	{/if}
</div>

<style>
	.ov-page {
		max-width: 720px;
		margin: 0 auto;
		padding: 40px 24px 96px;
		display: flex;
		flex-direction: column;
		gap: 20px;
	}

	.ov-back {
		gap: 4px;
		align-self: flex-start;
		color: var(--color-muted);
		font-size: 13px;
		text-decoration: none;
	}
	.ov-back:hover {
		color: var(--color-fg);
	}

	.alert {
		margin: 0;
	}

	/* Title: large, weighty, borderless — reads editable via a faint hover/focus bg. */
	.ov-title {
		width: 100%;
		font-size: 28px;
		font-weight: 600;
		line-height: 1.25;
		color: var(--color-fg);
		border: none;
		background: transparent;
		box-shadow: none;
		padding: 4px 6px;
		margin: 0;
		border-radius: 6px;
		transition: background var(--dur-fast, 120ms) ease;
	}
	.ov-title:hover,
	.ov-title:focus {
		background: var(--color-surface-muted);
	}
	.ov-title::placeholder {
		color: var(--color-muted);
		font-weight: 600;
	}
	.ov-title--ro {
		background: transparent;
	}

	/* Description: STRICTLY smaller than the title; borderless, document-like. */
	:global(.ov-desc) {
		width: 100%;
		min-height: 200px;
		font-size: 15px;
		line-height: 1.6;
		color: var(--color-fg);
		border: none;
		background: transparent;
		box-shadow: none;
		padding: 6px;
		margin: 0;
		border-radius: 6px;
		resize: vertical;
		transition: background var(--dur-fast, 120ms) ease;
	}
	:global(.ov-desc:hover),
	:global(.ov-desc:focus) {
		background: var(--color-surface-muted);
	}
	:global(.ov-desc::placeholder) {
		color: var(--color-muted);
	}

	:global(.ov-rich) {
		font-size: 15px;
		line-height: 1.6;
		color: var(--color-fg);
		padding: 6px;
	}

	.ov-empty {
		font-size: 15px;
		color: var(--color-muted);
		padding: 6px;
		margin: 0;
	}
</style>
