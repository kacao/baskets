<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { authClient } from '$lib/auth-client';
	import { safeRedirect } from '$lib/safeRedirect';
	import { t } from '$lib/i18n';

	let code = $state('');
	let useBackup = $state(false);
	let error = $state('');
	let loading = $state(false);

	const redirectTo = $derived(safeRedirect(page.url.searchParams.get('redirect')) ?? '/projects');

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		error = '';
		loading = true;

		const { error: err } = useBackup
			? await authClient.twoFactor.verifyBackupCode({ code })
			: await authClient.twoFactor.verifyTotp({ code });

		loading = false;

		if (err) {
			error = err.message ?? $t('Invalid code');
			return;
		}

		await goto(redirectTo);
	}
</script>

<svelte:head><title>{$t('Two-factor')} — Baskets</title></svelte:head>

<h3>{$t('Two-factor')}</h3>
<p class="u-small u-muted" style="margin-bottom: var(--sp-4);">
	{useBackup
		? $t('Enter one of your backup codes.')
		: $t('Enter the 6-digit code from your authenticator app.')}
</p>

{#if error}
	<div class="alert alert-error" role="alert">{error}</div>
{/if}

<form onsubmit={submit}>
	<div class="field">
		<label class="label" for="code">{useBackup ? $t('Backup code') : $t('Code')}</label>
		<input
			id="code"
			class="input mono tabular-nums"
			type="text"
			inputmode={useBackup ? 'text' : 'numeric'}
			autocomplete="one-time-code"
			placeholder={useBackup ? 'xxxxx-xxxxx' : '000000'}
			required
			bind:value={code}
		/>
	</div>
	<button class="btn btn-primary submit-btn" type="submit" disabled={loading} style="width: 100%;">
		{loading ? $t('Verifying…') : $t('Verify')}
	</button>
</form>

<button
	class="btn btn-sm"
	style="margin-top: var(--sp-3);"
	onclick={() => {
		useBackup = !useBackup;
		error = '';
	}}
>
	{useBackup ? $t('Use authenticator code') : $t('Use a backup code')}
</button>

<style>
	.submit-btn {
		transition: transform var(--dur-fast);
	}
	.submit-btn:active:not(:disabled) {
		transform: scale(0.96);
	}
</style>
