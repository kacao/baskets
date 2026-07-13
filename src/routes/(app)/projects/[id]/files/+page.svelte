<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import Icon from '$lib/components/Icon.svelte';
	import { confirmDialog } from '$lib/confirm.svelte';
	import { fileIcon, fileKind, formatBytes, isPreviewableImage, type FileKind } from '$lib/files';
	import { t } from '$lib/i18n';
	import { tooltip } from '$lib/tooltip';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	type SourceKey = 'all' | 'task' | 'field' | 'project';

	let search = $state('');
	let typeFilter = $state<'all' | FileKind>('all');
	let sourceFilter = $state<SourceKey>('all');
	let layout = $state<'grid' | 'list'>('grid');

	let uploading = $state(false);
	let dragOver = $state(false);
	let fileInput = $state<HTMLInputElement | null>(null);
	let lightboxId = $state<string | null>(null);
	let uploadError = $state<string | null>(null);

	const filtered = $derived(
		data.files.filter((f) => {
			if (search.trim() && !f.filename.toLowerCase().includes(search.trim().toLowerCase()))
				return false;
			if (typeFilter !== 'all' && fileKind(f.mimeType) !== typeFilter) return false;
			if (sourceFilter !== 'all' && f.source.kind !== sourceFilter) return false;
			return true;
		})
	);

	const lightbox = $derived(
		lightboxId ? (data.files.find((f) => f.id === lightboxId) ?? null) : null
	);

	function sourceLabel(f: PageData['files'][number]): string {
		if (f.source.kind === 'task') return $t('Task: {x}', { x: f.source.taskTitle });
		if (f.source.kind === 'field') return $t('Field: {x}', { x: f.source.fieldName });
		return $t('Project');
	}

	function shortDate(d: Date | string | number): string {
		try {
			return new Date(d).toLocaleDateString(undefined, {
				month: 'short',
				day: 'numeric',
				year: 'numeric'
			});
		} catch {
			return '';
		}
	}

	async function uploadFiles(list: FileList | File[]) {
		const arr = Array.from(list);
		if (arr.length === 0) return;
		uploading = true;
		uploadError = null;
		try {
			for (const f of arr) {
				const fd = new FormData();
				fd.set('file', f);
				const res = await fetch(`/api/projects/${data.project.id}/files`, {
					method: 'POST',
					body: fd
				});
				if (!res.ok) {
					const body = await res.json().catch(() => ({}));
					const msg =
						res.status === 413
							? $t('{name}: too large (max 10 MB)', { name: f.name })
							: res.status === 415
								? $t('{name}: type not allowed', { name: f.name })
								: `${f.name}: ${body.error ?? $t('Upload failed')}`;
					uploadError = msg;
				}
			}
			await invalidateAll();
		} finally {
			uploading = false;
		}
	}

	async function onPick(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		if (input.files?.length) await uploadFiles(input.files);
		input.value = '';
	}

	async function onDrop(e: DragEvent) {
		e.preventDefault();
		dragOver = false;
		if (!data.perm.canEdit) return;
		const dropped = e.dataTransfer?.files;
		if (dropped?.length) await uploadFiles(dropped);
	}

	async function remove(f: PageData['files'][number]) {
		if (
			!(await confirmDialog($t('Delete this file?'), { confirmLabel: $t('Delete'), danger: true }))
		)
			return;
		const res = await fetch(`/api/files/${f.id}`, { method: 'DELETE' });
		if (res.ok) {
			if (lightboxId === f.id) lightboxId = null;
			await invalidateAll();
		}
	}
</script>

<svelte:head><title>{data.project.name} — {$t('Files')} — Baskets</title></svelte:head>

<p class="u-tiny" style="margin-bottom: var(--sp-2);">
	<a href="/projects/{data.project.id}" class="u-flex" style="gap: 4px;">
		<Icon name="arrow-left" size={12} />
		{data.project.name}
	</a>
</p>
<h2 style="margin-bottom: var(--sp-4);">
	{$t('Files')}
	<span class="hcount">{data.files.length}</span>
</h2>

