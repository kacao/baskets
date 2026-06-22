<script lang="ts">
	import Icon from '$lib/components/Icon.svelte';
	import CustomFieldEditor from '$lib/components/CustomFieldEditor.svelte';
	import CustomFieldValue from '$lib/components/CustomFieldValue.svelte';
	import { computeTaskRollup, formatNumber, type RollupConfig } from '$lib/customFields';
	import { t } from '$lib/i18n';
	import type { ProjectSettingsData } from '../settings/+page.server';

	// Project-entity rollup: aggregate a target field over all the project's tasks.
	function projectRollupText(field: { type: string; config: Record<string, unknown> }): string | null {
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
</script>

<svelte:head><title>{data.project.name} — {$t('Custom fields')} — Baskets</title></svelte:head>

<p class="u-tiny" style="margin-bottom: var(--sp-2);">
	<a href="/projects/{data.project.id}" class="u-flex" style="gap: 4px;"><Icon name="arrow-left" size={12} /> {data.project.name}</a>
</p>
<h2 style="margin-bottom: var(--sp-4);">{$t('Custom fields')}</h2>

{#if form?.message}
	<div class="alert alert-error" role="alert">{form.message}</div>
{/if}

<div class="card section">
	<p class="u-small u-muted" style="margin-bottom: var(--sp-3);">
		{$t('Project-specific fields shown on every task. Type is fixed once a field is created.')}
	</p>
	<CustomFieldEditor fields={data.customFields} options={data.customFieldOptions} fieldTypes={data.fieldTypes} />
</div>

{#if data.customFields.some((f) => f.entity === 'project')}
	<!-- Project field values: the project's own (entity='project') custom fields -->
	<h4 class="section-title">{$t('Project fields')}</h4>
	<div class="card section">
		<p class="u-small u-muted" style="margin-bottom: var(--sp-3);">
			{$t('Values for this project’s own custom fields.')}
		</p>
		<div class="pfields">
			{#each data.customFields.filter((f) => f.entity === 'project') as f (f.id)}
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
				/>
			{/each}
		</div>
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
</style>
