<script lang="ts">
	import { enhance } from '$app/forms';
	import { t } from '$lib/i18n';

	let { data, form } = $props();

	const acceptHref = $derived(encodeURIComponent(data.redirectParam));
</script>

<svelte:head><title>{$t('Invitation')} — Baskets</title></svelte:head>

<div class="invite-shell">
	<div class="invite-box">
		<div class="invite-logo"><span class="invite-logo-mark">Baskets</span></div>

		{#if form?.message}
			<div class="alert alert-error" role="alert">{form.message}</div>
		{/if}

		{#if data.state === 'signed-out'}
			<h3>{$t('You’ve been invited')}</h3>
			<p class="u-small u-muted intro">
				{$t('Join {org} on Baskets.', { org: data.orgName })}
			</p>
			<p class="u-small u-muted intro">
				{$t('Sign in or create an account to accept this invitation.')}
			</p>
			<div class="actions">
				<a class="btn btn-primary" href="/login?redirect={acceptHref}">{$t('Sign in')}</a>
				<a class="btn" href="/register?redirect={acceptHref}">{$t('Register')}</a>
			</div>
		{:else if data.state === 'wrong-email'}
			<h3>{$t('Wrong account')}</h3>
			<p class="u-small u-muted intro">
				{$t('This invitation is for {email}.', { email: data.invitedEmailMasked ?? '' })}
			</p>
			<p class="u-small u-muted intro">
				{$t('Sign out and sign in with that address to accept it.')}
			</p>
		{:else if data.state === 'ready'}
			<h3>{$t('Accept invitation')}</h3>
			<p class="u-small u-muted intro">
				{$t('Join {org} on Baskets.', { org: data.orgName })}
			</p>
			<form method="POST" action="?/accept" use:enhance>
				<button class="btn btn-primary" type="submit" style="width: 100%;">
					{$t('Accept invitation')}
				</button>
			</form>
		{:else if data.state === 'expired'}
			<h3>{$t('Invitation expired')}</h3>
			<p class="u-small u-muted intro">
				{$t('This invitation to {org} has expired. Ask an organization admin to send a new one.', {
					org: data.orgName
				})}
			</p>
		{:else if data.state === 'accepted'}
			<h3>{$t('Already accepted')}</h3>
			<p class="u-small u-muted intro">
				{$t('This invitation to {org} has already been accepted.', { org: data.orgName })}
			</p>
			<div class="actions">
				<a class="btn btn-primary" href="/projects">{$t('Go to Baskets')}</a>
			</div>
		{:else}
			<h3>{$t('Invitation unavailable')}</h3>
			<p class="u-small u-muted intro">
				{$t('This invitation to {org} is no longer valid.', { org: data.orgName })}
			</p>
		{/if}
	</div>
</div>

<style>
	.invite-shell {
		min-height: 100vh;
		min-height: 100dvh;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: max(var(--sp-4), env(safe-area-inset-top)) max(var(--sp-3), env(safe-area-inset-right))
			max(var(--sp-4), env(safe-area-inset-bottom)) max(var(--sp-3), env(safe-area-inset-left));
		background: var(--color-bg);
	}

	.invite-box {
		width: 100%;
		max-width: 420px;
		border: 1px solid var(--color-border-subtle);
		background: var(--color-bg);
		padding: var(--sp-5) var(--sp-4);
		box-shadow:
			0 1px 2px color-mix(in srgb, var(--color-base-content) 6%, transparent),
			0 8px 24px color-mix(in srgb, var(--color-base-content) 8%, transparent);
		animation: drop-in 0.18s ease-out;
	}

	@keyframes drop-in {
		from {
			transform: translateY(-12px);
			opacity: 0;
		}
		to {
			transform: translateY(0);
			opacity: 1;
		}
	}

	.invite-logo {
		margin-bottom: var(--sp-4);
	}

	.invite-logo-mark {
		font-family: var(--font-headline);
		font-size: 24px;
		font-weight: 700;
		letter-spacing: var(--heading-tracking);
		color: var(--color-fg);
		display: inline-block;
	}

	.intro {
		margin-bottom: var(--sp-3);
		text-wrap: pretty;
	}

	.actions {
		display: flex;
		gap: var(--sp-2);
		flex-wrap: wrap;
	}

	@media (max-width: 720px) {
		.invite-box {
			padding: var(--sp-4) var(--sp-3);
		}

		.actions {
			flex-direction: column;
		}

		.actions :global(.btn) {
			width: 100%;
		}
	}
</style>
