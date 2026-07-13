<script lang="ts">
	import { flip } from 'svelte/animate';
	import { page } from '$app/state';
	import { invalidateAll } from '$app/navigation';
	import { sortable } from '$lib/sortable';
	import { tooltip } from '$lib/tooltip';
	import Icon from '$lib/components/Icon.svelte';
	import CustomFieldEditor from '$lib/components/CustomFieldEditor.svelte';
	import CustomFieldValue from '$lib/components/CustomFieldValue.svelte';
	import { computeTaskRollup, formatNumber, isMulti, type RollupConfig } from '$lib/customFields';
	import { loadCollapsed, storeCollapsed } from '$lib/cfCollapse';
	import { t } from '$lib/i18n';
	import type { ProjectSettingsData } from '../settings/+page.server';

	// Project-entity rollup: aggregate a target field over all the project's tasks.
	function projectRollupText(field: {
		type: string;
		config: Record<string, unknown>;
	}): string | null {
		if (field.type !== 'rollup') return null;
		const cfg = { ...(field.config as unknown as RollupConfig), relation: 'task' };
		const valueOf = (tid: string, fid: string) => {
			const raw = data.rollupTaskValues.find((v) => v.taskId === tid && v.fieldId === fid)?.value;
			const n = raw == null ? null : Number(raw);
			return n != null && Number.isFinite(n) ? n : null;
		};
		const n = computeTaskRollup(cfg, '', { tasks: data.rollupTasks, taskDeps: [], valueOf });
		const target = data.customFields.find((f) => f.id === cfg.targetFieldId);
		return target && cfg.formula !== 'count' ? formatNumber(n, target.config) : String(n);
	}

	let { data, form }: { data: ProjectSettingsData; form?: { message?: string } | null } = $props();

	// Multi-value project fields default collapsed; state persists per project (ADR-045).
	let cfCollapsed = $state<Record<string, boolean>>({});
	$effect(() => {
		const scope = data.project.id;
		const next: Record<string, boolean> = {};
		for (const f of data.customFields)
			if (f.entity === 'project' && isMulti(f)) next[f.id] = loadCollapsed(scope, f.id, true);
		cfCollapsed = next;
	});
	function toggleCfCollapsed(fieldId: string) {
		const v = !cfCollapsed[fieldId];
		cfCollapsed[fieldId] = v;
		storeCollapsed(data.project.id, fieldId, v);
	}

	// --- "Show" bar: choose + order which project fields appear as header chips ---
	// Candidates = the project's own (entity='project') fields, incl. rollup (its chip
	// value is computed server-side). `project.chipFields` is the persisted ordered id list.
	type PField = (typeof data.customFields)[number];
	const chipCandidates = $derived(data.customFields.filter((f) => f.entity === 'project'));
	function parseChipFields(raw: string | null | undefined): string[] | null {
		if (raw == null) return null;
		try {
			const a = JSON.parse(raw);
			return Array.isArray(a) ? a.map(String) : null;
		} catch {
			return null;
		}
	}
	// local shown-order, synced from the server (source of truth). Unset = all candidates.
	let shown = $state<string[]>([]);
	$effect(() => {
		const order = parseChipFields(data.project.chipFields);
		const ids = chipCandidates.map((f) => f.id);
		shown = order ? order.filter((id) => ids.includes(id)) : ids;
	});
	const shownFields = $derived(
		shown
			.map((id) => chipCandidates.find((f) => f.id === id))
			.filter((f): f is PField => Boolean(f))
	);
	const availFields = $derived(chipCandidates.filter((f) => !shown.includes(f.id)));

	async function persist(next: string[]) {
		shown = next;
		const fd = new FormData();
		fd.set('fieldIds', next.join(','));
		await fetch(`${page.url.pathname}?/setProjectChipFields`, { method: 'POST', body: fd });
		await invalidateAll();
	}
	// Tap a field to move it between Available ↔ Show (works on every device); drag the
	// handle to reorder within Show (pointer-based sortable). No native HTML5 DnD.
	const addField = (id: string) => !shown.includes(id) && persist([...shown, id]);
	const removeField = (id: string) => persist(shown.filter((x) => x !== id));
</script>

<svelte:head><title>{data.project.name} — {$t('Custom fields')} — Baskets</title></svelte:head>

<p class="u-tiny" style="margin-bottom: var(--sp-2);">
	<a href="/projects/{data.project.id}" class="u-flex" style="gap: 4px;"
		><Icon name="arrow-left" size={12} /> {data.project.name}</a
	>
</p>
<h2 style="margin-bottom: var(--sp-4);">{$t('Custom fields')}</h2>

