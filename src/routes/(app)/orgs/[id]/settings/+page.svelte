<script lang="ts">
	import { enhance } from '$app/forms';
	import { browser } from '$app/environment';
	import Icon from '$lib/components/Icon.svelte';
	import { confirmDialog } from '$lib/confirm.svelte';
	import { t } from '$lib/i18n';

	let { data, form } = $props();

	let copiedId = $state<string | null>(null);

	const origin = $derived(browser ? location.origin : '');
	const inviteLink = (id: string) => `${origin}/invite/${id}`;

	async function copyLink(id: string) {
		try {
			await navigator.clipboard.writeText(inviteLink(id));
			copiedId = id;
			setTimeout(() => {
				if (copiedId === id) copiedId = null;
			}, 1500);
		} catch {
			// clipboard blocked — the link text is visible for manual copy
		}
	}

	function roleBadgeClass(role: string) {
		if (role === 'owner') return 'badge-primary';
		if (role === 'admin') return 'badge-neutral';
		return 'badge-ghost';
	}

	function canManageRow(role: string, userId: string) {
		if (!data.isManager) return false;
		if (userId === data.currentUserId) return false;
		// only an owner may edit/remove another owner
		if (role === 'owner' && !data.isOwner) return false;
		return true;
	}

	async function confirmRemove(e: MouseEvent, name: string) {
		const f = (e.currentTarget as HTMLElement).closest('form');
		if (
			await confirmDialog($t('Remove {name} from this organization?', { name }), {
				danger: true,
				confirmLabel: $t('Remove')
			})
		)
			f?.requestSubmit();
	}

	async function confirmLeave(e: MouseEvent) {
		const f = (e.currentTarget as HTMLElement).closest('form');
		if (
			await confirmDialog($t('Leave this organization? You’ll lose access to its projects.'), {
				danger: true,
				confirmLabel: $t('Leave')
			})
		)
			f?.requestSubmit();
	}

	async function confirmDelete(e: MouseEvent) {
		const f = (e.currentTarget as HTMLElement).closest('form');
		if (
			await confirmDialog($t('Delete this organization? This cannot be undone.'), {
				danger: true,
				confirmLabel: $t('Delete organization')
			})
		)
			f?.requestSubmit();
	}
</script>

<svelte:head><title>{data.org.name} — {$t('Organization settings')} — Baskets</title></svelte:head>

<p class="u-tiny" style="margin-bottom: var(--sp-2);">
	<a href="/projects" class="u-flex" style="gap: 4px;"
		><Icon name="arrow-left" size={12} /> {$t('Projects')}</a
	>
</p>

<h2 style="margin-bottom: var(--sp-4);">{$t('Organization settings')}</h2>

