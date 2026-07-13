<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { authClient } from '$lib/auth-client';
	import { safeRedirect } from '$lib/safeRedirect';
	import { t } from '$lib/i18n';

	let name = $state('');
	let email = $state('');
	let password = $state('');
	let error = $state('');
	let loading = $state(false);

	// same-origin post-register destination (e.g. an /invite/<id> deep link)
	const redirectTo = $derived(safeRedirect(page.url.searchParams.get('redirect')) ?? '/projects');
	const loginHref = $derived(
		page.url.searchParams.get('redirect')
			? `/login?redirect=${encodeURIComponent(redirectTo)}`
			: '/login'
	);

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		error = '';
		loading = true;

		const { error: err } = await authClient.signUp.email({
			name,
			email,
			password
		});

		loading = false;

		if (err) {
			error = err.message ?? $t('Registration failed');
			return;
		}

		await goto(redirectTo);
	}
</script>

<svelte:head><title>{$t('Register')} — Baskets</title></svelte:head>

<h3>{$t('Register')}</h3>
<p class="u-small u-muted" style="margin-bottom: var(--sp-4);">{$t('Create your account.')}</p>

{#if error}
	<div class="alert alert-error" role="alert">{error}</div>
{/if}

<form onsubmit={submit}>
	<div class="field">
		<label class="label" for="name">{$t('Name')}</label>
		<input id="name" class="input" type="text" autocomplete="name" required bind:value={name} />
	</div>
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
			autocomplete="new-password"
			minlength="8"
			required
			bind:value={password}
		/>
		<div class="hint">{$t('Minimum 8 characters')}</div>
	</div>
	<button class="btn btn-primary" type="submit" disabled={loading} style="width: 100%;">
		{loading ? $t('Creating…') : $t('Create account')}
	</button>
</form>

<p class="u-small" style="margin-top: var(--sp-3);">
	{$t('Already registered?')} <a href={loginHref}>{$t('Sign in')}</a>
</p>

<style>
	.btn-primary {
		transition: transform var(--dur-fast);
	}
	.btn-primary:active:not(:disabled) {
		transform: scale(0.96);
	}
</style>