{#if form?.message}
	<div class="alert alert-error" role="alert">{form.message}</div>
{/if}

<div class="card section">
	<p class="u-small u-muted" style="margin-bottom: var(--sp-3);">
		{$t('Project-specific fields shown on every task. Type is fixed once a field is created.')}
	</p>
	<CustomFieldEditor
		fields={data.customFields}
		options={data.customFieldOptions}
		fieldTypes={data.fieldTypes}
	/>
</div>

{#if chipCandidates.length > 0}
	<!-- Project field values: the project's own (entity='project') custom fields -->
	<h4 class="section-title">{$t('Project fields')}</h4>
	<div class="card section">
		<p class="u-small u-muted" style="margin-bottom: var(--sp-3);">
			{$t('Values for this project’s own custom fields.')}
		</p>
		<div class="pfields">
			{#each chipCandidates as f (f.id)}
				<CustomFieldValue
					field={f}
					mode="pill"
					taskId={data.project.id}
					formAction="?/patchProjectCustomValues"
					rollupText={projectRollupText(f)}
					value={data.projectCustomValues.find((v) => v.fieldId === f.id)?.value ?? null}
					options={data.customFieldOptions.filter((o) => o.fieldId === f.id)}
					users={data.users}
					locations={data.locations}
					collapsible={isMulti(f)}
					collapsed={cfCollapsed[f.id] ?? false}
					onToggleCollapse={() => toggleCfCollapsed(f.id)}
				/>
			{/each}
		</div>

		{#if chipCandidates.length > 0}
			<hr class="rule" />
			<span class="label">{$t('Show on project page')}</span>
			<p class="u-tiny u-muted" style="margin-bottom: var(--sp-2);">
				{$t(
					'Tap a field to show or hide it on the project page; drag the handle to reorder. A field shows only when it has a value.'
				)}
			</p>
			<div
				class="dropzone show-bar"
				role="list"
				aria-label={$t('Shown fields')}
				use:sortable={{ onReorder: persist, axis: 'x', handle: '[data-sortable-handle]' }}
			>
				{#each shownFields as f (f.id)}
					<span
						class="chip-drag"
						role="listitem"
						data-sortable-id={f.id}
						animate:flip={{ duration: 150 }}
					>
						<span class="drag-handle" data-sortable-handle use:tooltip={$t('Drag to reorder')}
							><Icon name="drag" size={12} /></span
						>
						<span class="chip-name">{f.name}</span>
						<button
							class="chip-x"
							type="button"
							aria-label={$t('Hide {name}', { name: f.name })}
							onclick={() => removeField(f.id)}><Icon name="xmark" size={12} /></button
						>
					</span>
				{:else}
					<span class="zone-empty">{$t('Nothing shown — tap a field below')}</span>
				{/each}
			</div>

			<span class="label" style="margin-top: var(--sp-3);">{$t('Available')}</span>
			<div class="dropzone avail" role="group" aria-label={$t('Hidden fields')}>
				{#each availFields as f (f.id)}
					<button
						class="chip-add"
						type="button"
						animate:flip={{ duration: 150 }}
						onclick={() => addField(f.id)}
					>
						<Icon name="plus" size={12} />{f.name}
					</button>
				{:else}
					<span class="zone-empty">{$t('All fields shown')}</span>
				{/each}
			</div>
		{/if}
	</div>
{/if}

<style>
	.section {
		max-width: 640px;
		margin-bottom: var(--sp-3);
	}

	.section-title {
		max-width: 640px;
		margin: var(--sp-5) 0 var(--sp-2);
		font-size: 15px;
		font-weight: 600;
		color: var(--color-fg);
	}

	.pfields {
		display: flex;
		flex-direction: column;
		gap: var(--sp-2);
		align-items: flex-start;
	}

	.rule {
		border: none;
		border-top: 1px solid var(--color-border-subtle);
		margin: var(--sp-3) 0;
	}

	.dropzone {
		display: flex;
		flex-wrap: wrap;
		gap: var(--sp-1);
		min-height: 40px;
		padding: var(--sp-2);
		border: 1px dashed var(--color-border-subtle);
		border-radius: var(--radius, 8px);
	}

	.avail {
		border-style: solid;
	}

	.chip-drag {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 3px 4px 3px 3px;
		font-size: 12px;
		background: var(--color-base-100);
		border: 1px solid var(--color-border-subtle);
		border-radius: 999px;
		white-space: nowrap;
	}

	.chip-name {
		padding: 0 2px;
	}

	.drag-handle {
		display: inline-flex;
		cursor: grab;
		color: var(--color-muted);
	}

	.drag-handle:active {
		cursor: grabbing;
	}

	.chip-x {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 2px;
		border-radius: 999px;
		color: var(--color-muted);
		cursor: pointer;
	}

	.chip-x:hover {
		background: var(--color-surface-muted);
		color: var(--color-fg);
	}

	.chip-add {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 3px 9px 3px 6px;
		font-size: 12px;
		background: var(--color-base-100);
		border: 1px solid var(--color-border-subtle);
		border-radius: 999px;
		cursor: pointer;
		white-space: nowrap;
	}

	.chip-add:hover {
		border-color: var(--color-primary, var(--color-fg));
		background: var(--color-surface-muted);
	}

	.chip-add :global(svg) {
		color: var(--color-muted);
	}

	.zone-empty {
		font-size: 12px;
		color: var(--color-muted);
		align-self: center;
	}
</style>
