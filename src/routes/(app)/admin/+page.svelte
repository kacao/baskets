<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { slide } from 'svelte/transition';
	import { authClient } from '$lib/auth-client';

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
			error = err.message ?? 'Action failed';
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

<svelte:head><title>Users — Baskets</title></svelte:head>

<div class="u-between" style="margin-bottom: var(--sp-4); flex-wrap: wrap;">
	<h2>Users</h2>
	<button class="btn btn--primary" onclick={() => (showCreate = !showCreate)}>
		{showCreate ? 'Cancel' : '+ New user'}
	</button>
</div>

{#if error}
	<div class="alert alert--error" role="alert">{error}</div>
{/if}

{#if showCreate}
	<div class="card" style="margin-bottom: var(--sp-4); max-width: 560px;" transition:slide={{ duration: 150 }}>
		<form onsubmit={createUser}>
			<div class="field">
				<label class="label" for="n">Name</label>
				<input id="n" class="input" required bind:value={newName} />
			</div>
			<div class="field">
				<label class="label" for="e">Email</label>
				<input id="e" class="input" type="email" required bind:value={newEmail} />
			</div>
			<div class="field">
				<label class="label" for="p">Password</label>
				<input id="p" class="input" type="text" minlength="8" required bind:value={newPassword} />
				<div class="hint">Share it with the user; they can change it later.</div>
			</div>
			<div class="field">
				<label class="label" for="r">Role</label>
				<select id="r" class="select" bind:value={newRole}>
					<option value="user">user</option>
					<option value="admin">admin</option>
				</select>
			</div>
			<button class="btn btn--primary" type="submit" disabled={busy === 'create'}>
				{busy === 'create' ? 'Creating…' : 'Create user'}
			</button>
		</form>
	</div>
{/if}

<div class="table-wrap">
	<table>
		<thead>
			<tr>
				<th>Name</th>
				<th>Email</th>
				<th>Role</th>
				<th>2FA</th>
				<th>Status</th>
				<th>Actions</th>
			</tr>
		</thead>
		<tbody>
			{#each data.users as u (u.id)}
				<tr class:banned={u.banned}>
					<td>
						{u.name}
						{#if isSelf(u.id)}<span class="badge">you</span>{/if}
					</td>
					<td class="mono u-small">{u.email}</td>
					<td>
						<span class="badge" class:badge--inverted={u.role === 'admin'}>
							{u.role ?? 'user'}
						</span>
					</td>
					<td>
						<span class="badge" class:badge--success={u.twoFactorEnabled}>
							{u.twoFactorEnabled ? 'on' : 'off'}
						</span>
					</td>
					<td>
						{#if u.banned}
							<span class="badge badge--error">banned</span>
						{:else}
							<span class="badge badge--success">active</span>
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
									{u.role === 'admin' ? 'Make user' : 'Make admin'}
								</button>
								{#if u.banned}
									<button
										class="btn btn--sm"
										disabled={busy === u.id}
										onclick={() => run(u.id, () => authClient.admin.unbanUser({ userId: u.id }))}
									>
										Unban
									</button>
								{:else}
									<button
										class="btn btn--sm btn--danger"
										disabled={busy === u.id}
										onclick={() => run(u.id, () => authClient.admin.banUser({ userId: u.id }))}
									>
										Ban
									</button>
								{/if}
								<button
									class="btn btn--sm btn--danger"
									disabled={busy === u.id}
									onclick={() => {
										if (confirm(`Permanently remove ${u.email}?`))
											run(u.id, () => authClient.admin.removeUser({ userId: u.id }));
									}}
								>
									Remove
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
