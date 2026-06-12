<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { enhance } from '$app/forms';
	import { slide } from 'svelte/transition';
	import QRCode from 'qrcode';
	import { authClient } from '$lib/auth-client';

	let { data, form } = $props();

	let keyLoading = $state(false);
	let copied = $state(false);

	async function copyToken() {
		if (!form?.token) return;
		await navigator.clipboard.writeText(form.token);
		copied = true;
		setTimeout(() => (copied = false), 1500);
	}

	function fmtDate(d: Date | null) {
		return d ? new Date(d).toLocaleDateString() : 'never';
	}

	let step = $state<'idle' | 'password' | 'scan' | 'disable'>('idle');
	let password = $state('');
	let code = $state('');
	let qrDataUrl = $state('');
	let backupCodes = $state<string[]>([]);
	let error = $state('');
	let success = $state('');
	let loading = $state(false);

	const twoFactorOn = $derived(Boolean(data.user?.twoFactorEnabled));

	async function startEnable(e: SubmitEvent) {
		e.preventDefault();
		error = '';
		loading = true;

		const { data: res, error: err } = await authClient.twoFactor.enable({ password });
		loading = false;
		password = '';

		if (err || !res) {
			error = err?.message ?? 'Could not start 2FA setup';
			return;
		}

		backupCodes = res.backupCodes ?? [];
		qrDataUrl = await QRCode.toDataURL(res.totpURI, {
			margin: 1,
			width: 220,
			color: { dark: '#000000', light: '#ffffff' }
		});
		step = 'scan';
	}

	async function confirmEnable(e: SubmitEvent) {
		e.preventDefault();
		error = '';
		loading = true;

		const { error: err } = await authClient.twoFactor.verifyTotp({ code });
		loading = false;

		if (err) {
			error = err.message ?? 'Invalid code — try again';
			return;
		}

		step = 'idle';
		code = '';
		success = 'Two-factor authentication is now enabled. Store your backup codes safely.';
		await invalidateAll();
	}

	async function disable(e: SubmitEvent) {
		e.preventDefault();
		error = '';
		loading = true;

		const { error: err } = await authClient.twoFactor.disable({ password });
		loading = false;
		password = '';

		if (err) {
			error = err.message ?? 'Could not disable 2FA';
			return;
		}

		step = 'idle';
		backupCodes = [];
		success = 'Two-factor authentication disabled.';
		await invalidateAll();
	}
</script>

<svelte:head><title>Settings — Baskets</title></svelte:head>

<h2 style="margin-bottom: var(--sp-4);">Settings</h2>

<div class="card" style="max-width: 560px; margin-bottom: var(--sp-4);">
	<h4 style="margin-bottom: var(--sp-2);">Account</h4>
	<p class="u-small"><strong>Name:</strong> {data.user?.name}</p>
	<p class="u-small"><strong>Email:</strong> <span class="mono">{data.user?.email}</span></p>
	<p class="u-small"><strong>Role:</strong> {data.user?.role ?? 'user'}</p>
</div>

