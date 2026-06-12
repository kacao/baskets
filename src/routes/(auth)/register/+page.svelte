<script lang="ts">
	import { goto } from '$app/navigation';
	import { authClient } from '$lib/auth-client';

	let name = $state('');
	let email = $state('');
	let password = $state('');
	let error = $state('');
	let loading = $state(false);

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
			error = err.message ?? 'Registration failed';
			return;
		}

		await goto('/projects');
	}
</script>

<svelte:head><title>Register — Baskets</title></svelte:head>

<h3>Register</h3>
<p class="u-small u-muted" style="margin-bottom: var(--sp-4);">Create your account.</p>

{#if error}
	<div class="alert alert--error" role="alert">{error}</div>
{/if}

<form onsubmit={submit}>
	<div class="field">
		<label class="label" for="name">Name</label>
		<input id="name" class="input" type="text" autocomplete="name" required bind:value={name} />
	</div>
	<div class="field">
		<label class="label" for="email">Email</label>
		<input
			id="email"
			class="input"
			type="email"
			autocomplete="email"
			required
			bind:value={email}
		/>
	</div>
	<div class="field">
		<label class="label" for="password">Password</label>
		<input
			id="password"
			class="input"
			type="password"
			autocomplete="new-password"
			minlength="8"
			required
			bind:value={password}
		/>
		<div class="hint">Minimum 8 characters</div>
	</div>
	<button class="btn btn--primary" type="submit" disabled={loading} style="width: 100%;">
		{loading ? 'Creating…' : 'Create account'}
	</button>
</form>

<p class="u-small" style="margin-top: var(--sp-3);">
	Already registered? <a href="/login">Sign in</a>
</p>
