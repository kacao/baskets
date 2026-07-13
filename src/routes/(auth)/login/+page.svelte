<script lang="ts">
	import { goto } from '$app/navigation';
	import { authClient } from '$lib/auth-client';
	import { t } from '$lib/i18n';

	let email = $state('');
	let password = $state('');
	let error = $state('');
	let loading = $state(false);

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		error = '';
		loading = true;

		const { data, error: err } = await authClient.signIn.email({
			email,
			password
		});

		loading = false;

		if (err) {
			error = err.message ?? $t('Sign in failed');
			return;
		}

		// twoFactor plugin: if 2FA is enabled, the response asks for a TOTP code
		if ((data as { twoFactorRedirect?: boolean })?.twoFactorRedirect) {
			await goto('/two-factor');
			return;
		}

		await goto('/projects');
	}
</script>

<svelte:head><title>{$t('Sign in')} — Baskets</title></svelte:head>

<h3>{$t('Sign in')}</h3>
<p class="u-small u-muted" style="margin-bottom: var(--sp-4);">
	{$t('Project management without the polish.')}
</p>

{#if error}
	<div class="alert alert-error" role="alert">{error}</div>
{/if}

<form onsubmit={submit}>
	<div class="field">
		<label class="label" for="email">{$t('Email')}</label>
		<input id="email" class="input" type="email" autocomplete="email" required bind:value={email} />
	</div>
	<div class="field">
		<label class="label" for="password">{$t('Password')}</label>
		<input
			id="password"
			class="input"
			type="password"
			autocomplete="current-password"
			required
			bind:value={password}
		/>
	</div>
	<button class="btn btn-primary submit" type="submit" disabled={loading} style="width: 100%;">
		{loading ? $t('Signing in…') : $t('Sign in')}
	</button>
</form>

<p class="u-small" style="margin-top: var(--sp-3);">
	{$t('No account?')} <a href="/register">{$t('Register')}</a>
</p>

<style>
	.submit {
		transition: transform var(--dur-fast);
	}
	.submit:active:not(:disabled) {
		transform: scale(0.96);
	}
</style>
