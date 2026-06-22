<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import Icon from '$lib/components/Icon.svelte';
	import { confirmDialog } from '$lib/confirm.svelte';
	import { t } from '$lib/i18n';
	import { tooltip } from '$lib/tooltip';

	type FileRef = {
		id: string;
		taskId: string | null;
		fieldId: string | null;
		filename: string;
		mimeType: string;
		size: number;
	};

	let {
		taskId,
		files = [],
		coverFileId = null,
		canEdit = true
	}: {
		taskId: string;
		files?: FileRef[];
		coverFileId?: string | null;
		canEdit?: boolean;
	} = $props();

	// only files attached DIRECTLY to this task (no custom-field link)
	const attachments = $derived(files.filter((f) => f.taskId === taskId && !f.fieldId));
	const isImage = (f: FileRef) => f.mimeType.startsWith('image/');

	let uploading = $state(false);
	let dragOver = $state(false);
	let lightboxId = $state<string | null>(null);
	let fileInput = $state<HTMLInputElement | null>(null);
	let cameraInput = $state<HTMLInputElement | null>(null);

	const lightbox = $derived(lightboxId ? attachments.find((f) => f.id === lightboxId) ?? null : null);

	async function uploadFiles(list: FileList | File[]) {
		const arr = Array.from(list);
		if (arr.length === 0) return;
		uploading = true;
		try {
			for (const f of arr) {
				const fd = new FormData();
				fd.set('file', f);
				const res = await fetch(`/api/tasks/${taskId}/files`, { method: 'POST', body: fd });
				if (!res.ok) {
					const body = await res.json().catch(() => ({}));
					await confirmDialog(body.error ?? $t('Upload failed'), { confirmLabel: $t('OK') });
					break;
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
		if (!canEdit) return;
		const dropped = e.dataTransfer?.files;
		if (dropped?.length) await uploadFiles(dropped);
	}

	async function remove(f: FileRef) {
		if (!(await confirmDialog($t('Remove this attachment?'), { confirmLabel: $t('Remove'), danger: true }))) return;
		const res = await fetch(`/api/files/${f.id}`, { method: 'DELETE' });
		if (res.ok) {
			if (lightboxId === f.id) lightboxId = null;
			await invalidateAll();
		}
	}

	let coverForm = $state<HTMLFormElement | null>(null);
	let coverValue = $state('');
	function setCover(fileId: string) {
		coverValue = coverFileId === fileId ? '' : fileId;
		coverForm?.requestSubmit();
	}
</script>

<div class="att">
	<div class="att-head">
		<span class="label">{$t('Attachments')}</span>
		{#if attachments.length > 0}<span class="count">{attachments.length}</span>{/if}
	</div>

	{#if canEdit}
		<div
			class="dropzone"
			class:over={dragOver}
			role="button"
			tabindex="0"
			aria-label={$t('Add attachments')}
			ondragover={(e) => { e.preventDefault(); dragOver = true; }}
			ondragleave={() => (dragOver = false)}
			ondrop={onDrop}
			onclick={() => fileInput?.click()}
			onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput?.click(); } }}
		>
			<Icon name="cloud-upload" size={18} />
			<span>{uploading ? $t('Uploading…') : $t('Drag files here or click to upload')}</span>
		</div>

		<div class="actions">
			<button class="act" type="button" onclick={() => fileInput?.click()} disabled={uploading}>
				<Icon name="upload" size={14} /> {$t('Upload')}
			</button>
			<button class="act" type="button" onclick={() => cameraInput?.click()} disabled={uploading}>
				<Icon name="camera" size={14} /> {$t('Take photo')}
			</button>
		</div>

		<input bind:this={fileInput} type="file" multiple onchange={onPick} hidden />
		<!-- camera-capture: opens the device camera on mobile -->
		<input bind:this={cameraInput} type="file" accept="image/*" capture="environment" onchange={onPick} hidden />

		<form bind:this={coverForm} method="POST" action="?/setTaskCover" use:enhance class="hidden-form">
			<input type="hidden" name="id" value={taskId} />
			<input type="hidden" name="coverFileId" value={coverValue} />
		</form>
	{/if}

	{#if attachments.length > 0}
		<div class="gallery">
			{#each attachments as f (f.id)}
				<div class="thumb" class:is-cover={coverFileId === f.id}>
					{#if isImage(f)}
						<button class="thumb-img" type="button" onclick={() => (lightboxId = f.id)} aria-label={f.filename}>
							<img src={`/api/files/${f.id}`} alt={f.filename} loading="lazy" />
						</button>
					{:else}
						<a class="thumb-doc" href={`/api/files/${f.id}`} target="_blank" rel="noreferrer noopener" use:tooltip={f.filename}>
							<Icon name="page" size={22} />
							<span class="doc-name">{f.filename}</span>
						</a>
					{/if}
					<div class="thumb-bar">
						{#if isImage(f) && canEdit}
							<button
								class="tb-btn"
								class:on={coverFileId === f.id}
								type="button"
								aria-label={coverFileId === f.id ? $t('Remove cover') : $t('Set as cover')}
								use:tooltip={coverFileId === f.id ? $t('Cover image') : $t('Set as cover')}
								onclick={() => setCover(f.id)}
							>
								<Icon name="star" size={12} />
							</button>
						{/if}
						{#if canEdit}
							<button class="tb-btn danger" type="button" aria-label={$t('Remove')} onclick={() => remove(f)}>
								<Icon name="trash" size={12} />
							</button>
						{/if}
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

{#if lightbox}
	<div
		class="lightbox"
		role="button"
		tabindex="0"
		aria-label={$t('Close')}
		onclick={() => (lightboxId = null)}
		onkeydown={(e) => { if (e.key === 'Escape' || e.key === 'Enter') lightboxId = null; }}
	>
		<button class="lb-close" type="button" aria-label={$t('Close')} onclick={() => (lightboxId = null)}>
			<Icon name="xmark" size={20} />
		</button>
		<img class="lb-img" src={`/api/files/${lightbox.id}`} alt={lightbox.filename} />
		<span class="lb-name">{lightbox.filename}</span>
	</div>
{/if}

<style>
	.att {
		display: flex;
		flex-direction: column;
		gap: 8px;
		--img-outline: rgba(0, 0, 0, 0.1);
	}

	:global([data-theme='dark']) .att {
		--img-outline: rgba(255, 255, 255, 0.1);
	}

	.att-head {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.label {
		font-size: 12px;
		color: var(--color-muted);
	}

	.count {
		font-size: 11px;
		color: var(--color-muted);
		border: 1px solid var(--color-border-subtle);
		border-radius: 999px;
		padding: 0 6px;
		font-variant-numeric: tabular-nums;
	}

	.dropzone {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		padding: 14px;
		border: 1px dashed var(--color-border-subtle);
		border-radius: var(--radius-field, 0.25rem);
		color: var(--color-muted);
		font-size: 13px;
		cursor: pointer;
		text-align: center;
		transition: border-color var(--dur-fast), color var(--dur-fast), background var(--dur-fast);
	}

	.dropzone:hover,
	.dropzone.over {
		border-color: var(--color-link, var(--color-fg));
		color: var(--color-fg);
		background: var(--color-surface-muted);
	}

	.actions {
		display: flex;
		gap: 6px;
	}

	.act {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		font-size: 12px;
		padding: 4px 8px;
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-field, 0.25rem);
		background: none;
		color: var(--color-fg);
		cursor: pointer;
		transition: background var(--dur-fast);
	}

	.act:hover:not(:disabled) {
		background: var(--color-surface-muted);
	}

	.act:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.gallery {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(84px, 1fr));
		gap: 8px;
	}

	.thumb {
		position: relative;
		aspect-ratio: 1;
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-field, 0.25rem);
		overflow: hidden;
		background: var(--color-surface-muted);
	}

	.thumb.is-cover {
		border-color: var(--color-link, var(--color-fg));
		box-shadow: 0 0 0 1px var(--color-link, var(--color-fg));
	}

	.thumb-img {
		display: block;
		width: 100%;
		height: 100%;
		border: none;
		padding: 0;
		background: none;
		cursor: pointer;
	}

	.thumb-img img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
		outline: 1px solid var(--img-outline);
		outline-offset: -1px;
	}

	.thumb-doc {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 4px;
		width: 100%;
		height: 100%;
		padding: 6px;
		color: var(--color-fg);
		text-decoration: none;
		text-align: center;
	}

	.doc-name {
		font-size: 10px;
		line-height: 1.2;
		overflow: hidden;
		text-overflow: ellipsis;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		word-break: break-word;
	}

	.thumb-bar {
		position: absolute;
		top: 3px;
		right: 3px;
		display: flex;
		gap: 3px;
		opacity: 0;
		transition: opacity 0.12s;
	}

	.thumb:hover .thumb-bar,
	.thumb.is-cover .thumb-bar {
		opacity: 1;
	}

	.tb-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		border: none;
		border-radius: 4px;
		background: color-mix(in oklab, var(--color-bg, #000) 60%, transparent);
		color: #fff;
		cursor: pointer;
		transition: background var(--dur-fast), color var(--dur-fast);
	}

	.tb-btn:hover {
		background: color-mix(in oklab, var(--color-bg, #000) 80%, transparent);
	}

	.tb-btn.on {
		color: var(--color-warning, gold);
	}

	.tb-btn.danger:hover {
		color: var(--color-error, tomato);
	}

	.hidden-form {
		display: none;
	}

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
</style>
