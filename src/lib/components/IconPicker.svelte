<script lang="ts">
	import Icon from '$lib/components/Icon.svelte';
	import { HEROICON_NAMES } from '$lib/heroiconNames';
	import { t } from '$lib/i18n';

	// Searchable icon picker: an emoji grid + a Heroicon search grid (ADR-052). Emits
	// the chosen value via onSelect — a bare emoji char, or `iconoir:<name>` (the
	// `iconoir:` prefix is the historical sprite-icon namespace, kept for back-compat).
	let {
		value,
		onSelect,
		onRemove
	}: {
		value?: string | null;
		onSelect: (value: string) => void;
		onRemove?: () => void;
	} = $props();

	const EMOJIS = [
		'📋',
		'✅',
		'🚀',
		'🐛',
		'🎨',
		'📦',
		'🔧',
		'📈',
		'💡',
		'🔥',
		'🌐',
		'📝',
		'🗂️',
		'⚙️',
		'🎯',
		'🧪',
		'📣',
		'🔒',
		'💬',
		'📅',
		'🏗️',
		'🧩',
		'🌱',
		'⭐'
	];

	const CAP = 240;
	// svelte-ignore state_referenced_locally
	let tab = $state<'emoji' | 'icons'>(value?.startsWith('iconoir:') ? 'icons' : 'emoji');
	let query = $state('');

	const matches = $derived.by(() => {
		const q = query.trim().toLowerCase().replace(/\s+/g, '-');
		const list = q ? HEROICON_NAMES.filter((n) => n.includes(q)) : HEROICON_NAMES;
		return { total: list.length, shown: list.slice(0, CAP) };
	});
</script>

<div class="icon-picker">
	<div class="ip-tabs">
		<button
			class="ip-tab"
			class:active={tab === 'emoji'}
			type="button"
			onclick={() => (tab = 'emoji')}
		>
			{$t('Emoji')}
		</button>
		<button
			class="ip-tab"
			class:active={tab === 'icons'}
			type="button"
			onclick={() => (tab = 'icons')}
		>
			{$t('Icons')}
		</button>
	</div>

	{#if tab === 'emoji'}
		<div class="ip-grid">
			{#each EMOJIS as e (e)}
				<button class="ip-cell" class:on={value === e} type="button" onclick={() => onSelect(e)}>
					<span class="ip-emoji">{e}</span>
				</button>
			{/each}
		</div>
	{:else}
		<!-- svelte-ignore a11y_autofocus -->
		<input
			class="ip-search"
			placeholder={$t('Search icons…')}
			bind:value={query}
			autocomplete="off"
			autofocus
		/>
		<div class="ip-grid ip-grid--icons">
			{#each matches.shown as n (n)}
				<button
					class="ip-cell"
					class:on={value === `iconoir:${n}`}
					type="button"
					title={n}
					aria-label={n}
					onclick={() => onSelect(`iconoir:${n}`)}
				>
					<Icon name={n} size={20} />
				</button>
			{:else}
				<p class="ip-empty">{$t('No icons match.')}</p>
			{/each}
		</div>
		{#if matches.total > matches.shown.length}
			<p class="ip-hint">
				{$t('Showing {n} of {total} — refine your search.', {
					n: matches.shown.length,
					total: matches.total
				})}
			</p>
		{/if}
	{/if}

	{#if onRemove && value}
		<button class="ip-remove" type="button" onclick={onRemove}>{$t('Remove icon')}</button>
	{/if}
</div>

<style>
	/* Fit inside the Popover panel's content box (max-width 280 − 8px padding −
	   2px border ≈ 270) so the panel never grows a horizontal scrollbar. 1fr
	   columns absorb the icons grid's vertical scrollbar without x-overflow. */
	.icon-picker {
		width: 264px;
		display: flex;
		flex-direction: column;
	}

	.ip-tabs {
		display: flex;
		gap: 2px;
		padding: 4px 6px 0;
	}

	.ip-tab {
		flex: 1;
		border: none;
		background: none;
		color: var(--color-muted);
		font-family: var(--font-body);
		font-size: 12px;
		font-weight: 500;
		padding: 5px 8px;
		cursor: pointer;
		border-bottom: 2px solid transparent;
		transition: color var(--dur-fast) ease;
	}

	.ip-tab:hover {
		color: var(--color-fg);
	}

	.ip-tab.active {
		color: var(--color-fg);
		border-bottom-color: var(--color-fg);
	}

	.ip-search {
		margin: 6px;
		border: none;
		border-bottom: 1px solid var(--color-border-subtle);
		background: none;
		font-family: var(--font-body);
		font-size: 13px;
		padding: 4px 2px;
		outline: none;
	}

	.ip-search:focus {
		border-bottom-color: var(--color-fg);
	}

	.ip-grid {
		display: grid;
		grid-template-columns: repeat(6, 1fr);
		gap: 2px;
		padding: 6px;
		/* Keep the whole picker (grid + tabs/search/hint ≈ 101px chrome) under the
		   Popover panel's 320px max-height so ONLY the grid scrolls — if the panel
		   itself scrolled, its vertical scrollbar would shrink the panel and force a
		   horizontal scrollbar. */
		max-height: 200px;
		overflow-y: auto;
		/* overflow-y:auto promotes overflow-x to auto; sub-pixel rounding across the
		   1fr columns (with the vertical scrollbar present) would otherwise show a
		   phantom horizontal scrollbar. Clip it — the 1fr tracks already fit. */
		overflow-x: hidden;
		overscroll-behavior: contain;
	}

	.ip-cell {
		display: flex;
		align-items: center;
		justify-content: center;
		aspect-ratio: 1;
		border: 1px solid transparent;
		border-radius: var(--radius-field, 0.25rem);
		background: none;
		color: var(--color-fg);
		cursor: pointer;
		padding: 0;
		transition:
			background var(--dur-fast) ease,
			border-color var(--dur-fast) ease;
	}

	.ip-cell:hover {
		background: var(--color-surface-muted);
	}

	.ip-cell.on {
		border-color: var(--color-fg);
		background: var(--color-surface-muted);
	}

	.ip-emoji {
		font-size: 18px;
		line-height: 1;
	}

	.ip-empty {
		grid-column: 1 / -1;
		font-size: 12px;
		color: var(--color-muted);
		padding: 8px;
		text-align: center;
	}

	.ip-hint {
		font-size: 11px;
		color: var(--color-muted);
		padding: 0 8px 6px;
		font-variant-numeric: tabular-nums;
	}

	.ip-remove {
		border: none;
		border-top: 1px solid var(--color-border-subtle);
		background: none;
		color: var(--color-muted);
		font-family: var(--font-body);
		font-size: 12px;
		text-align: left;
		padding: 6px 10px;
		cursor: pointer;
	}

	.ip-remove:hover {
		color: var(--color-fg);
		background: var(--color-surface-muted);
	}
</style>
