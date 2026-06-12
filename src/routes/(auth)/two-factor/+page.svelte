<script lang="ts">
	import { goto } from '$app/navigation';
	import { authClient } from '$lib/auth-client';
	import { t } from '$lib/i18n';

	let code = $state('');
	let useBackup = $state(false);
	let error = $state('');
	let loading = $state(false);

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

		await goto('/projects');
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
	<div class="alert alert--error" role="alert">{error}</div>
{/if}

<form onsubmit={submit}>
	<div class="field">
		<label class="label" for="code">{useBackup ? $t('Backup code') : $t('Code')}</label>
		<input
			id="code"
			class="input mono"
			type="text"
			inputmode={useBackup ? 'text' : 'numeric'}
			autocomplete="one-time-code"
			placeholder={useBackup ? 'xxxxx-xxxxx' : '000000'}
			required
			bind:value={code}
		/>
	</div>
	<button class="btn btn--primary" type="submit" disabled={loading} style="width: 100%;">
		{loading ? $t('Verifying…') : $t('Verify')}
	</button>
</form>

<button
	class="btn btn--sm"
	style="margin-top: var(--sp-3);"
	onclick={() => {
		useBackup = !useBackup;
		error = '';
	}}
>
	{useBackup ? $t('Use authenticator code') : $t('Use a backup code')}
</button>
