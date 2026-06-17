<script lang="ts">
	import { page } from '$app/state';
	import Icon from '$lib/components/Icon.svelte';
	import { confirmDialog } from '$lib/confirm.svelte';
	import { t } from '$lib/i18n';
	import { tooltip } from '$lib/tooltip';

	let { taskId }: { taskId: string } = $props();

	type Comment = {
		id: string;
		taskId: string;
		authorId: string;
		authorName: string | null;
		body: string;
		createdAt: string;
		updatedAt: string;
		edited: boolean;
	};
	type Activity = {
		id: string;
		taskId: string | null;
		actorId: string;
		actorName: string | null;
		type: string;
		data: Record<string, unknown>;
		createdAt: string;
	};
	type FeedItem =
		| ({ kind: 'comment' } & Comment)
		| ({ kind: 'activity' } & Activity);

	const currentUserId = $derived((page.data.user as { id?: string } | undefined)?.id ?? null);
	const isAdmin = $derived((page.data.user as { role?: string } | undefined)?.role === 'admin');

	let comments = $state<Comment[]>([]);
	let activity = $state<Activity[]>([]);
	let loading = $state(true);
	let loadError = $state<string | null>(null);

	let draft = $state('');
	let submitting = $state(false);

	let editingId = $state<string | null>(null);
	let editDraft = $state('');

	// merged, chronological (oldest → newest); comments rendered alongside the audit trail
	const feed = $derived<FeedItem[]>(
		[
			...comments.map((c) => ({ kind: 'comment' as const, ...c })),
			// the 'comment' activity rows duplicate the comment itself — hide them
			...activity
				.filter((a) => a.type !== 'comment')
				.map((a) => ({ kind: 'activity' as const, ...a }))
		].sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt))
	);

	async function load() {
		loading = true;
		loadError = null;
		try {
			const res = await fetch(`/api/tasks/${taskId}/comments`);
			if (!res.ok) throw new Error(String(res.status));
			const data = await res.json();
			comments = data.comments ?? [];
			activity = data.activity ?? [];
		} catch {
			loadError = $t('Could not load comments');
		} finally {
			loading = false;
		}
	}

	// reload whenever the selected task changes
	$effect(() => {
		taskId;
		load();
	});

	async function addComment(e: SubmitEvent) {
		e.preventDefault();
		const body = draft.trim();
		if (!body || submitting) return;
		submitting = true;
		try {
			const res = await fetch(`/api/tasks/${taskId}/comments`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ body })
			});
			if (!res.ok) throw new Error();
			const { comment } = await res.json();
			comments = [...comments, comment];
			draft = '';
		} catch {
			loadError = $t('Could not post comment');
		} finally {
			submitting = false;
		}
	}

	function startEdit(c: Comment) {
		editingId = c.id;
		editDraft = c.body;
	}
	function cancelEdit() {
		editingId = null;
		editDraft = '';
	}

	async function saveEdit(id: string) {
		const body = editDraft.trim();
		if (!body) return;
		try {
			const res = await fetch(`/api/comments/${id}`, {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ body })
			});
			if (!res.ok) throw new Error();
			const { comment } = await res.json();
			comments = comments.map((c) => (c.id === id ? comment : c));
			cancelEdit();
		} catch {
			loadError = $t('Could not save comment');
		}
	}

	async function removeComment(id: string) {
		if (!(await confirmDialog($t('Delete this comment?'), { confirmLabel: $t('Delete'), danger: true })))
			return;
		try {
			const res = await fetch(`/api/comments/${id}`, { method: 'DELETE' });
			if (!res.ok && res.status !== 204) throw new Error();
			comments = comments.filter((c) => c.id !== id);
		} catch {
			loadError = $t('Could not delete comment');
		}
	}

	function canManage(authorId: string) {
		return authorId === currentUserId || isAdmin;
	}

	function relTime(iso: string): string {
		const then = new Date(iso).getTime();
		const diff = Date.now() - then;
		const s = Math.round(diff / 1000);
		if (s < 45) return $t('just now');
		const m = Math.round(s / 60);
		if (m < 60) return $t('{n}m ago', { n: m });
		const h = Math.round(m / 60);
		if (h < 24) return $t('{n}h ago', { n: h });
		const d = Math.round(h / 24);
		if (d < 7) return $t('{n}d ago', { n: d });
		return new Date(iso).toISOString().slice(0, 10);
	}

	function initials(name: string | null): string {
		if (!name) return '?';
		return name
			.split(/\s+/)
			.slice(0, 2)
			.map((p) => p[0]?.toUpperCase() ?? '')
			.join('');
	}

	function activityText(a: Activity): string {
		const d = a.data;
		const to = typeof d.to === 'string' ? d.to : null;
		switch (a.type) {
			case 'created':
				return $t('created this task');
			case 'status':
				return to ? $t('changed status to {v}', { v: to }) : $t('changed the status');
			case 'assignee':
				return to ? $t('assigned to {v}', { v: to }) : $t('changed the assignee');
			case 'milestone':
				return to ? $t('set milestone to {v}', { v: to }) : $t('changed the milestone');
			case 'priority':
				return to ? $t('set priority to {v}', { v: to }) : $t('changed the priority');
			case 'due':
				return to ? $t('set due date to {v}', { v: to }) : $t('changed the due date');
			case 'title':
				return $t('renamed this task');
			case 'parent':
				return d.to ? $t('moved to another task') : $t('removed from its parent');
			default:
				return $t('updated this task');
		}
	}
