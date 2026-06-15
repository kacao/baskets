<script lang="ts">
	import { enhance } from '$app/forms';
	import SidePane from '$lib/components/SidePane.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { confirmDialog } from '$lib/confirm.svelte';
	import { t } from '$lib/i18n';

	// Lists task templates available to the project and lets the user instantiate
	// one (creating real tasks via ?/createFromTemplate) or delete it
	// (?/deleteTemplate). A separate "save as template" affordance lives on
	// TaskPanel; this pane is the instantiation surface, opened from the project
	// Create menu ("New from template"). Server actions on the project
	// +page.server.ts back the forms; invalidateAll runs through use:enhance's
	// default update().
	type Template = {
		id: string;
		name: string;
		scope: string;
		projectId: string | null;
		workspaceId: string | null;
		payload: string;
		createdAt: Date | string;
	};

	let {
		templates,
		onClose
	}: {
		templates: Template[];
		onClose: () => void;
	} = $props();

	// Best-effort summary of a template's payload for the list row.
	function summarize(payload: string): string {
		try {
			const p = JSON.parse(payload);
			const subs = Array.isArray(p?.subtasks) ? p.subtasks.length : 0;
			return subs === 1 ? $t('1 sub-task') : $t('{n} sub-tasks', { n: subs });
		} catch {
			return '';
		}
	}

	async function confirmDelete(e: SubmitEvent) {
		const ok = await confirmDialog($t('Delete this template?'), {
			confirmLabel: $t('Delete'),
			danger: true
		});
		if (!ok) e.preventDefault();
	}
</script>

<SidePane title={$t('New from template')} {onClose} ariaLabel={$t('Task templates')}>
	{#if templates.length === 0}
		<p class="u-small empty">
			{$t('No templates yet. Open a task and choose “Save as template” to create one.')}
		</p>
	{:else}
		<ul class="tpl-list">
			{#each templates as tpl (tpl.id)}
				<li class="tpl">
					<div class="tpl-main">
						<span class="tpl-name">{tpl.name}</span>
						<span class="tpl-meta">
							<span class="scope-tag">{tpl.scope === 'workspace' ? $t('Workspace') : $t('Project')}</span>
							{#if summarize(tpl.payload)}
								<span class="sub-count">{summarize(tpl.payload)}</span>
							{/if}
						</span>
					</div>
					<div class="tpl-actions">
						<form
							method="POST"
							action="?/createFromTemplate"
							use:enhance={() => async ({ update }) => {
								await update();
								onClose();
							}}
						>
							<input type="hidden" name="templateId" value={tpl.id} />
							<button class="btn btn-primary btn-sm" type="submit">
								<Icon name="plus" size={14} />
								{$t('Create')}
							</button>
						</form>
						<form
							method="POST"
							action="?/deleteTemplate"
							use:enhance={() => async ({ update }) => update()}
							onsubmit={confirmDelete}
						>
							<input type="hidden" name="templateId" value={tpl.id} />
							<button class="btn btn-ghost btn-sm" type="submit" aria-label={$t('Delete template')}>
								<Icon name="trash" size={14} />
							</button>
						</form>
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</SidePane>

<style>
	.empty {
		color: var(--color-muted);
		padding: var(--sp-2) 0;
	}

	.tpl-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: var(--sp-2);
	}

	.tpl {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--sp-2);
		padding: var(--sp-2);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
	}

	.tpl-main {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.tpl-name {
		font-weight: 600;
		overflow-wrap: anywhere;
	}

	.tpl-meta {
		display: inline-flex;
		align-items: center;
		gap: var(--sp-2);
		font-size: 0.8rem;
		color: var(--color-muted);
	}

	.scope-tag {
		text-transform: uppercase;
		letter-spacing: 0.04em;
		font-size: 0.7rem;
	}

	.tpl-actions {
		display: inline-flex;
		align-items: center;
		gap: var(--sp-1);
		flex-shrink: 0;
	}
</style>
