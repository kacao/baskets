<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import Popover from '$lib/components/Popover.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { confirmDialog } from '$lib/confirm.svelte';
	import { t as i18n } from '$lib/i18n';

	type SavedFilter = { id: string; name: string; config: string };

	// Saved filters dropdown (BASDEV-7). Lists the project's named filters; picking
	// one merges its stored config into the active view via `onApply` (the caller
	// posts to ?/updateView). Saving the current view config and deleting a filter
	// go through the createSavedFilter/deleteSavedFilter form actions.
	let {
		savedFilters = [],
		currentConfig = {},
		canEdit = false,
		onApply
	}: {
		savedFilters?: SavedFilter[];
		currentConfig?: Record<string, unknown>;
		canEdit?: boolean;
		onApply: (config: Record<string, unknown>) => void;
	} = $props();

	let newName = $state('');

	function parse(raw: string): Record<string, unknown> {
		try {
			const v = JSON.parse(raw);
			return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
		} catch {
			return {};
		}
	}

	function apply(f: SavedFilter, close: () => void) {
		onApply(parse(f.config));
		close();
	}

	async function confirmDelete(e: SubmitEvent) {
		const ok = await confirmDialog($i18n('Delete this saved filter?'), {
			confirmLabel: $i18n('Delete'),
			cancelLabel: $i18n('Cancel'),
			danger: true
		});
		if (!ok) e.preventDefault();
	}
</script>

<Popover ariaLabel={$i18n('Saved filters')} align="right">
	{#snippet trigger()}
		<Icon name="filter" size={14} />
		<span>{$i18n('Saved filters')}</span>
	{/snippet}
	{#snippet panel(close)}
		<div class="sf">
			{#if savedFilters.length === 0}
				<p class="sf-empty u-muted">{$i18n('No saved filters yet.')}</p>
			{:else}
				<ul class="sf-list">
					{#each savedFilters as f (f.id)}
						<li class="sf-item">
							<button class="sf-apply" type="button" onclick={() => apply(f, close)}>
								{f.name}
							</button>
							{#if canEdit}
								<form
									method="POST"
									action="?/deleteSavedFilter"
									use:enhance={() => async ({ update }) => update()}
									onsubmit={confirmDelete}
								>
									<input type="hidden" name="id" value={f.id} />
									<button class="sf-del" type="submit" aria-label={$i18n('Delete')} title={$i18n('Delete')}>
										<Icon name="trash" size={13} />
									</button>
								</form>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}

			{#if canEdit}
				<div class="sf-rule"></div>
				<form
					method="POST"
					action="?/createSavedFilter"
					class="sf-save"
					use:enhance={() =>
						async ({ result, update }) => {
							if (result.type === 'success') newName = '';
							await update();
						}}
				>
					<input type="hidden" name="config" value={JSON.stringify(currentConfig)} />
					<input
						class="input input-sm"
						name="name"
						placeholder={$i18n('Name this filter…')}
						bind:value={newName}
						maxlength="120"
						required
					/>
					<button class="btn btn-sm btn-primary" type="submit" disabled={!newName.trim()}>
						{$i18n('Save')}
					</button>
				</form>
			{/if}
		</div>
	{/snippet}
</Popover>

<style>
	.sf {
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-width: 200px;
	}

	.sf-empty {
		font-size: 12px;
		padding: 6px 8px;
	}

	.sf-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.sf-item {
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.sf-apply {
		flex: 1 1 auto;
		text-align: left;
		border: none;
		background: none;
		color: var(--color-fg);
		font-family: var(--font-body);
		font-size: 13px;
		padding: 6px 8px;
		border-radius: var(--radius-field, 0.25rem);
		cursor: pointer;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		transition: background var(--dur-fast) ease;
	}

	.sf-apply:hover {
		background: var(--color-surface-muted);
	}

	.sf-del {
		flex: 0 0 auto;
		display: inline-flex;
		align-items: center;
		border: none;
		background: none;
		color: var(--color-muted);
		cursor: pointer;
		padding: 6px;
		border-radius: var(--radius-field, 0.25rem);
		transition: color var(--dur-fast) ease, background var(--dur-fast) ease;
	}

	.sf-del:hover {
		color: var(--color-error, #dc2626);
		background: var(--color-surface-muted);
	}

	.sf-rule {
		border-top: 1px solid var(--color-border-subtle);
		margin: 2px 0;
	}

	.sf-save {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 4px;
	}

	.sf-save .input {
		flex: 1 1 auto;
		min-width: 0;
	}
</style>
