<script lang="ts">
	import { tick } from 'svelte';
	import { enhance } from '$app/forms';
	import Icon from '$lib/components/Icon.svelte';
	import EntityIcon from '$lib/components/EntityIcon.svelte';
	import Popover from '$lib/components/Popover.svelte';
	import { t } from '$lib/i18n';
	import { decodeValue, formatNumber, formatDate, type FieldConfig } from '$lib/customFields';

	type Option = { id: string; title: string; color: string | null; icon: string | null };
	type FileRef = { id: string; filename: string; mimeType: string; size: number };

	let {
		field,
		options = [],
		value = null,
		mode = 'pill',
		taskId = '',
		formAction = '?/patchTask',
		rollupText = null,
		users = [],
		locations = [],
		tasks = [],
		files = [],
		canEdit = true,
		taskSearch = () => '',
		onUpload
	}: {
		field: { id: string; name: string; type: string; config: FieldConfig };
		options?: Option[];
		value?: string | null;
		mode?: 'pill' | 'cell' | 'input';
		taskId?: string;
		formAction?: string;
		rollupText?: string | null;
		users?: { id: string; name: string }[];
		locations?: { id: string; title: string }[];
		tasks?: { id: string; title: string; parentId: string | null }[];
		files?: FileRef[];
		canEdit?: boolean;
		taskSearch?: (taskId: string) => string;
		onUpload?: (fileId: string) => void;
	} = $props();

	const multi = $derived(field.config?.multi === true);
	const isArrayType = $derived(['select', 'person', 'place', 'files', 'task'].includes(field.type));
	// reference fields that benefit from an inline removable-chip layout (files keep
	// their own upload/remove editor, so they're excluded here)
	const multiChips = $derived(multi && ['select', 'person', 'place', 'task'].includes(field.type));

	// svelte-ignore state_referenced_locally
	let current = $state<string>(value ?? '');
	$effect(() => {
		current = value ?? '';
	});

	let form = $state<HTMLFormElement | null>(null);

	async function set(raw: string) {
		current = raw;
		if (mode === 'pill') {
			await tick();
			form?.requestSubmit();
		}
	}

	const ids = $derived.by(() => {
		const d = decodeValue(field, current);
		return Array.isArray(d) ? (d as string[]) : [];
	});

	function toggleId(id: string) {
		let next: string[];
		if (multi) next = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
		else next = ids.includes(id) ? [] : [id];
		set(next.length ? JSON.stringify(next) : '');
	}

	// lookups
	const optById = (id: string) => options.find((o) => o.id === id);
	const userName = (id: string) => users.find((u) => u.id === id)?.name ?? id;
	const locTitle = (id: string) => locations.find((l) => l.id === id)?.title ?? id;
	const taskTitle = (id: string) => tasks.find((tk) => tk.id === id)?.title ?? id;
	const fileById = (id: string) => files.find((f) => f.id === id);

	const displayOption = $derived((field.config?.displayOption as string) ?? 'text');

	// has any value?
	const hasValue = $derived(
		field.type === 'checkbox' ? current === 'true' : isArrayType ? ids.length > 0 : !!current
	);

	// search state for reference pickers
	let query = $state('');
	const matchUsers = $derived(users.filter((u) => u.name.toLowerCase().includes(query.toLowerCase())));
	const matchLocs = $derived(locations.filter((l) => l.title.toLowerCase().includes(query.toLowerCase())));
	const matchTasks = $derived(
		tasks.filter(
			(tk) =>
				tk.id !== taskId &&
				`${tk.title} ${taskSearch(tk.id)}`.toLowerCase().includes(query.toLowerCase())
		)
	);

	let uploading = $state(false);
	async function upload(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const f = input.files?.[0];
		if (!f) return;
		uploading = true;
		try {
			const fd = new FormData();
			fd.set('projectId', '');
			fd.set('fieldId', field.id);
			if (taskId) fd.set('taskId', taskId);
			fd.set('file', f);
			const res = await fetch('/api/files', { method: 'POST', body: fd });
			if (res.ok) {
				const { file: uploaded } = await res.json();
				const next = multi ? [...ids, uploaded.id] : [uploaded.id];
				await set(JSON.stringify(next));
				onUpload?.(uploaded.id);
			}
		} finally {
			uploading = false;
			input.value = '';
		}
	}
</script>

