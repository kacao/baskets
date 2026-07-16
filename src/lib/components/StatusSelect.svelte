<script lang="ts">
	import { enhance } from '$app/forms';
	import { t } from '$lib/i18n';
	import Icon from '$lib/components/Icon.svelte';
	import EntityIcon from '$lib/components/EntityIcon.svelte';
	import { playSound } from '$lib/sound.svelte';

	type Status = {
		id: string;
		name: string;
		category: string;
		color?: string | null;
		icon?: string | null;
	};

	let {
		taskId,
		statusId,
		statuses,
		canEdit = true,
		display = 'text'
	}: {
		taskId: string;
		statusId: string;
		statuses: Status[];
		canEdit?: boolean;
		display?: 'text' | 'icon' | 'text-icon';
	} = $props();

	const current = $derived(statuses.find((s) => s.id === statusId));
	const colorOf = (s?: Status | null) => s?.color || 'var(--color-muted)';

	// icon-only display with an actual icon = just the glyph, no pill chrome
	const bare = $derived(display === 'icon' && Boolean(current?.icon));

	let open = $state(false);
</script>

{#snippet pill(s: Status | undefined)}
	{@const hasIcon = Boolean(s?.icon)}
	{#if display !== 'text' && hasIcon}<EntityIcon value={s?.icon} size={14} />{/if}
	{#if display === 'text' || display === 'text-icon' || !hasIcon}
		<span class="pill-name">{s?.name ?? '—'}</span>
	{/if}
{/snippet}

<svelte:window onclick={() => (open = false)} />

{#if canEdit}
	<!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
	<div class="status-wrap" onclick={(e) => e.stopPropagation()}>
		<button
			class="status-pill"
			class:bare
			style="--c: {colorOf(current)}"
			aria-haspopup="listbox"
			aria-expanded={open}
			aria-label={$t('Status')}
			onclick={() => (open = !open)}
		>
			{@render pill(current)}
		</button>
		{#if open}
			<div class="status-pop" role="listbox">
				{#each statuses as s (s.id)}
					<form
						method="POST"
						action="?/setStatus"
						use:enhance={() => {
							open = false;
							return async ({ update }) => update();
						}}
					>
						<input type="hidden" name="id" value={taskId} />
						<input type="hidden" name="statusId" value={s.id} />
						<button
							class="status-opt"
							class:active={s.id === statusId}
							style="--c: {colorOf(s)}"
							onclick={() => {
								if (s.id !== statusId && s.category === 'completed') playSound('success');
							}}
						>
							{#if s.icon}<EntityIcon value={s.icon} size={14} />{:else}<span
									class="dot"
									aria-hidden="true"
								></span>{/if}
							<span class="opt-name">{s.name}</span>
							{#if s.id === statusId}<span class="check" aria-hidden="true"
									><Icon name="check" size={14} /></span
								>{/if}
						</button>
					</form>
				{/each}
			</div>
		{/if}
	</div>
{:else}
	<span class="status-pill readonly" class:bare style="--c: {colorOf(current)}">
		{@render pill(current)}
	</span>
{/if}

<style>
	.status-wrap {
		position: relative;
		display: inline-flex;
		flex: 0 0 auto;
	}

	.status-pill {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		border: 1px solid color-mix(in oklab, var(--c) 35%, transparent);
		background: color-mix(in oklab, var(--c) 12%, transparent);
		color: color-mix(in oklab, var(--c) 75%, var(--color-fg));
		border-radius: 999px;
		font-size: 12px;
		font-weight: 500;
		line-height: 1;
		padding: 4px 10px;
		cursor: pointer;
		white-space: nowrap;
		transition:
			background var(--dur) ease,
			border-color var(--dur) ease,
			transform 160ms var(--ease-out);
	}

	.status-pill:hover {
		background: color-mix(in oklab, var(--c) 20%, transparent);
		border-color: color-mix(in oklab, var(--c) 55%, transparent);
	}

	.status-pill:active:not(.readonly) {
		transform: scale(0.97);
	}

	.status-pill.readonly {
		cursor: default;
	}

	/* icon-only: drop the pill chrome, keep just the (status-colored) glyph */
	.status-pill.bare {
		border-color: transparent;
		background: none;
		padding: 2px;
		gap: 0;
	}

	.status-pill.bare:hover {
		background: var(--color-surface-muted);
		border-color: transparent;
	}

	.status-pill.readonly.bare:hover {
		background: none;
	}

	.dot {
		width: 8px;
		height: 8px;
		border-radius: 999px;
		background: var(--c);
		flex: 0 0 auto;
	}

	.status-pop {
		position: absolute;
		top: calc(100% + 4px);
		left: 0;
		z-index: 30;
		min-width: 160px;
		/* scroll the list itself rather than overflowing the (scrollable) pane it
		   sits in — wheel events have nowhere to go otherwise (status popover bug). */
		max-height: min(280px, 60vh);
		overflow-y: auto;
		overscroll-behavior: contain;
		background: var(--color-base-100);
		border: 1px solid var(--color-base-300);
		border-radius: var(--radius-box, 0.5rem);
		box-shadow:
			0 1px 2px rgb(0 0 0 / 0.06),
			0 8px 24px rgb(0 0 0 / 0.12);
		padding: 4px;
		transform-origin: top left;
	}

	.status-opt {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		border: none;
		background: none;
		color: var(--color-fg);
		font-size: 13px;
		text-align: left;
		padding: 6px 8px;
		border-radius: var(--radius-field, 0.25rem);
		cursor: pointer;
		transition: background var(--dur-fast) ease;
	}

	.status-opt:hover {
		background: var(--color-surface-muted);
	}

	.opt-name {
		flex: 1;
		white-space: nowrap;
	}

	.status-opt.active {
		font-weight: 600;
	}

	.check {
		color: var(--color-muted);
		font-size: 11px;
	}
</style>
