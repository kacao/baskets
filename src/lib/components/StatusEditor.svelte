<script lang="ts">
	import { enhance } from '$app/forms';
	import Icon from '$lib/components/Icon.svelte';
	import EntityIcon from '$lib/components/EntityIcon.svelte';
	import IconPicker from '$lib/components/IconPicker.svelte';
	import Popover from '$lib/components/Popover.svelte';
	import { categoryLabel } from '$lib/statuses';
	import { t } from '$lib/i18n';

	type Editable = {
		id: string;
		name: string;
		description: string | null;
		category: string;
		color: string | null;
		icon: string | null;
		position: number;
		inUse: number;
	};
	type Inherited = {
		id: string;
		name: string;
		description?: string | null;
		category: string;
		color: string | null;
		icon: string | null;
	};

	let {
		categories,
		inherited = [],
		statuses
	}: {
		categories: readonly string[];
		inherited?: Inherited[];
		statuses: Editable[];
	} = $props();

	let editingId = $state<string | null>(null);
	let creatingCat = $state<string | null>(null);
	let newIcon = $state('');
	let createError = $state('');
	let editIcon = $state('');

	// Local mirror so drag can reorder optimistically; re-synced to the persisted
	// order whenever the server data (statuses prop) changes after an action.
	let items = $state<Editable[]>([]);
	$effect(() => {
		items = [...statuses];
	});

	let dragId = $state<string | null>(null);
	let reorderForm = $state<HTMLFormElement | null>(null);
	let reorderIds = $state('');

	const inheritedIn = (c: string) => inherited.filter((s) => s.category === c);
	const editableIn = (c: string) => items.filter((s) => s.category === c);

	function openCreate(c: string) {
		creatingCat = creatingCat === c ? null : c;
		editingId = null;
		newIcon = '';
		createError = '';
	}
	function openEdit(s: Editable) {
		editingId = s.id;
		creatingCat = null;
		editIcon = s.icon ?? '';
	}

	function onDragOver(e: DragEvent, overId: string, cat: string) {
		if (!dragId || dragId === overId) return;
		const drag = items.find((i) => i.id === dragId);
		if (!drag || drag.category !== cat) return; // reorder within a category only
		e.preventDefault();
		const without = items.filter((i) => i.id !== dragId);
		const idx = without.findIndex((i) => i.id === overId);
		without.splice(idx, 0, drag);
		items = without;
	}
	function commitOrder() {
		dragId = null;
		reorderIds = items.map((i) => i.id).join(',');
		reorderForm?.requestSubmit();
	}
</script>

