<script lang="ts">
	import { enhance } from '$app/forms';
	import Icon from '$lib/components/Icon.svelte';
	import EntityIcon from '$lib/components/EntityIcon.svelte';
	import IconPicker from '$lib/components/IconPicker.svelte';
	import Popover from '$lib/components/Popover.svelte';
	import { tooltip } from '$lib/tooltip';
	import { confirmDialog } from '$lib/confirm.svelte';
	import { t } from '$lib/i18n';
	import {
		fieldTypeLabel,
		defaultConfig,
		NUMBER_FORMATS,
		DATE_FORMATS,
		TIME_FORMATS,
		SELECT_DISPLAYS,
		APPLIES_TO,
		appliesToLabel,
		ROLLUP_RELATIONS,
		ROLLUP_FORMULAS,
		type FieldConfig
	} from '$lib/customFields';

	type Field = { id: string; name: string; type: string; config: FieldConfig; appliesTo: string; entity?: string; position: number; inUse: number };
	type Option = { id: string; fieldId: string; title: string; color: string | null; icon: string | null; position: number };

	let {
		fields,
		options,
		fieldTypes
	}: { fields: Field[]; options: Option[]; fieldTypes: readonly string[] } = $props();

	const NUMBER_FORMAT_LABELS: Record<string, string> = {
		number: 'Number',
		accounting: 'Accounting',
		financial: 'Financial',
		currency: 'Currency',
		custom: 'Custom format'
	};
	const DATE_FORMAT_LABELS: Record<string, string> = {
		full: 'Full date',
		short: 'Short date',
		mdy: 'Month/Day/Year',
		dmy: 'Day/Month/Year',
		ymd: 'Year/Month/Day',
		relative: 'Relative'
	};
	const TIME_FORMAT_LABELS: Record<string, string> = { hidden: 'Hidden', '12h': '12 hour', '24h': '24 hour' };
	const DISPLAY_LABELS: Record<string, string> = { text: 'Text only', icon: 'Icon only', 'text-icon': 'Text and icon' };

	// [Task | Project] tabs — task fields describe tasks, project fields describe
	// the project itself (entity column). The list + create form follow the tab.
	let entityTab = $state('task');

	let creating = $state(false);
	let newName = $state('');
	let newType = $state('text');
	let newAppliesTo = $state('all');
	let newConfig = $state<FieldConfig>(defaultConfig('text'));
	$effect(() => {
		// reset config sub-form whenever the chosen type changes
		const c = defaultConfig(newType);
		// project-entity rollups can only roll up over the project's tasks
		if (newType === 'rollup' && entityTab === 'project') c.relation = 'task';
		newConfig = c;
	});

	let editingId = $state<string | null>(null);
	let editName = $state('');
	let editAppliesTo = $state('all');
	let editConfig = $state<FieldConfig>({});

	// per-field option draft icons (keyed by fieldId) + the single option being edited
	let newOptIcon = $state<Record<string, string>>({});
	let editingOptId = $state<string | null>(null);
	let editOptIcon = $state('');

	const optionsFor = (fieldId: string) => options.filter((o) => o.fieldId === fieldId);

	function openCreate() {
		creating = !creating;
		editingId = null;
		newName = '';
		newType = 'text';
		newAppliesTo = 'all';
	}
	function openEdit(f: Field) {
		editingId = f.id;
		creating = false;
		editName = f.name;
		editAppliesTo = f.appliesTo ?? 'all';
		editConfig = { ...defaultConfig(f.type), ...f.config };
	}

	function typeHint(f: Field): string {
		const c = f.config ?? {};
		if (f.type === 'number') return $t(NUMBER_FORMAT_LABELS[(c.numberFormat as string) ?? 'number']);
		if (f.type === 'date') return $t(DATE_FORMAT_LABELS[(c.dateFormat as string) ?? 'full']);
		if (['select', 'person', 'place', 'files', 'task'].includes(f.type) && c.multi) return $t('multiple');
		return '';
	}

	// fields drag-reorder (mirror StatusEditor)
	let items = $state<Field[]>([]);
	$effect(() => {
		items = [...fields];
	});
	const shownItems = $derived(items.filter((f) => (f.entity ?? 'task') === entityTab));
	let dragId = $state<string | null>(null);
	let reorderForm = $state<HTMLFormElement | null>(null);
	let reorderIds = $state('');
	function onDragOver(e: DragEvent, overId: string) {
		if (!dragId || dragId === overId) return;
		e.preventDefault();
		const without = items.filter((i) => i.id !== dragId);
		const idx = without.findIndex((i) => i.id === overId);
		const drag = items.find((i) => i.id === dragId);
		if (!drag) return;
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
	<Popover ariaLabel={$t('Icon')}>
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

{#snippet configFields(type: string, cfg: Record<string, any>)}
	{#if type === 'number'}
		<select class="select cfg-in" bind:value={cfg.numberFormat} aria-label={$t('Number format')}>
			{#each NUMBER_FORMATS as f (f)}<option value={f}>{$t(NUMBER_FORMAT_LABELS[f])}</option>{/each}
		</select>
		{#if cfg.numberFormat === 'currency' || cfg.numberFormat === 'accounting' || cfg.numberFormat === 'financial'}
			<input class="input cfg-in" bind:value={cfg.currencyCode} placeholder={$t('Currency (e.g. USD)')} maxlength="3" />
		{/if}
		{#if cfg.numberFormat === 'custom'}
			<input class="input cfg-in" bind:value={cfg.formatString} placeholder={$t('Google Sheets number format')} maxlength="80" />
		{/if}
	{:else if type === 'date'}
		<select class="select cfg-in" bind:value={cfg.dateFormat} aria-label={$t('Date format')}>
			{#each DATE_FORMATS as f (f)}<option value={f}>{$t(DATE_FORMAT_LABELS[f])}</option>{/each}
		</select>
		<select class="select cfg-in" bind:value={cfg.timeFormat} aria-label={$t('Time format')}>
			{#each TIME_FORMATS as f (f)}<option value={f}>{$t(TIME_FORMAT_LABELS[f])}</option>{/each}
		</select>
	{:else if type === 'select'}
		<label class="cfg-check"><input type="checkbox" bind:checked={cfg.multi} /> {$t('Allow multiple')}</label>
		<select class="select cfg-in" bind:value={cfg.displayOption} aria-label={$t('Display')}>
			{#each SELECT_DISPLAYS as d (d)}<option value={d}>{$t(DISPLAY_LABELS[d])}</option>{/each}
		</select>
	{:else if type === 'person' || type === 'place' || type === 'files' || type === 'task'}
		<label class="cfg-check"><input type="checkbox" bind:checked={cfg.multi} /> {$t('Allow multiple')}</label>
	{:else if type === 'rollup'}
		<select class="select cfg-in" bind:value={cfg.relation} aria-label={$t('Relation')}>
			{#each ROLLUP_RELATIONS as [val, lbl] (val)}
				{#if entityTab !== 'project' || val === 'task'}
					<option value={val}>{$t(lbl)}</option>
				{/if}
			{/each}
		</select>
		<select class="select cfg-in" bind:value={cfg.targetFieldId} aria-label={$t('Target property')}>
			<option value="">{$t('Target property…')}</option>
			{#each fields.filter((f) => f.type !== 'rollup') as f (f.id)}
				<option value={f.id}>{f.name}</option>
			{/each}
		</select>
		<select class="select cfg-in" bind:value={cfg.formula} aria-label={$t('Formula')}>
			{#each ROLLUP_FORMULAS as [val, lbl] (val)}
				<option value={val}>{$t(lbl)}</option>
			{/each}
		</select>
	{/if}
{/snippet}

<div class="cf-tabs">
	<button class="cf-tab" class:cf-tab--on={entityTab === 'task'} type="button" onclick={() => { entityTab = 'task'; creating = false; }}>{$t('Task')}</button>
	<button class="cf-tab" class:cf-tab--on={entityTab === 'project'} type="button" onclick={() => { entityTab = 'project'; creating = false; }}>{$t('Project')}</button>
</div>

<div class="cf-editor">
	{#each shownItems as f (f.id)}
		<div class="cf">
			{#if editingId === f.id}
				<form
					class="cf-row cf-row--edit"
					method="POST"
					action="?/updateCustomField"
					use:enhance={() =>
						({ update }) => {
							editingId = null;
							update();
						}}
				>
					<input type="hidden" name="id" value={f.id} />
					<input type="hidden" name="config" value={JSON.stringify(editConfig)} />
					<input name="name" class="input name-in" bind:value={editName} required maxlength="60" />
					<span class="badge">{$t(fieldTypeLabel(f.type))}</span>
					{@render configFields(f.type, editConfig)}
					<select class="select cfg-in" name="appliesTo" bind:value={editAppliesTo} aria-label={$t('Applies to')}>
						{#each APPLIES_TO as a (a)}<option value={a}>{$t(appliesToLabel(a))}</option>{/each}
					</select>
					<span class="spacer"></span>
					<button class="btn btn-sm" type="button" onclick={() => (editingId = null)}>{$t('Cancel')}</button>
					<button class="btn btn-sm btn-primary" type="submit">{$t('Save')}</button>
				</form>
			{:else}
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					class="cf-row"
					class:dragging={dragId === f.id}
					draggable="true"
					ondragstart={() => (dragId = f.id)}
					ondragover={(e) => onDragOver(e, f.id)}
					ondragend={() => (dragId = null)}
					ondrop={commitOrder}
				>
					<span class="drag" use:tooltip={$t('Drag to reorder')}><Icon name="drag" size={14} /></span>
					<button class="name name-btn" type="button" onclick={() => openEdit(f)}>{f.name}</button>
					<span class="badge">{$t(fieldTypeLabel(f.type))}</span>
					{#if typeHint(f)}<span class="u-tiny u-muted">{typeHint(f)}</span>{/if}
					{#if (f.appliesTo ?? 'all') !== 'all'}<span class="badge">{$t(appliesToLabel(f.appliesTo))}</span>{/if}
					<span class="spacer"></span>
					{#if (f.entity ?? 'task') === 'task'}<span class="u-tiny u-muted">{$t('{n} task(s)', { n: f.inUse })}</span>{/if}
					<button class="icon-btn" type="button" aria-label={$t('Edit')} onclick={() => openEdit(f)}>
						<Icon name="edit-pencil" size={14} />
					</button>
					<form
						method="POST"
						action="?/deleteCustomField"
						use:enhance={() => async ({ update }) => update()}
					>
						<input type="hidden" name="id" value={f.id} />
						<button
							class="icon-btn icon-btn--danger"
							type="button"
							aria-label={$t('Delete')}
							onclick={async (e) => {
								const form = e.currentTarget.form;
								const msg =
									f.inUse > 0
										? $t('Delete this field and its values from {n} task(s)?', { n: f.inUse })
										: $t('Delete this field?');
								if (await confirmDialog(msg, { confirmLabel: $t('Delete'), danger: true }))
									form?.requestSubmit();
							}}
						>
							<Icon name="trash" size={14} />
						</button>
					</form>
				</div>
			{/if}

			{#if f.type === 'select'}
				<div class="opts">
					{#each optionsFor(f.id) as o (o.id)}
						{#if editingOptId === o.id}
							<form
								class="opt opt--edit"
								method="POST"
								action="?/updateCustomFieldOption"
								use:enhance={() =>
									({ update }) => {
										editingOptId = null;
										update();
									}}
							>
								<input type="hidden" name="id" value={o.id} />
								<input type="color" name="color" value={o.color ?? '#71717a'} class="color-in" aria-label={$t('Color')} />
								{@render iconField(editOptIcon, (v) => (editOptIcon = v))}
								<input name="title" class="input" value={o.title} required maxlength="60" style="flex:1; min-width:100px;" />
								<button class="btn btn-sm" type="button" onclick={() => (editingOptId = null)}>{$t('Cancel')}</button>
								<button class="btn btn-sm btn-primary" type="submit">{$t('Save')}</button>
							</form>
						{:else}
							<div class="opt">
								{#if o.icon}<EntityIcon value={o.icon} size={14} />{:else}<span class="dot" style="--c: {o.color || 'var(--color-muted)'}"></span>{/if}
								<span class="opt-title">{o.title}</span>
								<span class="spacer"></span>
								<button class="icon-btn" type="button" aria-label={$t('Edit')} onclick={() => { editingOptId = o.id; editOptIcon = o.icon ?? ''; }}>
									<Icon name="edit-pencil" size={12} />
								</button>
								<form method="POST" action="?/deleteCustomFieldOption" use:enhance>
									<input type="hidden" name="id" value={o.id} />
									<button class="icon-btn icon-btn--danger" type="submit" aria-label={$t('Delete')}>
										<Icon name="trash" size={12} />
									</button>
								</form>
							</div>
						{/if}
					{/each}
					<form
						class="opt opt--edit"
						method="POST"
						action="?/createCustomFieldOption"
						use:enhance={() => async ({ result, update }) => {
							if (result.type === 'success') newOptIcon[f.id] = '';
							await update();
						}}
					>
						<input type="hidden" name="fieldId" value={f.id} />
						<input type="color" name="color" value="#71717a" class="color-in" aria-label={$t('Color')} />
						{@render iconField(newOptIcon[f.id] ?? '', (v) => (newOptIcon[f.id] = v))}
						<input name="title" class="input" placeholder={$t('New option…')} required maxlength="60" style="flex:1; min-width:100px;" />
						<button class="btn btn-sm" type="submit">{$t('Add option')}</button>
					</form>
				</div>
			{/if}
		</div>
	{/each}

	{#if creating}
		<form
			class="cf-row cf-row--edit cf-create"
			method="POST"
			action="?/createCustomField"
			use:enhance={() => async ({ result, update }) => {
				if (result.type === 'success') creating = false;
				await update();
			}}
		>
			<input name="name" class="input name-in" bind:value={newName} placeholder={$t('Field name')} required maxlength="60" autocomplete="off" />
			<select name="type" class="select cfg-in" bind:value={newType} aria-label={$t('Field type')}>
				{#each fieldTypes as ty (ty)}<option value={ty}>{$t(fieldTypeLabel(ty))}</option>{/each}
			</select>
			<input type="hidden" name="config" value={JSON.stringify(newConfig)} />
			<input type="hidden" name="entity" value={entityTab} />
			{@render configFields(newType, newConfig)}
			{#if entityTab === 'task'}
				<select name="appliesTo" class="select cfg-in" bind:value={newAppliesTo} aria-label={$t('Applies to')}>
					{#each APPLIES_TO as a (a)}<option value={a}>{$t(appliesToLabel(a))}</option>{/each}
				</select>
			{/if}
			<span class="spacer"></span>
			<button class="btn btn-sm" type="button" onclick={() => (creating = false)}>{$t('Cancel')}</button>
			<button class="btn btn-sm btn-primary" type="submit">{$t('Create')}</button>
		</form>
	{:else}
		<button class="add-field" type="button" onclick={openCreate}>
			<Icon name="plus" size={14} /> {$t('Add field')}
		</button>
	{/if}

	<form bind:this={reorderForm} method="POST" action="?/reorderCustomField" use:enhance class="reorder-form">
		<input type="hidden" name="ids" bind:value={reorderIds} />
	</form>
</div>

<style>
	.cf-tabs {
		display: inline-flex;
		gap: 2px;
		margin-bottom: var(--sp-2);
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-field, 0.25rem);
		overflow: hidden;
	}

	.cf-tab {
		border: none;
		background: var(--color-bg);
		color: var(--color-muted);
		font-size: 12px;
		padding: 3px 14px;
		cursor: pointer;
		transition: background var(--dur-fast) ease, color var(--dur-fast) ease;
	}

	.cf-tab + .cf-tab {
		border-left: 1px solid var(--color-border-subtle);
	}

	.cf-tab--on {
		background: var(--color-surface-muted);
		color: var(--color-fg);
		font-weight: 600;
	}

	.cf-editor {
		border: 1px solid var(--color-base-300);
		border-radius: var(--radius-box, 0.5rem);
		/* not `overflow: hidden` — it would clip row icon-picker popovers */
	}

	.cf-editor > :first-child {
		border-top-left-radius: var(--radius-box, 0.5rem);
		border-top-right-radius: var(--radius-box, 0.5rem);
	}

	.cf-editor > :last-child {
		border-bottom-left-radius: var(--radius-box, 0.5rem);
		border-bottom-right-radius: var(--radius-box, 0.5rem);
	}

	.cf {
		border-top: 1px solid var(--color-border-subtle);
	}

	.cf:first-child {
		border-top: none;
	}

	.cf-row {
		display: flex;
		align-items: center;
		gap: var(--sp-2);
		padding: var(--sp-2) 10px;
	}

	.cf-row--edit {
		flex-wrap: wrap;
	}

	.cf-row.dragging {
		opacity: 0.4;
	}

	.drag {
		display: inline-flex;
		align-items: center;
		color: var(--color-muted);
		cursor: grab;
		flex: 0 0 auto;
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

	.name-in {
		flex: 1;
		min-width: 120px;
	}

	.cfg-in {
		width: auto;
	}

	.cfg-check {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-size: 13px;
		white-space: nowrap;
	}

	.spacer {
		flex: 1;
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

	.opts {
		padding: 0 10px var(--sp-2) 34px;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.opt {
		display: flex;
		align-items: center;
		gap: var(--sp-2);
		padding: 3px 0;
	}

	.opt--edit {
		flex-wrap: wrap;
	}

	.opt-title {
		font-size: 13px;
	}

	.dot {
		width: 9px;
		height: 9px;
		border-radius: 999px;
		background: var(--c);
		flex: 0 0 auto;
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

	.cf-row:hover .icon-btn,
	.opt:hover .icon-btn {
		opacity: 1;
	}

	.icon-btn:hover {
		color: var(--color-fg);
		background: var(--color-surface-muted);
	}

	.icon-btn--danger:hover {
		color: var(--color-error);
	}

	.add-field {
		display: flex;
		align-items: center;
		gap: 6px;
		width: 100%;
		border: none;
		border-top: 1px solid var(--color-border-subtle);
		background: none;
		color: var(--color-muted);
		font-family: inherit;
		font-size: 13px;
		padding: var(--sp-2) 10px;
		cursor: pointer;
		transition: color var(--dur-fast) ease, background var(--dur-fast) ease;
	}

	.add-field:hover {
		color: var(--color-fg);
		background: var(--color-surface-muted);
	}

	.cf-create {
		border-top: 1px solid var(--color-border-subtle);
	}

	.reorder-form {
		display: none;
	}
</style>
