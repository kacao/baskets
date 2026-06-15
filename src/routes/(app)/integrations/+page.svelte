<script lang="ts">
	import { enhance } from '$app/forms';
	import { t } from '$lib/i18n';

	let { data, form } = $props();

	let editing = $state(false);
	let loading = $state(false);

	const connected = $derived(Boolean(data.slack));
	const admin = $derived(data.user?.role === 'admin');

	const submit = () => {
		loading = true;
		return async ({ update }: { update: () => Promise<void> }) => {
			loading = false;
			editing = false;
			await update();
		};
	};
</script>

<svelte:head><title>{$t('Integrations')} — Baskets</title></svelte:head>

<h2 style="margin-bottom: var(--sp-4);">{$t('Integrations')}</h2>

<div class="card" style="max-width: 560px;">
	<div class="u-between" style="margin-bottom: var(--sp-2);">
		<h4>Slack</h4>
		<span class="badge" class:badge-success={connected && data.slack?.enabled}>
			{connected ? (data.slack?.enabled ? $t('ON') : $t('PAUSED')) : $t('OFF')}
		</span>
	</div>
	<p class="u-small u-muted" style="margin-bottom: var(--sp-3);">
		{$t('Posts to a Slack channel when projects are created and tasks are created or completed. Uses an incoming webhook — create one in Slack under Apps → Incoming Webhooks.')}
	</p>

	{#if form?.message}
		<div class="alert alert-error" role="alert">{form.message}</div>
	{/if}
	{#if form?.saved}
		<div class="alert alert-success" role="status">{$t('Slack connected.')}</div>
	{/if}
	{#if form?.tested}
		<div class="alert alert-success" role="status">{$t('Test message sent — check your channel.')}</div>
	{/if}

	{#if !admin}
		<p class="u-small u-muted">
			{connected ? $t('Connected.') : $t('Not connected.')} {$t('Only admins can manage integrations.')}
		</p>
	{:else if connected && !editing}
		<p class="u-small" style="margin-bottom: var(--sp-3);">
			<strong>{$t('Webhook')}:</strong> <span class="mono">{data.slack?.webhookHint}</span>
		</p>
		<div class="u-flex">
			<form method="POST" action="?/testSlack" use:enhance={submit}>
				<button class="btn" type="submit" disabled={loading}>{$t('Send test')}</button>
			</form>
			<form method="POST" action="?/toggleSlack" use:enhance={submit}>
				<button class="btn" type="submit" disabled={loading}>
					{data.slack?.enabled ? $t('Pause') : $t('Resume')}
				</button>
			</form>
			<button class="btn" type="button" onclick={() => (editing = true)}>{$t('Change URL')}</button>
			<form method="POST" action="?/removeSlack" use:enhance={submit}>
				<button class="btn btn-error" type="submit" disabled={loading}>{$t('Remove')}</button>
			</form>
		</div>
	{:else}
		<form method="POST" action="?/saveSlack" use:enhance={submit}>
			<div class="field">
				<label class="label" for="webhook">{$t('Incoming webhook URL')}</label>
				<input
					id="webhook"
					class="input mono"
					name="webhookUrl"
					type="url"
					placeholder="https://hooks.slack.com/services/T000/B000/XXXX"
					required
				/>
			</div>
			<div class="u-flex">
				<button class="btn btn-primary" type="submit" disabled={loading}>
					{loading ? $t('Saving…') : connected ? $t('Update webhook') : $t('Connect Slack')}
				</button>
				{#if editing}
					<button class="btn" type="button" onclick={() => (editing = false)}>{$t('Cancel')}</button>
				{/if}
			</div>
		</form>
	{/if}
</div>
