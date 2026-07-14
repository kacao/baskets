<script lang="ts">
	import { enhance } from '$app/forms';
	import { t } from '$lib/i18n';

	let { data, form } = $props();
	let submitting = $state(false);
</script>

<svelte:head><title>{$t('Create organization')} — Baskets</title></svelte:head>

<div class="onboard">
	<div class="onboard-card">
		<h2 class="onboard-title">{$t('Create your organization')}</h2>
		<p class="u-small u-muted onboard-sub">
			{data.hasOrgs
				? $t('An organization holds your workspaces, projects, and members.')
				: $t('Welcome to Baskets. Create an organization to hold your workspaces and projects.')}
		</p>

		{#if form?.message}
			<div class="alert alert-error" role="alert">{form.message}</div>
		{/if}

		<form
			method="POST"
			action="?/create"
			use:enhance={() => {
				submitting = true;
				return async ({ update }) => {
					await update();
					submitting = false;
				};
			}}
		>
			<div class="field">
				<label class="label" for="orgname">{$t('Organization name')}</label>
				<input
					id="orgname"
					name="name"
					class="input"
					required
					maxlength="120"
					autocomplete="organization"
					placeholder={$t('Acme Inc.')}
				/>
			</div>
			<button
				class="btn btn-primary onboard-submit"
				type="submit"
				disabled={submitting}
				style="width: 100%;"
			>
				{submitting ? $t('Creating…') : $t('Create organization')}
			</button>
		</form>
	</div>
</div>

<style>
	.onboard {
		display: flex;
		justify-content: center;
		align-items: flex-start;
		padding-top: var(--sp-6);
	}

	.onboard-card {
		width: 100%;
		max-width: 420px;
		border: 1px solid var(--color-border-subtle);
		background: var(--color-bg);
		padding: var(--sp-5) var(--sp-4);
		box-shadow:
			0 1px 2px color-mix(in srgb, var(--color-base-content) 6%, transparent),
			0 8px 24px color-mix(in srgb, var(--color-base-content) 8%, transparent);
	}

	.onboard-title {
		margin-bottom: var(--sp-2);
	}

	.onboard-sub {
		margin-bottom: var(--sp-4);
		text-wrap: pretty;
	}

	.onboard-submit {
		transition: transform var(--dur-fast);
	}

	.onboard-submit:active:not(:disabled) {
		transform: scale(0.96);
	}
</style>
