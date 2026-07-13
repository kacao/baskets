<script lang="ts">
	import { enhance } from '$app/forms';
	import Icon from '$lib/components/Icon.svelte';
	import EntityIcon from '$lib/components/EntityIcon.svelte';
	import IconPicker from '$lib/components/IconPicker.svelte';
	import Popover from '$lib/components/Popover.svelte';
	import { tooltip } from '$lib/tooltip';
	import { t } from '$lib/i18n';
	import { categoryLabel } from '$lib/statuses';

	let { data, form } = $props();
</script>

<svelte:head><title>{$t('Statuses')} — Baskets</title></svelte:head>

<h2 style="margin-bottom: var(--sp-2);">{$t('Statuses')}</h2>
<p class="u-small u-muted" style="margin-bottom: var(--sp-4); max-width: 65ch;">
	{$t(
		'The five default statuses every project starts from. Their name, category and deletion are fixed — but you can change each status’s icon here (applies everywhere). Custom statuses are added per workspace or per project in their settings.'
	)}
</p>

{#if form?.message}
	<div class="alert alert-error" role="alert" style="max-width: 640px; margin-bottom: var(--sp-3);">
		{form.message}
	</div>
{/if}

<div class="card" style="max-width: 640px;">
	{#each data.statuses as s (s.id)}
		<div class="row">
			<Popover ariaLabel={$t('Change icon')}>
				{#snippet trigger()}
					<span class="ic-trigger" use:tooltip={$t('Change icon')}>
						{#if s.icon}<EntityIcon value={s.icon} size={18} />{:else}<span
								class="status-dot"
								style="--c: {s.color || 'var(--color-muted)'}"
								aria-hidden="true"
							></span>{/if}
					</span>
				{/snippet}
				{#snippet panel(close)}
					<form
						id="icon-form-{s.id}"
						method="POST"
						action="?/setStatusIcon"
						use:enhance={() =>
							async ({ update }) => {
								close();
								await update();
							}}
					>
						<input type="hidden" name="id" value={s.id} />
						<input type="hidden" name="icon" value={s.icon ?? ''} />
						<IconPicker
							value={s.icon}
							onSelect={(v) => {
								const f = document.getElementById(`icon-form-${s.id}`) as HTMLFormElement | null;
								if (!f) return;
								(f.elements.namedItem('icon') as HTMLInputElement).value = v;
								s.icon = v; // optimistic; load() refresh confirms
								f.requestSubmit();
							}}
						/>
					</form>
				{/snippet}
			</Popover>
			<span class="name">{s.name}</span>
			<span class="badge">{categoryLabel(s.category)}</span>
			<span class="badge">{$t('built-in')}</span>
			<span class="u-tiny u-muted count">{$t('{n} task(s)', { n: s.inUse })}</span>
		</div>
	{/each}
</div>

<style>
	.row {
		display: flex;
		align-items: center;
		gap: var(--sp-2);
		padding: var(--sp-1) 0;
		border-bottom: 1px solid var(--color-border-subtle);
	}

	.row:last-child {
		border-bottom: none;
	}

	.ic-trigger {
		position: relative;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		border-radius: var(--radius-field, 0.25rem);
		cursor: pointer;
		transition: background var(--dur-fast) ease;
	}

	.ic-trigger::before {
		content: '';
		position: absolute;
		top: 50%;
		left: 50%;
		width: 40px;
		height: 40px;
		transform: translate(-50%, -50%);
	}

	.ic-trigger:hover {
		background: var(--color-surface-muted);
	}

	.status-dot {
		width: 10px;
		height: 10px;
		border-radius: 999px;
		background: var(--c);
	}

	.name {
		font-weight: 500;
	}

	.count {
		font-variant-numeric: tabular-nums;
	}
</style>
