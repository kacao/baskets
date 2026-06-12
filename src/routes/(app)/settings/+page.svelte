<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { slide } from 'svelte/transition';
	import QRCode from 'qrcode';
	import { authClient } from '$lib/auth-client';

	let { data } = $props();

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

<style>
	.qr {
		border: var(--border-width) solid var(--color-fg);
		display: block;
	}

	.codes {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
		gap: var(--sp-1) var(--sp-2);
		border: 2px dashed var(--color-fg);
		padding: var(--sp-2);
		font-size: 13px;
	}
</style>
