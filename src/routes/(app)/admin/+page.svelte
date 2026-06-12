<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { slide } from 'svelte/transition';
	import { authClient } from '$lib/auth-client';
	import { t } from '$lib/i18n';

	let { data } = $props();

	let showCreate = $state(false);
	let newName = $state('');
	let newEmail = $state('');
	let newPassword = $state('');
	let newRole = $state<'user' | 'admin'>('user');
	let error = $state('');
	let busy = $state('');

	async function run(id: string, fn: () => Promise<{ error: { message?: string } | null }>) {
		error = '';
		busy = id;
		const { error: err } = await fn();
		busy = '';
		if (err) {
			error = err.message ?? $t('Action failed');
			return;
		}
		await invalidateAll();
	}

	async function createUser(e: SubmitEvent) {
		e.preventDefault();
		await run('create', () =>
			authClient.admin.createUser({
				name: newName,
				email: newEmail,
				password: newPassword,
				role: newRole
			})
		);
		if (!error) {
			showCreate = false;
			newName = newEmail = newPassword = '';
			newRole = 'user';
		}
	}

	function isSelf(id: string) {
		return id === data.user?.id;
	}
</script>

<svelte:head><title>{$t('Users')} — Baskets</title></svelte:head>

<div class="u-between" style="margin-bottom: var(--sp-4); flex-wrap: wrap;">
	<h2>{$t('Users')}</h2>
	<button class="btn btn--primary" onclick={() => (showCreate = !showCreate)}>
		{showCreate ? $t('Cancel') : $t('+ New user')}
	</button>
</div>

{#if error}
	<div class="alert alert--error" role="alert">{error}</div>
{/if}

{#if showCreate}
	<div class="card" style="margin-bottom: var(--sp-4); max-width: 560px;" transition:slide={{ duration: 150 }}>
		<form onsubmit={createUser}>
			<div class="field">
				<label class="label" for="n">{$t('Name')}</label>
				<input id="n" class="input" required bind:value={newName} />
			</div>
			<div class="field">
				<label class="label" for="e">{$t('Email')}</label>
				<input id="e" class="input" type="email" required bind:value={newEmail} />
			</div>
			<div class="field">
				<label class="label" for="p">{$t('Password')}</label>
				<input id="p" class="input" type="text" minlength="8" required bind:value={newPassword} />
				<div class="hint">{$t('Share it with the user; they can change it later.')}</div>
			</div>
			<div class="field">
				<label class="label" for="r">{$t('Role')}</label>
				<select id="r" class="select" bind:value={newRole}>
					<option value="user">{$t('user')}</option>
					<option value="admin">{$t('admin')}</option>
				</select>
			</div>
			<button class="btn btn--primary" type="submit" disabled={busy === 'create'}>
				{busy === 'create' ? $t('Creating…') : $t('Create user')}
			</button>
		</form>
	</div>
{/if}

<div class="table-wrap">
	<table>
		<thead>
			<tr>
				<th>{$t('Name')}</th>
				<th>{$t('Email')}</th>
				<th>{$t('Role')}</th>
				<th>2FA</th>
				<th>{$t('Status')}</th>
				<th>{$t('Actions')}</th>
			</tr>
		</thead>
		<tbody>
			{#each data.users as u (u.id)}
				<tr class:banned={u.banned}>
					<td>
						{u.name}
						{#if isSelf(u.id)}<span class="badge">{$t('you')}</span>{/if}
					</td>
					<td class="mono u-small">{u.email}</td>
					<td>
						<span class="badge" class:badge--inverted={u.role === 'admin'}>
							{$t(u.role ?? 'user')}
						</span>
					</td>
					<td>
						<span class="badge" class:badge--success={u.twoFactorEnabled}>
							{u.twoFactorEnabled ? $t('on') : $t('off')}
						</span>
					</td>
					<td>
						{#if u.banned}
							<span class="badge badge--error">{$t('banned')}</span>
						{:else}
							<span class="badge badge--success">{$t('active')}</span>
						{/if}
					</td>
					<td>
						{#if !isSelf(u.id)}
							<div class="u-flex" style="flex-wrap: wrap;">
								<button
									class="btn btn--sm"
									disabled={busy === u.id}
									onclick={() =>
										run(u.id, () =>
											authClient.admin.setRole({
												userId: u.id,
												role: u.role === 'admin' ? 'user' : 'admin'
											})
										)}
								>
									{u.role === 'admin' ? $t('Make user') : $t('Make admin')}
								</button>
								{#if u.banned}
									<button
										class="btn btn--sm"
										disabled={busy === u.id}
										onclick={() => run(u.id, () => authClient.admin.unbanUser({ userId: u.id }))}
									>
										{$t('Unban')}
									</button>
								{:else}
									<button
										class="btn btn--sm btn--danger"
										disabled={busy === u.id}
										onclick={() => run(u.id, () => authClient.admin.banUser({ userId: u.id }))}
									>
										{$t('Ban')}
									</button>
								{/if}
								<button
									class="btn btn--sm btn--danger"
									disabled={busy === u.id}
									onclick={() => {
										if (confirm($t('Permanently remove {email}?', { email: u.email })))
											run(u.id, () => authClient.admin.removeUser({ userId: u.id }));
									}}
								>
									{$t('Remove')}
								</button>
							</div>
						{/if}
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>

<style>
	.table-wrap {
		border: var(--border-width) solid var(--color-border-subtle);
		overflow-x: auto;
	}

	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 14px;
	}

	th {
		font-family: var(--font-body);
		font-size: 12px;
		font-weight: 500;
		text-transform: var(--label-transform);
		letter-spacing: var(--label-tracking);
		text-align: left;
		color: var(--color-muted);
		border-bottom: 1px solid var(--color-fg);
		padding: var(--sp-2) var(--sp-3);
		white-space: nowrap;
	}

	td {
		padding: var(--sp-2) var(--sp-3);
		border-bottom: 1px solid var(--color-border-subtle);
		vertical-align: middle;
	}

	tr:last-child td {
		border-bottom: none;
	}

	tr.banned td {
		background: var(--color-surface-muted);
		color: var(--color-muted);
	}
</style>