</script>

<div class="section comments">
	<span class="label">{$t('Activity')}</span>

	{#if loading}
		<p class="u-tiny u-muted">{$t('Loading…')}</p>
	{:else}
		{#if loadError}
			<p class="err">{loadError}</p>
		{/if}

		<div class="feed">
			{#each feed as item (item.kind + item.id)}
				{#if item.kind === 'comment'}
					<div class="cmt">
						<span class="avatar" aria-hidden="true">{initials(item.authorName)}</span>
						<div class="cmt-body">
							<div class="cmt-head">
								<span class="author">{item.authorName ?? $t('Unknown')}</span>
								<span class="time" use:tooltip={new Date(item.createdAt).toLocaleString()}>
									{relTime(item.createdAt)}{#if item.edited}&nbsp;· {$t('edited')}{/if}
								</span>
								{#if canManage(item.authorId)}
									<span class="spacer"></span>
									{#if editingId !== item.id}
										<button class="icon-btn" type="button" aria-label={$t('Edit')} onclick={() => startEdit(item)}>
											<Icon name="edit-pencil" size={13} />
										</button>
										<button class="icon-btn" type="button" aria-label={$t('Delete')} onclick={() => removeComment(item.id)}>
											<Icon name="trash" size={13} />
										</button>
									{/if}
								{/if}
							</div>
							{#if editingId === item.id}
								<textarea class="textarea" rows="3" bind:value={editDraft}></textarea>
								<div class="edit-actions">
									<button class="btn btn-sm" type="button" onclick={cancelEdit}>{$t('Cancel')}</button>
									<button class="btn btn-sm btn-primary" type="button" onclick={() => saveEdit(item.id)}>{$t('Save')}</button>
								</div>
							{:else}
								<p class="cmt-text">{item.body}</p>
							{/if}
						</div>
					</div>
				{:else}
					<div class="act">
						<Icon name="git-commit" size={12} />
						<span class="act-text">
							<strong>{item.actorName ?? $t('Someone')}</strong>
							{activityText(item)}
						</span>
						<span class="time" use:tooltip={new Date(item.createdAt).toLocaleString()}>{relTime(item.createdAt)}</span>
					</div>
				{/if}
			{:else}
				<p class="u-tiny u-muted">{$t('No activity yet')}</p>
			{/each}
		</div>
	{/if}

	<form class="add" onsubmit={addComment}>
		<textarea
			class="textarea"
			rows="2"
			placeholder={$t('Add a comment…')}
			aria-label={$t('Add a comment')}
			bind:value={draft}
			onkeydown={(e) => {
				if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') e.currentTarget.form?.requestSubmit();
			}}
		></textarea>
		<div class="add-actions">
			<button class="btn btn-sm btn-primary" type="submit" disabled={!draft.trim() || submitting}>
				{$t('Comment')}
			</button>
		</div>
	</form>
</div>

<style>
	.section {
		border-top: 1px solid var(--color-border-subtle);
		padding-top: var(--sp-2);
		margin-top: var(--sp-2);
	}

	.label {
		display: block;
		font-size: 11px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--color-muted);
		margin-bottom: var(--sp-2);
	}

	.feed {
		display: flex;
		flex-direction: column;
		gap: var(--sp-2);
		margin-bottom: var(--sp-3);
	}

	.cmt {
		display: flex;
		gap: var(--sp-2);
	}

	.avatar {
		flex: 0 0 24px;
		width: 24px;
		height: 24px;
		border-radius: 50%;
		background: var(--color-surface-muted);
		color: var(--color-fg);
		font-size: 10px;
		font-weight: 600;
		display: flex;
		align-items: center;
		justify-content: center;
		text-transform: uppercase;
	}

	.cmt-body {
		flex: 1;
		min-width: 0;
	}

	.cmt-head {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-bottom: 2px;
	}

	.author {
		font-size: 13px;
		font-weight: 600;
	}

	.time {
		font-size: 11px;
		color: var(--color-muted);
	}

	.spacer {
		flex: 1;
	}

	.icon-btn {
		border: none;
		background: none;
		color: var(--color-muted);
		cursor: pointer;
		padding: 2px;
		line-height: 0;
	}

	.icon-btn:hover {
		color: var(--color-fg);
	}

	.cmt-text {
		font-size: 13px;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		margin: 0;
	}

	.act {
		display: flex;
		align-items: center;
		gap: 8px;
		color: var(--color-muted);
		padding-left: 6px;
	}

	.act-text {
		flex: 1;
		font-size: 12px;
		overflow-wrap: anywhere;
	}

	.act-text strong {
		color: var(--color-fg);
		font-weight: 600;
	}

	.textarea {
		width: 100%;
	}

	.edit-actions,
	.add-actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--sp-1);
		margin-top: var(--sp-1);
	}

	.add {
		margin-top: var(--sp-1);
	}

	.err {
		color: var(--color-error, #dc2626);
		font-size: 12px;
		margin-bottom: var(--sp-2);
	}
</style>