<!-- read-only value display (cell + pill trigger) -->
{#snippet display()}
	{#if field.type === 'rollup'}
		<span class="v num">{rollupText ?? '—'}</span>
	{:else if !hasValue}
		<span class="ph">—</span>
	{:else if field.type === 'checkbox'}
		<Icon name="check" size={14} />
	{:else if field.type === 'number'}
		<span class="v num">{formatNumber(Number(current), field.config)}</span>
	{:else if field.type === 'date'}
		<span class="v">{formatDate(current, field.config)}</span>
	{:else if field.type === 'url'}
		<a class="v link" href={current} target="_blank" rel="noreferrer noopener" onclick={(e) => e.stopPropagation()}>{current}</a>
	{:else if field.type === 'email'}
		<span class="v">{current}</span>
	{:else if field.type === 'select'}
		<span class="chips">
			{#each ids as id (id)}
				{@const o = optById(id)}
				{#if o}
					<span class="chip-sel" style="--c: {o.color || 'var(--color-muted)'}">
						{#if displayOption !== 'text' && o.icon}<EntityIcon value={o.icon} size={12} />{/if}
						{#if displayOption !== 'icon' || !o.icon}<span>{o.title}</span>{/if}
					</span>
				{/if}
			{/each}
		</span>
	{:else if field.type === 'person'}
		<span class="chips">{#each ids as id (id)}<span class="chip">{userName(id)}</span>{/each}</span>
	{:else if field.type === 'place'}
		<span class="chips">{#each ids as id (id)}<span class="chip">{locTitle(id)}</span>{/each}</span>
	{:else if field.type === 'task'}
		<span class="chips">{#each ids as id (id)}<span class="chip">{taskTitle(id)}</span>{/each}</span>
	{:else if field.type === 'files'}
		<span class="chips">
			{#each ids as id (id)}
				{@const f = fileById(id)}
				{#if f}<a class="chip link" href={`/api/files/${f.id}`} target="_blank" rel="noreferrer noopener" onclick={(e) => e.stopPropagation()}>{f.filename}</a>{/if}
			{/each}
		</span>
	{:else}
		<span class="v">{current}</span>
	{/if}
{/snippet}

<!-- the editing controls (used inside the pill popover and the input-mode block) -->
{#snippet editor(close: () => void)}
	{#if field.type === 'text' || field.type === 'email' || field.type === 'phone' || field.type === 'url'}
		<input
			class="input"
			type={field.type === 'email' ? 'email' : field.type === 'url' ? 'url' : 'text'}
			value={current}
			placeholder={field.name}
			autocomplete="off"
			onblur={(e) => set(e.currentTarget.value.trim())}
			onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); set(e.currentTarget.value.trim()); close(); } }}
		/>
	{:else if field.type === 'number'}
		<input class="input" type="number" value={current} step="any" onblur={(e) => set(e.currentTarget.value.trim())}
			onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); set(e.currentTarget.value.trim()); close(); } }} />
	{:else if field.type === 'date'}
		<input
			class="input"
			type={field.config?.timeFormat && field.config.timeFormat !== 'hidden' ? 'datetime-local' : 'date'}
			value={current}
			onchange={(e) => set(e.currentTarget.value)}
		/>
	{:else if field.type === 'checkbox'}
		<label class="chk"><input type="checkbox" checked={current === 'true'} onchange={(e) => set(e.currentTarget.checked ? 'true' : '')} /> {field.name}</label>
	{:else if field.type === 'select'}
		<div class="pick">
			{#each options as o (o.id)}
				<button class="pick-item" type="button" onclick={() => { toggleId(o.id); if (!multi) close(); }}>
					<span class="chk-box">{#if ids.includes(o.id)}<Icon name="check" size={12} />{/if}</span>
					{#if o.icon}<EntityIcon value={o.icon} size={14} />{:else}<span class="dot" style="--c: {o.color || 'var(--color-muted)'}"></span>{/if}
					<span>{o.title}</span>
				</button>
			{:else}
				<p class="empty">{$t('No options. Add some in project settings.')}</p>
			{/each}
		</div>
	{:else if field.type === 'person'}
		<input class="input search" placeholder={$t('Search people…')} bind:value={query} autocomplete="off" />
		<div class="pick">
			{#each matchUsers as u (u.id)}
				<button class="pick-item" type="button" onclick={() => { toggleId(u.id); if (!multi) close(); }}>
					<span class="chk-box">{#if ids.includes(u.id)}<Icon name="check" size={12} />{/if}</span>{u.name}
				</button>
			{/each}
		</div>
	{:else if field.type === 'place'}
		<input class="input search" placeholder={$t('Search places…')} bind:value={query} autocomplete="off" />
		<div class="pick">
			{#each matchLocs as l (l.id)}
				<button class="pick-item" type="button" onclick={() => { toggleId(l.id); if (!multi) close(); }}>
					<span class="chk-box">{#if ids.includes(l.id)}<Icon name="check" size={12} />{/if}</span>{l.title}
				</button>
			{:else}
				<p class="empty">{$t('No locations. Add some in project settings.')}</p>
			{/each}
		</div>
	{:else if field.type === 'task'}
		<input class="input search" placeholder={$t('Search tasks…')} bind:value={query} autocomplete="off" />
		<div class="pick">
			{#each matchTasks as tk (tk.id)}
				<button class="pick-item" type="button" onclick={() => { toggleId(tk.id); if (!multi) close(); }}>
					<span class="chk-box">{#if ids.includes(tk.id)}<Icon name="check" size={12} />{/if}</span>{tk.title}
				</button>
			{/each}
		</div>
	{:else if field.type === 'files'}
		<div class="pick">
			{#each ids as id (id)}
				{@const f = fileById(id)}
				{#if f}
					<div class="file-row">
						<a class="link" href={`/api/files/${f.id}`} target="_blank" rel="noreferrer noopener">{f.filename}</a>
						<button class="rm" type="button" aria-label={$t('Remove')} onclick={() => set(JSON.stringify(ids.filter((x) => x !== id)) === '[]' ? '' : JSON.stringify(ids.filter((x) => x !== id)))}>
							<Icon name="xmark" size={12} />
						</button>
					</div>
				{/if}
			{/each}
			{#if taskId && (multi || ids.length === 0)}
				<label class="upload">
					<input type="file" onchange={upload} hidden />
					{uploading ? $t('Uploading…') : $t('Upload file')}
				</label>
			{:else if !taskId}
				<p class="empty">{$t('Save the task first to attach files.')}</p>
			{/if}
		</div>
	{/if}
{/snippet}

{#if mode === 'cell'}
	{@render display()}
{:else if mode === 'input'}
	<div class="cf-input">
		<span class="cf-label">{field.name}</span>
		{#if field.type === 'rollup'}
			<span class="pill-val pill-val--ro">{@render display()}</span>
		{:else}
			{@render editor(() => {})}
			<input type="hidden" name={`cf_${field.id}`} value={current} />
		{/if}
	</div>
{:else}
	<!-- pill -->
	<div class="cf-pill" class:cf-pill--multi={multiChips && canEdit}>
		<span class="cf-label">{field.name}</span>
		{#if canEdit && field.type !== 'rollup'}
			{#if multiChips}
				<!-- multi reference field: each value is a removable chip + an "+ Add" picker -->
				<div class="cf-multi">
					{#each ids as id (id)}
						{#if field.type === 'select'}
							{@const o = optById(id)}
							{#if o}
								<span class="chip-rm colored" style="--c: {o.color || 'var(--color-muted)'}">
									{#if displayOption !== 'text' && o.icon}<EntityIcon value={o.icon} size={12} />{/if}
									{#if displayOption !== 'icon' || !o.icon}<span>{o.title}</span>{/if}
									<button class="chip-x" type="button" aria-label={$t('Remove')} onclick={() => toggleId(id)}><Icon name="xmark" size={11} /></button>
								</span>
							{/if}
						{:else}
							<span class="chip-rm">
								<span>{field.type === 'person' ? userName(id) : field.type === 'place' ? locTitle(id) : taskTitle(id)}</span>
								<button class="chip-x" type="button" aria-label={$t('Remove')} onclick={() => toggleId(id)}><Icon name="xmark" size={11} /></button>
							</span>
						{/if}
					{/each}
					<Popover ariaLabel={field.name}>
						{#snippet trigger()}<span class="add-chip"><Icon name="plus" size={12} /> {$t('Add')}</span>{/snippet}
						{#snippet panel(close)}<div class="panel">{@render editor(close)}</div>{/snippet}
					</Popover>
				</div>
			{:else}
				<Popover ariaLabel={field.name}>
					{#snippet trigger()}
						<span class="pill-val">{@render display()}</span>
					{/snippet}
					{#snippet panel(close)}
						<div class="panel">{@render editor(close)}</div>
					{/snippet}
				</Popover>
			{/if}
			<form bind:this={form} method="POST" action={formAction} use:enhance class="hidden-form">
				<input type="hidden" name="id" value={taskId} />
				<input type="hidden" name={`cf_${field.id}`} value={current} />
			</form>
		{:else}
			<span class="pill-val pill-val--ro">{@render display()}</span>
		{/if}
	</div>
{/if}

<style>
	.cf-pill,
	.cf-input {
		display: flex;
		align-items: center;
		gap: var(--sp-2);
	}

	.cf-input {
		flex-direction: column;
		align-items: stretch;
		gap: 4px;
	}

	.cf-label {
		font-size: 12px;
		color: var(--color-muted);
		min-width: 84px;
		flex: 0 0 auto;
	}

	.cf-input .cf-label {
		min-width: 0;
	}

	.pill-val {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-size: 13px;
		color: var(--color-fg);
		cursor: pointer;
		min-height: 20px;
	}

	.pill-val--ro {
		cursor: default;
	}

	.ph {
		color: var(--color-muted);
	}

	.v {
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.num {
		font-variant-numeric: tabular-nums;
	}

	.link {
		color: var(--color-link, var(--color-fg));
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	.chips {
		display: inline-flex;
		flex-wrap: wrap;
		gap: 4px;
	}

	.chip {
		font-size: 12px;
		border: 1px solid var(--color-border-subtle);
		border-radius: 999px;
		padding: 0 8px;
	}

	.chip-sel {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-size: 12px;
		border-radius: 999px;
		padding: 1px 8px;
		background: color-mix(in oklab, var(--c) 12%, transparent);
		border: 1px solid color-mix(in oklab, var(--c) 40%, transparent);
	}

	/* multi reference field: inline removable chips + an "Add" picker */
	.cf-pill--multi {
		align-items: flex-start;
	}

	.cf-pill--multi .cf-label {
		padding-top: 4px;
	}

	.cf-multi {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px;
		flex: 1 1 auto;
		min-width: 0;
	}

	.chip-rm {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		max-width: 100%;
		font-size: 12px;
		border: 1px solid var(--color-border-subtle);
		border-radius: 999px;
		padding: 1px 3px 1px 8px;
	}

	.chip-rm > span {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.chip-rm.colored {
		background: color-mix(in oklab, var(--c) 12%, transparent);
		border-color: color-mix(in oklab, var(--c) 40%, transparent);
	}

	.chip-x {
		position: relative;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border: none;
		background: none;
		color: var(--color-muted);
		cursor: pointer;
		padding: 1px;
		line-height: 0;
		border-radius: 999px;
		transition: color var(--dur-fast), background-color var(--dur-fast);
	}

	.chip-x::before {
		content: '';
		position: absolute;
		inset: -7px;
	}

	.chip-x:hover {
		color: var(--color-error);
		background: var(--color-surface-muted);
	}

	.add-chip {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		font-size: 12px;
		color: var(--color-muted);
	}

	.panel {
		min-width: 220px;
		padding: 6px;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.input {
		width: 100%;
	}

	.search {
		margin-bottom: 2px;
	}

	.chk {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 13px;
	}

	.pick {
		display: flex;
		flex-direction: column;
		max-height: 240px;
		overflow-y: auto;
	}

	.pick-item {
		display: flex;
		align-items: center;
		gap: 8px;
		border: none;
		background: none;
		color: var(--color-fg);
		font-size: 13px;
		text-align: left;
		padding: 5px 6px;
		border-radius: var(--radius-field, 0.25rem);
		cursor: pointer;
		transition: background-color var(--dur-fast);
	}

	.pick-item:hover {
		background: var(--color-surface-muted);
	}

	.chk-box {
		display: inline-flex;
		width: 14px;
		justify-content: center;
		color: var(--color-muted);
	}

	.dot {
		width: 9px;
		height: 9px;
		border-radius: 999px;
		background: var(--c);
	}

	.empty {
		font-size: 12px;
		color: var(--color-muted);
		padding: 4px 6px;
	}

	.file-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		font-size: 13px;
		padding: 3px 0;
	}

	.rm {
		position: relative;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border: none;
		background: none;
		color: var(--color-muted);
		cursor: pointer;
		padding: 2px;
		line-height: 0;
		transition: color var(--dur-fast);
	}

	.rm::before {
		content: '';
		position: absolute;
		inset: -10px;
	}

	.rm:hover {
		color: var(--color-error);
	}

	.upload {
		font-size: 13px;
		color: var(--color-link, var(--color-fg));
		cursor: pointer;
		padding: 4px 0;
	}

	.hidden-form {
		display: none;
	}
</style>
