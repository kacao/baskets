<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { invalidateAll } from '$app/navigation';
	import Icon from '$lib/components/Icon.svelte';
	import Popover from '$lib/components/Popover.svelte';
	import { sortable } from '$lib/sortable';
	import { tooltip } from '$lib/tooltip';
	import { confirmDialog } from '$lib/confirm.svelte';
	import { t } from '$lib/i18n';

	type Milestone = {
		id: string;
		name: string;
		description?: string | null;
		startDate?: Date | string | null;
		targetDate?: Date | string | null;
	};
	type Progress = { done: number; total: number; pct: number };

	let {
		milestones,
		progress = {},
		milestoneDeps = [],
		canEdit = true
	}: {
		milestones: Milestone[];
		progress?: Record<string, Progress>;
		milestoneDeps?: { milestoneId: string; dependsOnId: string }[];
		canEdit?: boolean;
	} = $props();

	const nameOf = (id: string) => milestones.find((m) => m.id === id)?.name ?? id;
	const depsOf = (id: string) =>
		milestoneDeps.filter((d) => d.milestoneId === id).map((d) => d.dependsOnId);
	const prog = (id: string): Progress => progress[id] ?? { done: 0, total: 0, pct: 0 };
	const iso = (d: Date | string | null | undefined) =>
		d ? new Date(d).toISOString().slice(0, 10) : '';

	// today as local yyyy-mm-dd for the overdue comparison
	const today = $derived(
		(() => {
			const d = new Date();
			return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
		})()
	);
	// overdue: a target date in the past and the milestone isn't fully done
	const isOverdue = (m: Milestone) => {
		const t = iso(m.targetDate);
		return Boolean(t) && t < today && prog(m.id).pct < 100;
	};

	let createOpen = $state(false);

	async function confirmDelete(e: MouseEvent) {
		const formEl = (e.currentTarget as HTMLElement).closest('form');
		if (
			await confirmDialog($t('Delete this milestone? Its tasks stay, but lose this milestone.'), {
				danger: true,
				confirmLabel: $t('Delete')
			})
		)
			formEl?.requestSubmit();
	}

	async function reorder(ids: string[]) {
		const fd = new FormData();
		fd.set('ids', ids.join(','));
		await fetch(`${page.url.pathname}?/reorderMilestone`, { method: 'POST', body: fd });
		await invalidateAll();
	}
</script>

<div
	class="ms-list"
	use:sortable={{ onReorder: reorder, handle: '[data-sortable-handle]', disabled: !canEdit }}
