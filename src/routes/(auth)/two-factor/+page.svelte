<script lang="ts">
	import { goto } from '$app/navigation';
	import { authClient } from '$lib/auth-client';

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
			error = err.message ?? 'Invalid code';
			return;
		}

		await goto('/projects');
	}
</script>

<svelte:head><title>Two-factor — Baskets</title></svelte:head>

<h3>Two-factor</h3>
<p class="u-small u-muted" style="margin-bottom: var(--sp-4);">
	{useBackup
		? 'Enter one of your backup codes.'
		: 'Enter the 6-digit code from your authenticator app.'}
</p>

{#if error}
	<div class="alert alert--error" role="alert">{error}</div>
{/if}

<form onsubmit={submit}>
	<div class="field">
		<label class="label" for="code">{useBackup ? 'Backup code' : 'Code'}</label>
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
		{loading ? 'Verifying…' : 'Verify'}
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
	{useBackup ? 'Use authenticator code' : 'Use a backup code'}
</button>