{#if form?.message}
	<div class="alert alert-error" role="alert">{form.message}</div>
{/if}

<!-- General -->
<div class="card section">
	<h4 style="margin-bottom: var(--sp-2);">{$t('General')}</h4>
	{#if data.isManager}
		<form method="POST" action="?/rename" use:enhance>
			<div class="field">
				<label class="label" for="orgname">{$t('Name')}</label>
				<input
					id="orgname"
					name="name"
					class="input"
					value={data.org.name}
					required
					maxlength="120"
				/>
			</div>
			<p class="u-tiny u-muted" style="margin-bottom: var(--sp-2);">
				{$t('Slug')}: <span class="mono">{data.org.slug}</span>
			</p>
			<button class="btn btn-sm btn-primary" type="submit">{$t('Save')}</button>
		</form>
	{:else}
		<p class="u-small"><strong>{$t('Name')}:</strong> {data.org.name}</p>
		<p class="u-tiny u-muted">
			<strong>{$t('Slug')}:</strong> <span class="mono">{data.org.slug}</span>
		</p>
	{/if}
</div>

<!-- Members -->
<div class="card section">
	<h4 style="margin-bottom: var(--sp-2);">{$t('Members')}</h4>
	{#each data.members as m (m.userId)}
		<div class="row">
			<span class="m-name">{m.name}</span>
			<span class="u-tiny u-muted m-email mono">{m.email}</span>
			<span style="flex: 1;"></span>
			{#if canManageRow(m.role, m.userId)}
				<form method="POST" action="?/updateRole" use:enhance>
					<input type="hidden" name="userId" value={m.userId} />
					<select
						name="role"
						class="select select-sm role-select"
						aria-label={$t('Member role')}
						onchange={(e) => e.currentTarget.form?.requestSubmit()}
					>
						<option value="member" selected={m.role === 'member'}>{$t('Member')}</option>
						<option value="admin" selected={m.role === 'admin'}>{$t('Admin')}</option>
						{#if data.isOwner}
							<option value="owner" selected={m.role === 'owner'}>{$t('Owner')}</option>
						{/if}
					</select>
				</form>
				<form method="POST" action="?/removeMember" use:enhance>
					<input type="hidden" name="userId" value={m.userId} />
					<button
						type="button"
						class="x-btn"
						aria-label={$t('Remove member')}
						onclick={(e) => confirmRemove(e, m.name)}>×</button
					>
				</form>
			{:else}
				<span class="badge {roleBadgeClass(m.role)}">{$t(m.role)}</span>
				{#if m.userId === data.currentUserId}
					<form method="POST" action="?/leave" use:enhance>
						<button type="button" class="btn btn-xs" onclick={confirmLeave}
							>{$t('Leave organization')}</button
						>
					</form>
				{/if}
			{/if}
		</div>
	{/each}
</div>

{#if data.isManager}
	<!-- Invitations -->
	<div class="card section">
		<h4 style="margin-bottom: var(--sp-2);">{$t('Invitations')}</h4>
		<p class="u-small u-muted" style="margin-bottom: var(--sp-3); text-wrap: pretty;">
			{$t(
				'Invitations are not emailed. Create one, then copy its link and send it to the person yourself.'
			)}
		</p>

		{#if form?.invited && form?.createdInviteId}
			<div class="invite-created" role="status">
				<span class="u-tiny u-muted">{$t('Invitation created. Copy and share this link:')}</span>
				<div class="link-row">
					<code class="link-text">{inviteLink(form.createdInviteId)}</code>
					<button class="btn btn-xs" type="button" onclick={() => copyLink(form.createdInviteId!)}>
						{copiedId === form.createdInviteId ? $t('Copied') : $t('Copy link')}
					</button>
				</div>
			</div>
		{/if}

		<form
			method="POST"
			action="?/invite"
			use:enhance
			class="u-flex invite-form"
			style="flex-wrap: wrap; margin-bottom: var(--sp-3);"
		>
			<input
				name="email"
				type="email"
				class="input"
				placeholder={$t('email@example.com')}
				required
				maxlength="254"
				style="flex: 1; min-width: 180px;"
			/>
			<select name="role" class="select" aria-label={$t('Invite role')} style="width: auto;">
				<option value="member">{$t('Member')}</option>
				<option value="admin">{$t('Admin')}</option>
			</select>
			<button class="btn btn-sm btn-primary" type="submit">{$t('Invite')}</button>
		</form>

		{#each data.invitations as inv (inv.id)}
			<div class="row">
				<span class="m-name mono">{inv.email}</span>
				<span class="badge {roleBadgeClass(inv.role ?? 'member')}">{$t(inv.role ?? 'member')}</span>
				<span style="flex: 1;"></span>
				<button class="btn btn-xs" type="button" onclick={() => copyLink(inv.id)}>
					{copiedId === inv.id ? $t('Copied') : $t('Copy link')}
				</button>
				<form method="POST" action="?/cancelInvite" use:enhance>
					<input type="hidden" name="invitationId" value={inv.id} />
					<button class="x-btn" type="submit" aria-label={$t('Cancel invitation')}>×</button>
				</form>
			</div>
		{:else}
			<p class="u-tiny u-muted">{$t('No pending invitations.')}</p>
		{/each}
	</div>
{/if}

{#if data.isOwner}
	<!-- Danger -->
	<div class="card section">
		<h4 style="margin-bottom: var(--sp-2);">{$t('Danger zone')}</h4>
		<p class="u-tiny u-muted" style="margin-bottom: var(--sp-2); text-wrap: pretty;">
			{$t('An organization can only be deleted when it has no workspaces. This cannot be undone.')}
		</p>
		<form method="POST" action="?/deleteOrg" use:enhance>
			<button type="button" class="btn btn-sm btn-error" onclick={confirmDelete}>
				{$t('Delete organization')}
			</button>
		</form>
	</div>
{/if}

<style>
	.section {
		max-width: 640px;
		margin-bottom: var(--sp-3);
	}

	.row {
		display: flex;
		align-items: center;
		gap: var(--sp-2);
		padding: var(--sp-1) 0;
		border-bottom: 1px solid var(--color-border-subtle);
	}

	.row:last-of-type {
		border-bottom: none;
	}

	.m-name {
		font-weight: 500;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.m-email {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		max-width: 40%;
	}

	.role-select {
		width: auto;
	}

	.invite-created {
		border: 1px solid var(--color-border-subtle);
		background: var(--color-surface-muted);
		padding: var(--sp-2);
		margin-bottom: var(--sp-3);
		border-radius: var(--radius-field, 0.25rem);
	}

	.link-row {
		display: flex;
		align-items: center;
		gap: var(--sp-2);
		margin-top: var(--sp-1);
		flex-wrap: wrap;
	}

	.link-text {
		flex: 1;
		min-width: 0;
		overflow-x: auto;
		white-space: nowrap;
		font-size: 12px;
		padding: 4px 6px;
		background: var(--color-bg);
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-field, 0.25rem);
	}

	.x-btn {
		border: none;
		background: none;
		font-size: 18px;
		line-height: 1;
		cursor: pointer;
		color: var(--color-muted);
		padding: 2px 6px;
		transition: color var(--dur-fast);
	}

	.x-btn:hover {
		color: var(--color-error);
	}

	.btn-primary {
		transition: transform var(--dur-fast);
	}

	.btn-primary:active {
		transform: scale(0.96);
	}

	@media (max-width: 720px) {
		.invite-form {
			flex-direction: column;
			align-items: stretch;
		}

		.invite-form > :global(*) {
			width: 100%;
		}

		.m-email {
			display: none;
		}
	}
</style>