{#snippet iconField(value: string, onPick: (v: string) => void)}
	<Popover ariaLabel={$t('Status icon')}>
		{#snippet trigger()}
			{#if value}<EntityIcon {value} size={16} />{:else}<Icon name="plus" size={14} />{/if}
		{/snippet}
		{#snippet panel(close)}
			<IconPicker
				{value}
				onSelect={(v) => {
					onPick(v);
					close();
				}}
				onRemove={() => {
					onPick('');
					close();
				}}
			/>
		{/snippet}
	</Popover>
	<input type="hidden" name="icon" {value} />
{/snippet}

<div class="status-editor">
	{#each categories as c (c)}
		{@const inh = inheritedIn(c)}
		{@const cust = editableIn(c)}
		<div class="cat">
			<div class="cat-head">
				<span class="cat-name">{categoryLabel(c)}</span>
				<button
					class="cat-add"
					type="button"
					aria-label={$t('Add a {category} status', { category: categoryLabel(c) })}
					title={$t('Add status')}
					onclick={() => openCreate(c)}
				>
					<Icon name="plus" size={14} />
				</button>
			</div>

			{#if creatingCat === c}
				<form
					class="srow srow--edit"
					method="POST"
					action="?/createStatus"
					use:enhance={() =>
						async ({ result, update }) => {
							if (result.type === 'success') {
								creatingCat = null;
								newIcon = '';
								createError = '';
							} else if (result.type === 'failure') {
								createError = String(result.data?.message ?? 'Could not create status');
							}
							await update({ reset: false });
						}}
				>
					<span class="drag drag--ghost"><Icon name="drag" size={14} /></span>
					<input type="hidden" name="category" value={c} />
					<input type="color" name="color" value="#71717a" class="color-in" aria-label={$t('Color')} />
					{@render iconField(newIcon, (v) => (newIcon = v))}
					<input name="name" class="input name-in" placeholder={$t('Name')} required maxlength="40" autocomplete="off" oninput={() => (createError = '')} />
					<input name="description" class="input desc-in" placeholder={$t('Description…')} maxlength="200" autocomplete="off" />
					<button class="btn btn-sm" type="button" onclick={() => (creatingCat = null)}>{$t('Cancel')}</button>
					<button class="btn btn-sm btn-primary" type="submit">{$t('Create')}</button>
				</form>
				{#if createError}
					<div class="create-error">{createError}</div>
				{/if}
			{/if}

			{#each inh as s (s.id)}
				<div class="srow srow--readonly">
					<span class="drag drag--none"></span>
					<span class="ic">
						{#if s.icon}<EntityIcon value={s.icon} size={16} />{:else}<span class="status-dot" style="--c: {s.color || 'var(--color-muted)'}" aria-hidden="true"></span>{/if}
					</span>
					<span class="name">{s.name}</span>
					{#if s.description}<span class="desc">{s.description}</span>{/if}
					<span class="spacer"></span>
					<span class="u-tiny u-muted def-tag">{$t('Default')}</span>
				</div>
			{/each}

			{#each cust as s (s.id)}
				{#if editingId === s.id}
					<form
						class="srow srow--edit"
						method="POST"
						action="?/updateStatus"
						use:enhance={() =>
							({ update }) => {
								editingId = null;
								update();
							}}
					>
						<span class="drag drag--ghost"><Icon name="drag" size={14} /></span>
						<input type="hidden" name="id" value={s.id} />
						<input type="color" name="color" value={s.color ?? '#71717a'} class="color-in" aria-label={$t('Color')} />
						{@render iconField(editIcon, (v) => (editIcon = v))}
						<input name="name" class="input name-in" value={s.name} required maxlength="40" autocomplete="off" />
						<input name="description" class="input desc-in" value={s.description ?? ''} placeholder={$t('Description…')} maxlength="200" autocomplete="off" />
						<select name="category" class="select cat-in" aria-label={$t('Category')}>
							{#each categories as opt (opt)}
								<option value={opt} selected={s.category === opt}>{categoryLabel(opt)}</option>
							{/each}
						</select>
						<button class="btn btn-sm" type="button" onclick={() => (editingId = null)}>{$t('Cancel')}</button>
						<button class="btn btn-sm btn-primary" type="submit">{$t('Save')}</button>
					</form>
				{:else}
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div
						class="srow"
						class:dragging={dragId === s.id}
						draggable="true"
						ondragstart={() => (dragId = s.id)}
						ondragover={(e) => onDragOver(e, s.id, c)}
						ondragend={() => (dragId = null)}
						ondrop={commitOrder}
					>
						<span class="drag" title={$t('Drag to reorder')}><Icon name="drag" size={14} /></span>
						<span class="ic">
							{#if s.icon}<EntityIcon value={s.icon} size={16} />{:else}<span class="status-dot" style="--c: {s.color || 'var(--color-muted)'}" aria-hidden="true"></span>{/if}
						</span>
						<button class="name name-btn" type="button" onclick={() => openEdit(s)}>{s.name}</button>
						{#if s.description}<span class="desc">{s.description}</span>{/if}
						<span class="spacer"></span>
						<span class="u-tiny u-muted use">{$t('{n} task(s)', { n: s.inUse })}</span>
						<button class="icon-btn" type="button" aria-label={$t('Edit')} onclick={() => openEdit(s)}>
							<Icon name="edit-pencil" size={14} />
						</button>
						<form method="POST" action="?/deleteStatus" use:enhance>
							<input type="hidden" name="id" value={s.id} />
							<button class="icon-btn icon-btn--danger" type="submit" aria-label={$t('Delete')} disabled={s.inUse > 0}>
								<Icon name="trash" size={14} />
							</button>
						</form>
					</div>
				{/if}
			{/each}
		</div>
	{/each}

	<form bind:this={reorderForm} method="POST" action="?/reorderStatus" use:enhance class="reorder-form">
		<input type="hidden" name="ids" bind:value={reorderIds} />
	</form>
</div>

<style>
	.status-editor {
		border: 1px solid var(--color-base-300);
		border-radius: var(--radius-box, 0.5rem);
		/* not `overflow: hidden` — it would clip the row icon-picker popovers.
		   round the first/last rows instead (below) to keep the corners clean. */
	}

	.create-error {
		color: var(--color-error);
		font-size: 12px;
		padding: 4px 10px 8px;
	}

	.status-editor > :first-child {
		border-top-left-radius: var(--radius-box, 0.5rem);
		border-top-right-radius: var(--radius-box, 0.5rem);
	}

	.status-editor > :last-child {
		border-bottom-left-radius: var(--radius-box, 0.5rem);
		border-bottom-right-radius: var(--radius-box, 0.5rem);
	}

	.cat-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		background: var(--color-surface-muted);
		padding: 6px 10px;
		border-top: 1px solid var(--color-border-subtle);
	}

	.cat:first-child .cat-head {
		border-top: none;
	}

	.cat-name {
		font-size: 12px;
		font-weight: 600;
		color: var(--color-muted);
	}

	.cat-add {
		display: inline-flex;
		align-items: center;
		border: none;
		background: none;
		color: var(--color-muted);
		cursor: pointer;
		padding: 2px;
		border-radius: var(--radius-field, 0.25rem);
		transition: color var(--dur-fast) ease, background var(--dur-fast) ease;
	}

	.cat-add:hover {
		color: var(--color-fg);
		background: var(--color-base-100);
	}

	.srow {
		display: flex;
		align-items: center;
		gap: var(--sp-2);
		padding: var(--sp-2) 10px;
		border-top: 1px solid var(--color-border-subtle);
	}

	/* the row directly under a header has the header's border instead */
	.cat-head + .srow {
		border-top: none;
	}

	.srow--edit {
		flex-wrap: wrap;
	}

	.srow.dragging {
		opacity: 0.4;
	}

	.drag {
		display: inline-flex;
		align-items: center;
		color: var(--color-muted);
		cursor: grab;
		flex: 0 0 auto;
		width: 16px;
	}

	.drag--none,
	.drag--ghost {
		visibility: hidden;
	}

	.ic {
		display: inline-flex;
		align-items: center;
		width: 18px;
		flex: 0 0 auto;
	}

	.status-dot {
		width: 10px;
		height: 10px;
		border-radius: 999px;
		background: var(--c);
	}

	.name {
		font-weight: 500;
		font-size: 14px;
	}

	.name-btn {
		border: none;
		background: none;
		color: var(--color-fg);
		text-align: left;
		cursor: pointer;
		padding: 0;
		font-family: inherit;
	}

	.name-btn:hover {
		text-decoration: underline;
		text-underline-offset: 3px;
	}

	.desc {
		font-size: 13px;
		color: var(--color-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		max-width: 40%;
	}

	.spacer {
		flex: 1;
	}

	.use,
	.def-tag {
		flex: 0 0 auto;
	}

	.color-in {
		width: 32px;
		height: 32px;
		padding: 2px;
		border: 1px solid var(--color-base-300);
		border-radius: var(--radius-field, 0.25rem);
		background: var(--color-base-100);
		cursor: pointer;
		flex: 0 0 auto;
	}

	.name-in {
		flex: 1;
		min-width: 120px;
	}

	.desc-in {
		flex: 2;
		min-width: 140px;
	}

	.cat-in {
		width: auto;
	}

	.icon-btn {
		display: inline-flex;
		align-items: center;
		border: none;
		background: none;
		color: var(--color-muted);
		cursor: pointer;
		padding: 4px;
		border-radius: var(--radius-field, 0.25rem);
		opacity: 0;
		transition: color var(--dur-fast) ease, background var(--dur-fast) ease, opacity var(--dur-fast) ease;
	}

	.srow:hover .icon-btn {
		opacity: 1;
	}

	.icon-btn:hover {
		color: var(--color-fg);
		background: var(--color-surface-muted);
	}

	.icon-btn--danger:hover {
		color: var(--color-error);
	}

	.icon-btn:disabled {
		opacity: 0.25;
		cursor: not-allowed;
	}

	.reorder-form {
		display: none;
	}
</style>