{#if data.perm.canEdit}
	<div
		class="dropzone"
		class:over={dragOver}
		role="button"
		tabindex="0"
		aria-label={$t('Add files')}
		ondragover={(e) => {
			e.preventDefault();
			dragOver = true;
		}}
		ondragleave={() => (dragOver = false)}
		ondrop={onDrop}
		onclick={() => fileInput?.click()}
		onkeydown={(e) => {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				fileInput?.click();
			}
		}}
	>
		<Icon name="cloud-upload" size={20} />
		<span>{uploading ? $t('Uploading…') : $t('Drag files here or click to upload')}</span>
		<button
			class="btn btn-sm btn-primary"
			type="button"
			onclick={(e) => {
				e.stopPropagation();
				fileInput?.click();
			}}
			disabled={uploading}
		>
			<Icon name="upload" size={14} />
			{$t('Upload')}
		</button>
	</div>
	<input bind:this={fileInput} type="file" multiple onchange={onPick} hidden />
	{#if uploadError}
		<div class="alert alert-error" role="alert" style="margin-bottom: var(--sp-3);">
			{uploadError}
		</div>
	{/if}
{/if}

<div class="toolbar">
	<label class="search">
		<Icon name="search" size={14} />
		<input class="search-in" type="search" placeholder={$t('Search files…')} bind:value={search} />
	</label>

	<select class="select select-sm fselect" bind:value={typeFilter} aria-label={$t('Type')}>
		<option value="all">{$t('All types')}</option>
		<option value="image">{$t('Images')}</option>
		<option value="document">{$t('Documents')}</option>
		<option value="other">{$t('Other')}</option>
	</select>

	<select class="select select-sm fselect" bind:value={sourceFilter} aria-label={$t('Source')}>
		<option value="all">{$t('All sources')}</option>
		<option value="task">{$t('Task attachments')}</option>
		<option value="field">{$t('Custom fields')}</option>
		<option value="project">{$t('Project files')}</option>
	</select>

	<span class="spacer"></span>

	<div class="seg" role="group" aria-label={$t('Layout')}>
		<button
			class="seg-btn"
			class:on={layout === 'grid'}
			type="button"
			aria-pressed={layout === 'grid'}
			use:tooltip={$t('Grid')}
			onclick={() => (layout = 'grid')}
		>
			<Icon name="view-grid" size={15} />
		</button>
		<button
			class="seg-btn"
			class:on={layout === 'list'}
			type="button"
			aria-pressed={layout === 'list'}
			use:tooltip={$t('List')}
			onclick={() => (layout = 'list')}
		>
			<Icon name="list" size={15} />
		</button>
	</div>
</div>

{#if filtered.length === 0}
	<div class="empty">
		<Icon name="multiple-pages" size={32} />
		<p class="u-muted">
			{data.files.length === 0 ? $t('No files yet.') : $t('No files match your filters.')}
		</p>
	</div>
{:else if layout === 'grid'}
	<div class="grid">
		{#each filtered as f (f.id)}
			<div class="card-file">
				<div class="preview">
					{#if isPreviewableImage(f.mimeType)}
						<button
							class="img-btn"
							type="button"
							onclick={() => (lightboxId = f.id)}
							aria-label={f.filename}
						>
							<img src={`/api/files/${f.id}`} alt={f.filename} loading="lazy" />
						</button>
					{:else}
						<a
							class="doc-btn"
							href={`/api/files/${f.id}`}
							target="_blank"
							rel="noreferrer noopener"
							aria-label={f.filename}
						>
							<Icon name={fileIcon(f.mimeType, f.filename)} size={28} />
						</a>
					{/if}
				</div>
				<div class="meta">
					<span class="fname" use:tooltip={f.filename}>{f.filename}</span>
					<span class="sub">
						<span class="chip chip--{f.source.kind}">{sourceLabel(f)}</span>
						<span class="size">{formatBytes(f.size)}</span>
					</span>
					<span class="who">
						{#if f.uploaderName}{f.uploaderName} ·
						{/if}{shortDate(f.createdAt)}
					</span>
				</div>
				<div class="row-actions">
					<a
						class="icon-btn"
						href={`/api/files/${f.id}`}
						download
						use:tooltip={$t('Download')}
						aria-label={$t('Download')}
					>
						<Icon name="download" size={14} />
					</a>
					{#if data.perm.canEdit}
						<button
							class="icon-btn danger"
							type="button"
							onclick={() => remove(f)}
							use:tooltip={$t('Delete')}
							aria-label={$t('Delete')}
						>
							<Icon name="trash" size={14} />
						</button>
					{/if}
				</div>
			</div>
		{/each}
	</div>
{:else}
	<div class="list">
		{#each filtered as f (f.id)}
			<div class="list-row">
				<div class="list-thumb">
					{#if isPreviewableImage(f.mimeType)}
						<button
							class="img-btn"
							type="button"
							onclick={() => (lightboxId = f.id)}
							aria-label={f.filename}
						>
							<img src={`/api/files/${f.id}`} alt={f.filename} loading="lazy" />
						</button>
					{:else}
						<a
							class="doc-btn"
							href={`/api/files/${f.id}`}
							target="_blank"
							rel="noreferrer noopener"
							aria-label={f.filename}
						>
							<Icon name={fileIcon(f.mimeType, f.filename)} size={22} />
						</a>
					{/if}
				</div>
				<a
					class="list-name"
					href={`/api/files/${f.id}`}
					target="_blank"
					rel="noreferrer noopener"
					use:tooltip={f.filename}
				>
					{f.filename}
				</a>
				<span class="chip chip--{f.source.kind}">{sourceLabel(f)}</span>
				<span class="list-size">{formatBytes(f.size)}</span>
				<span class="list-who">
					{#if f.uploaderName}{f.uploaderName} ·
					{/if}{shortDate(f.createdAt)}
				</span>
				<span class="spacer"></span>
				<div class="row-actions">
					<a
						class="icon-btn"
						href={`/api/files/${f.id}`}
						download
						use:tooltip={$t('Download')}
						aria-label={$t('Download')}
					>
						<Icon name="download" size={14} />
					</a>
					{#if data.perm.canEdit}
						<button
							class="icon-btn danger"
							type="button"
							onclick={() => remove(f)}
							use:tooltip={$t('Delete')}
							aria-label={$t('Delete')}
						>
							<Icon name="trash" size={14} />
						</button>
					{/if}
				</div>
			</div>
		{/each}
	</div>
{/if}

{#if lightbox}
	<div
		class="lightbox"
		role="button"
		tabindex="0"
		aria-label={$t('Close')}
		onclick={() => (lightboxId = null)}
		onkeydown={(e) => {
			if (e.key === 'Escape' || e.key === 'Enter') lightboxId = null;
		}}
	>
		<button
			class="lb-close"
			type="button"
			aria-label={$t('Close')}
			onclick={() => (lightboxId = null)}
		>
			<Icon name="xmark" size={20} />
		</button>
		<img class="lb-img" src={`/api/files/${lightbox.id}`} alt={lightbox.filename} />
		<span class="lb-name">{lightbox.filename}</span>
	</div>
{/if}

<style>
	.hcount {
		font-size: 13px;
		font-weight: 400;
		color: var(--color-muted);
		font-variant-numeric: tabular-nums;
		margin-left: 4px;
	}

	.dropzone {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 10px;
		padding: 18px;
		margin-bottom: var(--sp-3);
		border: 1px dashed var(--color-border-subtle);
		border-radius: var(--radius-field, 0.25rem);
		color: var(--color-muted);
		font-size: 13px;
		cursor: pointer;
		text-align: center;
		transition:
			border-color var(--dur-fast),
			color var(--dur-fast),
			background var(--dur-fast);
	}

	.dropzone:hover,
	.dropzone.over {
		border-color: var(--color-link, var(--color-fg));
		color: var(--color-fg);
		background: var(--color-surface-muted);
	}

	.toolbar {
		display: flex;
		align-items: center;
		gap: var(--sp-2);
		flex-wrap: wrap;
		margin-bottom: var(--sp-3);
	}

	.search {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 0 8px;
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-field, 0.25rem);
		color: var(--color-muted);
		background: var(--color-base-100, var(--color-bg));
		min-width: 180px;
		flex: 1 1 200px;
		max-width: 320px;
	}

	.search-in {
		border: none;
		background: none;
		outline: none;
		font-size: 13px;
		color: var(--color-fg);
		width: 100%;
		padding: 6px 0;
	}

	.spacer {
		flex: 1;
	}

	.fselect {
		font-size: 13px;
	}

	.seg {
		display: inline-flex;
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-field, 0.25rem);
		overflow: hidden;
	}

	.seg-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 6px 9px;
		border: none;
		background: none;
		color: var(--color-muted);
		cursor: pointer;
		transition:
			background var(--dur-fast),
			color var(--dur-fast);
	}

	.seg-btn + .seg-btn {
		border-left: 1px solid var(--color-border-subtle);
	}

	.seg-btn:hover {
		background: var(--color-surface-muted);
		color: var(--color-fg);
	}

	.seg-btn.on {
		background: var(--color-surface-muted);
		color: var(--color-fg);
	}

	.empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 8px;
		padding: 48px 16px;
		color: var(--color-muted);
		border: 1px dashed var(--color-border-subtle);
		border-radius: var(--radius-field, 0.25rem);
	}

	/* grid */
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
		gap: var(--sp-3);
	}

	.card-file {
		display: flex;
		flex-direction: column;
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-field, 0.25rem);
		overflow: hidden;
		background: var(--color-base-100, var(--color-bg));
		transition:
			border-color var(--dur-fast),
			box-shadow var(--dur-fast);
	}

	.card-file:hover {
		border-color: var(--color-border, var(--color-border-subtle));
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
	}

	.preview {
		aspect-ratio: 4 / 3;
		background: var(--color-surface-muted);
		border-bottom: 1px solid var(--color-border-subtle);
	}

	.img-btn,
	.doc-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 100%;
		height: 100%;
		border: none;
		padding: 0;
		margin: 0;
		background: none;
		color: var(--color-muted);
		cursor: pointer;
		text-decoration: none;
	}

	.img-btn img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}

	.meta {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 8px 10px;
		min-width: 0;
	}

	.fname {
		font-size: 13px;
		font-weight: 500;
		color: var(--color-fg);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.sub {
		display: flex;
		align-items: center;
		gap: 6px;
		flex-wrap: wrap;
	}

	.size {
		font-size: 11px;
		color: var(--color-muted);
		font-variant-numeric: tabular-nums;
	}

	.who {
		font-size: 11px;
		color: var(--color-muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.chip {
		display: inline-block;
		max-width: 100%;
		font-size: 10px;
		line-height: 1.4;
		padding: 1px 7px;
		border-radius: 999px;
		border: 1px solid var(--color-border-subtle);
		color: var(--color-muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.chip--task {
		color: var(--color-fg);
		border-color: var(--color-border, var(--color-border-subtle));
	}

	.chip--field {
		color: var(--color-link, var(--color-fg));
		border-color: color-mix(in oklab, var(--color-link, var(--color-fg)) 40%, transparent);
	}

	.row-actions {
		display: flex;
		gap: 4px;
		padding: 0 8px 8px;
		justify-content: flex-end;
	}

	.icon-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-field, 0.25rem);
		background: none;
		color: var(--color-muted);
		cursor: pointer;
		text-decoration: none;
		transition:
			background var(--dur-fast),
			color var(--dur-fast),
			border-color var(--dur-fast);
	}

	.icon-btn:hover {
		background: var(--color-surface-muted);
		color: var(--color-fg);
	}

	.icon-btn.danger:hover {
		color: var(--color-error, tomato);
		border-color: color-mix(in oklab, var(--color-error, tomato) 40%, transparent);
	}

	/* list */
	.list {
		display: flex;
		flex-direction: column;
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-field, 0.25rem);
		overflow: hidden;
	}

	.list-row {
		display: flex;
		align-items: center;
		gap: var(--sp-2);
		padding: 6px 10px;
		border-bottom: 1px solid var(--color-border-subtle);
	}

	.list-row:last-child {
		border-bottom: none;
	}

	.list-thumb {
		width: 36px;
		height: 36px;
		flex: 0 0 36px;
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-field, 0.25rem);
		overflow: hidden;
		background: var(--color-surface-muted);
	}

	.list-name {
		font-size: 13px;
		font-weight: 500;
		color: var(--color-fg);
		text-decoration: none;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		min-width: 0;
		flex: 1 1 160px;
	}

	.list-name:hover {
		text-decoration: underline;
	}

	.list-size {
		font-size: 12px;
		color: var(--color-muted);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	.list-who {
		font-size: 12px;
		color: var(--color-muted);
		white-space: nowrap;
	}

	/* lightbox */
	.lightbox {
		position: fixed;
		inset: 0;
		z-index: 9999;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 10px;
		padding: 24px;
		background: rgba(0, 0, 0, 0.82);
		cursor: zoom-out;
	}

	.lb-img {
		max-width: 92vw;
		max-height: 82vh;
		object-fit: contain;
		border-radius: 4px;
		cursor: default;
		outline: 1px solid rgba(255, 255, 255, 0.1);
		outline-offset: -1px;
	}

	.lb-name {
		color: #eee;
		font-size: 13px;
	}

	.lb-close {
		position: absolute;
		top: 16px;
		right: 16px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border: none;
		background: rgba(255, 255, 255, 0.12);
		color: #fff;
		border-radius: 6px;
		padding: 10px;
		cursor: pointer;
		transition: background var(--dur-fast);
	}

	.lb-close:hover {
		background: rgba(255, 255, 255, 0.24);
	}

	@media (max-width: 640px) {
		.list-who,
		.list-size {
			display: none;
		}

		.toolbar .search {
			max-width: none;
		}
	}
</style>