>
	{#each milestones as m (m.id)}
		{@const deps = depsOf(m.id)}
		{@const p = prog(m.id)}
		<div class="ms-card" data-sortable-id={m.id}>
			<div class="ms-head">
				{#if canEdit}
					<span class="ms-grip" data-sortable-handle use:tooltip={$t('Drag to reorder')}>
						<Icon name="drag" size={14} />
					</span>
				{/if}
				{#if canEdit}
					<form method="POST" action="?/updateMilestone" use:enhance class="ms-name-form">
						<input type="hidden" name="id" value={m.id} />
						<input
							class="ms-name"
							name="name"
							value={m.name}
							required
							aria-label={$t('Milestone name')}
							onblur={(e) =>
								e.currentTarget.value.trim() &&
								e.currentTarget.value !== m.name &&
								e.currentTarget.form?.requestSubmit()}
							onkeydown={(e) => e.key === 'Enter' && (e.preventDefault(), e.currentTarget.blur())}
						/>
					</form>
				{:else}
					<span class="ms-name ms-name--ro">{m.name}</span>
				{/if}
				{#if isOverdue(m)}
					<span class="ms-overdue" use:tooltip={$t('Past its target date')}>{$t('Overdue')}</span>
				{/if}
				{#if canEdit}
					<form method="POST" action="?/deleteMilestone" use:enhance>
						<input type="hidden" name="id" value={m.id} />
						<button
							class="ms-del"
							type="button"
							onclick={confirmDelete}
							aria-label={$t('Delete milestone')}
						>
							<Icon name="trash" size={14} />
						</button>
					</form>
				{/if}
			</div>

			<div class="ms-progress" use:tooltip={`${p.done}/${p.total} ${$t('done')}`}>
				<div class="ms-bar">
					<div
						class="ms-bar-fill"
						class:full={p.pct === 100}
						style={`transform: scaleX(${p.pct / 100})`}
					></div>
				</div>
				<span class="ms-prog-text">{p.done}/{p.total}</span>
			</div>

			{#if canEdit}
				<form
					method="POST"
					action="?/updateMilestone"
					use:enhance={() =>
						async ({ update }) =>
							update({ reset: false })}
					class="ms-desc-form"
				>
					<input type="hidden" name="id" value={m.id} />
					<textarea
						class="ms-desc"
						name="description"
						rows="1"
						placeholder={$t('Add a description…')}
						aria-label={$t('Description')}
						onblur={(e) =>
							(e.currentTarget.value ?? '') !== (m.description ?? '') &&
							e.currentTarget.form?.requestSubmit()}>{m.description ?? ''}</textarea
					>
				</form>
			{:else if m.description}
				<p class="ms-desc-ro">{m.description}</p>
			{/if}

			<div class="ms-meta">
				{#if canEdit}
					<form method="POST" action="?/updateMilestone" use:enhance class="ms-date-form">
						<input type="hidden" name="id" value={m.id} />
						<Icon name="play" size={13} />
						<input
							class="ms-date"
							type="date"
							name="startDate"
							value={iso(m.startDate)}
							aria-label={$t('Start date')}
							onchange={(e) => e.currentTarget.form?.requestSubmit()}
						/>
					</form>
					<form method="POST" action="?/updateMilestone" use:enhance class="ms-date-form">
						<input type="hidden" name="id" value={m.id} />
						<Icon name="calendar" size={13} />
						<input
							class="ms-date"
							type="date"
							name="targetDate"
							value={iso(m.targetDate)}
							aria-label={$t('Target date')}
							onchange={(e) => e.currentTarget.form?.requestSubmit()}
						/>
					</form>
				{:else}
					{#if m.startDate}<span class="ms-date-ro"
							><Icon name="play" size={13} /> {iso(m.startDate)}</span
						>{/if}
					{#if m.targetDate}<span class="ms-date-ro"
							><Icon name="calendar" size={13} /> {iso(m.targetDate)}</span
						>{/if}
				{/if}
			</div>

			{#if milestones.length > 1}
				<div class="ms-deps">
					<span class="u-tiny u-muted">{$t('Depends on')}</span>
					{#if canEdit}
						<Popover ariaLabel={$t('Dependencies')}>
							{#snippet trigger()}
								<span class="pill-val" class:pill-ph={deps.length === 0}>
									{deps.length ? deps.map(nameOf).join(', ') : $t('Nothing')}
								</span>
							{/snippet}
							{#snippet panel()}
								<form method="POST" action="?/setMilestoneDeps" use:enhance>
									<input type="hidden" name="milestoneId" value={m.id} />
									<button class="opt" class:opt--on={deps.length === 0} type="submit">
										<span class="opt-check"
											>{#if deps.length === 0}<Icon name="check" size={13} />{/if}</span
										>
										{$t('Nothing')}
									</button>
								</form>
								{#each milestones.filter((x) => x.id !== m.id) as opt (opt.id)}
									<form method="POST" action="?/setMilestoneDeps" use:enhance>
										<input type="hidden" name="milestoneId" value={m.id} />
										{#each deps.includes(opt.id) ? deps.filter((d) => d !== opt.id) : [...deps, opt.id] as id (id)}
											<input type="hidden" name="dependsOnId" value={id} />
										{/each}
										<button class="opt" class:opt--on={deps.includes(opt.id)} type="submit">
											<span class="opt-check"
												>{#if deps.includes(opt.id)}<Icon name="check" size={13} />{/if}</span
											>
											{opt.name}
										</button>
									</form>
								{/each}
							{/snippet}
						</Popover>
					{:else}
						<span class="pill-val" class:pill-ph={deps.length === 0}>
							{deps.length ? deps.map(nameOf).join(', ') : $t('Nothing')}
						</span>
					{/if}
				</div>
			{/if}
		</div>
	{:else}
		<div class="ms-empty">
			<Icon name="triangle-flag" size={20} />
			<p class="u-small u-muted">{$t('No milestones yet.')}</p>
		</div>
	{/each}
</div>

{#if canEdit}
	{#if createOpen || milestones.length === 0}
		<form
			method="POST"
			action="?/createMilestone"
			class="ms-new"
			use:enhance={() =>
				async ({ formElement, update }) => {
					await update({ reset: false });
					formElement.reset();
					createOpen = false;
				}}
		>
			<input
				name="name"
				class="input"
				placeholder={$t('Milestone name')}
				required
				autocomplete="off"
			/>
			<textarea
				name="description"
				class="input ms-new-desc"
				rows="2"
				placeholder={$t('Description (optional)')}></textarea>
			<div class="ms-new-dates">
				<span class="ms-date-pill"
					><Icon name="play" size={13} /><input
						name="startDate"
						type="date"
						class="ms-date"
						aria-label={$t('Start date')}
					/></span
				>
				<span class="ms-date-pill"
					><Icon name="calendar" size={13} /><input
						name="targetDate"
						type="date"
						class="ms-date"
						aria-label={$t('Target date')}
					/></span
				>
			</div>
			<div class="ms-new-actions">
				{#if milestones.length > 0}
					<button class="btn btn-sm" type="button" onclick={() => (createOpen = false)}
						>{$t('Cancel')}</button
					>
				{/if}
				<button class="btn btn-sm btn-primary" type="submit">{$t('Add milestone')}</button>
			</div>
		</form>
	{:else}
		<button class="ms-add-btn" type="button" onclick={() => (createOpen = true)}>
			<Icon name="plus" size={14} />
			{$t('Add milestone')}
		</button>
	{/if}
{/if}

<style>
	.ms-list {
		display: flex;
		flex-direction: column;
		gap: var(--sp-2);
	}

	.ms-card {
		display: flex;
		flex-direction: column;
		gap: var(--sp-2);
		padding: var(--sp-3);
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius, 8px);
		background: var(--color-base-100);
	}

	.ms-head {
		display: flex;
		align-items: center;
		gap: var(--sp-1);
	}

	.ms-grip {
		display: inline-flex;
		cursor: grab;
		color: var(--color-muted);
		flex: 0 0 auto;
	}
	.ms-grip:active {
		cursor: grabbing;
	}

	.ms-name-form {
		flex: 1;
		min-width: 0;
	}

	.ms-name {
		width: 100%;
		border: 1px solid transparent;
		background: none;
		font-size: 14px;
		font-weight: 600;
		padding: 2px 6px;
		border-radius: var(--radius-field, 4px);
		color: var(--color-fg);
	}
	.ms-name:hover {
		border-color: var(--color-border-subtle);
	}
	.ms-name:focus {
		border-color: var(--color-primary, var(--color-fg));
		background: var(--color-base-100);
	}
	.ms-name--ro {
		font-weight: 600;
	}

	.ms-overdue {
		flex: 0 0 auto;
		font-size: 10px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		color: var(--color-error, #dc2626);
		border: 1px solid color-mix(in oklab, var(--color-error, #dc2626) 40%, transparent);
		background: color-mix(in oklab, var(--color-error, #dc2626) 10%, transparent);
		padding: 1px 6px;
		border-radius: 999px;
	}

	.ms-del {
		flex: 0 0 auto;
		display: inline-flex;
		padding: 4px;
		border: none;
		background: none;
		color: var(--color-muted);
		cursor: pointer;
		border-radius: var(--radius-field, 4px);
	}
	.ms-del:hover {
		color: var(--color-error, #dc2626);
		background: color-mix(in oklab, var(--color-error, #dc2626) 10%, transparent);
	}

	.ms-progress {
		display: flex;
		align-items: center;
		gap: var(--sp-2);
	}
	.ms-bar {
		flex: 1;
		height: 6px;
		border-radius: 999px;
		background: var(--color-surface-muted);
		overflow: hidden;
	}
	.ms-bar-fill {
		height: 100%;
		width: 100%;
		transform-origin: left;
		background: var(--color-primary, var(--color-base-content));
		transition: transform var(--dur) ease;
	}
	.ms-bar-fill.full {
		background: var(--color-success, #16a34a);
	}
	.ms-prog-text {
		font-size: 11px;
		color: var(--color-muted);
		font-variant-numeric: tabular-nums;
		flex: 0 0 auto;
	}

	.ms-desc {
		width: 100%;
		border: 1px solid transparent;
		background: none;
		font-size: 12px;
		line-height: 1.4;
		color: var(--color-muted);
		padding: 4px 6px;
		border-radius: var(--radius-field, 4px);
		resize: vertical;
		field-sizing: content;
	}
	.ms-desc:hover {
		border-color: var(--color-border-subtle);
	}
	.ms-desc:focus {
		border-color: var(--color-primary, var(--color-fg));
		color: var(--color-fg);
	}
	.ms-desc-ro {
		font-size: 12px;
		color: var(--color-muted);
		margin: 0;
	}

	.ms-meta {
		display: flex;
		flex-wrap: wrap;
		gap: var(--sp-3);
	}
	.ms-date-form,
	.ms-date-ro {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		color: var(--color-muted);
		font-size: 12px;
	}
	.ms-date {
		border: none;
		background: none;
		color: var(--color-fg);
		font-size: 12px;
		font-variant-numeric: tabular-nums;
	}

	.ms-deps {
		display: flex;
		align-items: center;
		gap: var(--sp-2);
		flex-wrap: wrap;
	}
	.pill-val {
		font-size: 12px;
		color: var(--color-fg);
		border: 1px solid var(--color-border-subtle);
		border-radius: 999px;
		padding: 2px 8px;
		cursor: pointer;
	}
	.pill-ph {
		color: var(--color-muted);
	}
	/* The Depends-on trigger already renders a bordered .pill-val, so the Popover's
	   wrapping .pill button must not add a second, concentric pill border. Strip its
	   chrome (border none keeps it inert against the Popover .pill:hover border) so
	   the edit trigger matches the standalone read-only .pill-val. */
	.ms-deps :global(.pill) {
		border: none;
		background: none;
		padding: 0;
	}
	.opt {
		display: flex;
		align-items: center;
		gap: 6px;
		width: 100%;
		padding: 6px 8px;
		border: none;
		background: none;
		text-align: left;
		font-size: 13px;
		cursor: pointer;
		border-radius: var(--radius-field, 4px);
	}
	.opt:hover {
		background: var(--color-surface-muted);
	}
	.opt-check {
		display: inline-flex;
		width: 14px;
	}

	.ms-empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--sp-2);
		padding: var(--sp-5) var(--sp-3);
		color: var(--color-muted);
		text-align: center;
	}

	.ms-add-btn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		margin-top: var(--sp-2);
		padding: 6px 12px;
		border: 1px dashed var(--color-border-subtle);
		border-radius: var(--radius, 8px);
		background: none;
		color: var(--color-fg);
		font-size: 13px;
		cursor: pointer;
	}
	.ms-add-btn:hover {
		border-color: var(--color-primary, var(--color-fg));
		background: var(--color-surface-muted);
	}

	.ms-new {
		display: flex;
		flex-direction: column;
		gap: var(--sp-2);
		margin-top: var(--sp-2);
		padding: var(--sp-3);
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius, 8px);
	}
	.ms-new-desc {
		resize: vertical;
	}
	.ms-new-dates {
		display: flex;
		gap: var(--sp-2);
		flex-wrap: wrap;
	}
	.ms-date-pill {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 4px 8px;
		border: 1px solid var(--color-border-subtle);
		border-radius: 999px;
		color: var(--color-muted);
	}
	.ms-new-actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--sp-2);
	}
</style>