<div class="card" style="max-width: 560px;">
	<div class="u-between" style="margin-bottom: var(--sp-2);">
		<h4>Two-factor authentication</h4>
		<span class="badge" class:badge--success={twoFactorOn}>
			{twoFactorOn ? 'ON' : 'OFF'}
		</span>
	</div>
	<p class="u-small u-muted" style="margin-bottom: var(--sp-3);">
		Add a second step at sign-in using an authenticator app such as Google Authenticator, 1Password
		or Authy.
	</p>

	{#if error}
		<div class="alert alert--error" role="alert">{error}</div>
	{/if}
	{#if success}
		<div class="alert alert--success" role="status">{success}</div>
	{/if}

	{#if step === 'idle'}
		{#if twoFactorOn}
			<button class="btn btn--danger" onclick={() => { step = 'disable'; success = ''; }}>
				Disable 2FA
			</button>
		{:else}
			<button class="btn btn--primary" onclick={() => { step = 'password'; success = ''; }}>
				Enable 2FA
			</button>
		{/if}
	{/if}

	{#if step === 'password' || step === 'disable'}
		<form
			onsubmit={step === 'disable' ? disable : startEnable}
			transition:slide={{ duration: 150 }}
		>
			<div class="field">
				<label class="label" for="pw">Confirm your password</label>
				<input
					id="pw"
					class="input"
					type="password"
					autocomplete="current-password"
					required
					bind:value={password}
				/>
			</div>
			<div class="u-flex">
				<button class="btn btn--primary" type="submit" disabled={loading}>
					{loading ? 'Working…' : 'Continue'}
				</button>
				<button class="btn" type="button" onclick={() => { step = 'idle'; error = ''; }}>
					Cancel
				</button>
			</div>
		</form>
	{/if}

	{#if step === 'scan'}
		<div transition:slide={{ duration: 150 }}>
			<p class="u-small" style="margin-bottom: var(--sp-2);">
				<strong>1.</strong> Scan this QR code with your authenticator app:
			</p>
			{#if qrDataUrl}
				<img src={qrDataUrl} alt="TOTP QR code" class="qr" />
			{/if}

			{#if backupCodes.length > 0}
				<p class="u-small" style="margin: var(--sp-3) 0 var(--sp-1);">
					<strong>2.</strong> Save these one-time backup codes:
				</p>
				<div class="codes mono">
					{#each backupCodes as bc (bc)}
						<span>{bc}</span>
					{/each}
				</div>
			{/if}

			<form onsubmit={confirmEnable} style="margin-top: var(--sp-3);">
				<div class="field">
					<label class="label" for="totp">
						<strong>3.</strong> Enter the 6-digit code to confirm
					</label>
					<input
						id="totp"
						class="input mono"
						inputmode="numeric"
						placeholder="000000"
						required
						bind:value={code}
					/>
				</div>
				<div class="u-flex">
					<button class="btn btn--primary" type="submit" disabled={loading}>
						{loading ? 'Verifying…' : 'Verify & enable'}
					</button>
					<button class="btn" type="button" onclick={() => { step = 'idle'; error = ''; }}>
						Cancel
					</button>
				</div>
			</form>
		</div>
	{/if}
</div>

<div class="card" style="max-width: 560px; margin-top: var(--sp-4);">
	<h4 style="margin-bottom: var(--sp-2);">API keys</h4>
	<p class="u-small u-muted" style="margin-bottom: var(--sp-3);">
		Use API keys to call the REST API: <span class="mono">Authorization: Bearer bsk_…</span>
		A key acts as your user. Keys are shown once — store them safely.
	</p>

	{#if form?.message}
		<div class="alert alert--error" role="alert">{form.message}</div>
	{/if}

	{#if form?.token}
		<div class="token-reveal" transition:slide={{ duration: 150 }}>
			<p class="u-small"><strong>{form.keyName}</strong> created. Copy the key now — it will not be shown again:</p>
			<div class="u-flex" style="margin-top: var(--sp-1);">
				<code class="mono token">{form.token}</code>
				<button class="btn btn--sm" type="button" onclick={copyToken}>
					{copied ? 'Copied' : 'Copy'}
				</button>
			</div>
		</div>
	{/if}

	{#if data.apiKeys.length > 0}
		<table class="keys">
			<thead>
				<tr><th>Name</th><th>Key</th><th>Last used</th><th></th></tr>
			</thead>
			<tbody>
				{#each data.apiKeys as key (key.id)}
					<tr>
						<td>{key.name}</td>
						<td class="mono">{key.prefix}…</td>
						<td>{fmtDate(key.lastUsedAt)}</td>
						<td>
							<form
								method="POST"
								action="?/revokeKey"
								use:enhance={() => async ({ update }) => update()}
							>
								<input type="hidden" name="id" value={key.id} />
								<button class="btn btn--sm btn--danger" type="submit">Revoke</button>
							</form>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}

	<form
		method="POST"
		action="?/createKey"
		use:enhance={() => {
			keyLoading = true;
			return async ({ update }) => {
				keyLoading = false;
				await update();
			};
		}}
		style="margin-top: var(--sp-3);"
	>
		<div class="field">
			<label class="label" for="key-name">Key name</label>
			<input
				id="key-name"
				class="input"
				name="name"
				placeholder="e.g. CI script"
				maxlength="60"
				required
			/>
		</div>
		<button class="btn btn--primary" type="submit" disabled={keyLoading}>
			{keyLoading ? 'Creating…' : 'Create API key'}
		</button>
	</form>
</div>

<style>
	.token-reveal {
		border: 1px solid var(--color-border-subtle);
		background: var(--color-surface-muted);
		padding: var(--sp-2);
		margin-bottom: var(--sp-3);
	}

	.token {
		font-size: 12px;
		word-break: break-all;
		flex: 1;
	}

	.keys {
		width: 100%;
		border-collapse: collapse;
		font-size: 13px;
	}

	.keys th {
		text-align: left;
		text-transform: var(--label-transform);
		letter-spacing: var(--label-tracking);
		font-size: 12px;
		font-weight: 500;
		color: var(--color-muted);
		border-bottom: 1px solid var(--color-fg);
		padding: var(--sp-1);
	}

	.keys td {
		border-bottom: 1px solid var(--color-border-subtle);
		padding: var(--sp-1);
	}

	.qr {
		border: 1px solid var(--color-border-subtle);
		display: block;
	}

	.codes {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
		gap: var(--sp-1) var(--sp-2);
		border: 1px solid var(--color-border-subtle);
		background: var(--color-surface-muted);
		padding: var(--sp-2);
		font-size: 13px;
	}
</style>
