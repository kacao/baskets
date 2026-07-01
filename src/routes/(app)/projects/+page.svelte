<script lang="ts">
	import { enhance } from '$app/forms';
	import { fly } from 'svelte/transition';
	import EntityIcon from '$lib/components/EntityIcon.svelte';
	import { t } from '$lib/i18n';

	let { data, form } = $props();
	let showCreate = $state(false);
</script>

<svelte:head><title>{$t('Projects')} — Baskets</title></svelte:head>

<div class="u-between" style="margin-bottom: var(--sp-4); flex-wrap: wrap;">
	<h2>{$t('Projects')}</h2>
	<button class="btn btn-primary" onclick={() => (showCreate = !showCreate)}>
		{showCreate ? $t('Cancel') : $t('+ New project')}
	</button>
</div>

{#if form?.message}
	<div class="alert alert-error" role="alert">{form.message}</div>
{/if}

{#if showCreate}
	<div class="card" style="margin-bottom: var(--sp-4);" transition:fly={{ y: -8, duration: 150 }}>
		<form method="POST" action="?/create" use:enhance>
			<div class="field">
				<label class="label" for="name">{$t('Name')}</label>
				<input id="name" name="name" class="input" required maxlength="120" />
			</div>
			<div class="field">
				<label class="label" for="description">{$t('Description')}</label>
				<textarea id="description" name="description" class="textarea" rows="2"></textarea>
			</div>
			<div class="field">
				<label class="label" for="pworkspace">{$t('Workspace')}</label>
				<select id="pworkspace" name="workspaceId" class="select" required>
					{#each data.workspaces.filter((w) => w.creatable) as w (w.id)}
						<option value={w.id}>{w.name}</option>
					{/each}
				</select>
				{#if data.workspaces.every((w) => !w.creatable)}
					<p class="u-tiny u-muted" style="margin-top: var(--sp-1);">
						{$t('You can only create projects in workspaces you own or were granted — create one first.')}
						<a href="/workspaces">{$t('Workspaces')}</a>
					</p>
				{/if}
			</div>
			<button class="btn btn-primary create-btn" type="submit">{$t('Create project')}</button>
		</form>
	</div>
{/if}

{#if data.projects.length === 0}
	<div class="card" style="text-align: center; padding: var(--sp-6);">
		<h3 style="margin-bottom: var(--sp-2);">{$t('Nothing here')}</h3>
		<p class="u-muted">{$t('Create your first project to get started.')}</p>
	</div>
{:else}
	<div class="grid stagger-in">
		{#each data.projects as p (p.id)}
			<a href="/projects/{p.id}" class="project-card">
				<h4 class="project-name">
					{#if p.icon}<EntityIcon value={p.icon} size={18} /> {/if}{p.name}
				</h4>
				{#if p.description}
					<p class="u-small u-muted desc">{p.description}</p>
				{/if}
				<div class="meta">
					{#if data.workspaces.length > 1}
						{@const ws = data.workspaces.find((w) => w.id === p.workspaceId)}
						{#if ws}
							<span class="badge">{ws.name}</span>
						{/if}
					{/if}
					<span class="badge tabular-nums">{$t('{n} tasks', { n: p.taskCount })}</span>
					{#if p.taskCount > 0}
						<span class="badge tabular-nums" class:badge-success={p.doneCount === p.taskCount}>
							{$t('{done}/{total} done', { done: p.doneCount, total: p.taskCount })}
						</span>
					{/if}
				</div>
				{#if p.taskCount > 0}
					<div class="progress" aria-hidden="true">
						<div class="progress-fill" style="width: {(p.doneCount / p.taskCount) * 100}%"></div>
					</div>
				{/if}
			</a>
		{/each}
	</div>
{/if}

<style>
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
		gap: var(--sp-3);
	}

	.project-card {
		display: block;
		border: var(--border-width) solid var(--color-border-subtle);
		padding: var(--sp-3);
		color: var(--color-fg);
		text-decoration: none;
		transition: border-color var(--dur) ease;
		background: var(--color-bg);
	}

	.project-card:hover {
		border-color: var(--color-fg);
	}

	.project-name {
		margin-bottom: var(--sp-1);
		overflow-wrap: anywhere;
	}

	.desc {
		margin-bottom: var(--sp-2);
		text-wrap: pretty;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.meta {
		display: flex;
		gap: var(--sp-2);
		flex-wrap: wrap;
		margin-top: var(--sp-2);
	}

	.progress {
		margin-top: var(--sp-2);
		height: 4px;
		background: var(--color-surface-muted);
	}

	.progress-fill {
		height: 100%;
		background: var(--color-fg);
		transition: width var(--dur-slow) ease;
	}

	.create-btn {
		transition: transform var(--dur-fast);
	}

	.create-btn:active {
		transform: scale(0.96);
	}
</style>
