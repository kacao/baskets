<script lang="ts" module>
	// Curated preset palette (Tailwind 500/600 family) — same colour vocabulary
	// the built-in status defaults already speak (#71717a/#a1a1aa/#3b82f6/#f59e0b/
	// #16a34a all live here), so existing values highlight as a preset, not "custom".
	export const COLOR_PRESETS = [
		'#71717a',
		'#a1a1aa',
		'#64748b',
		'#ef4444',
		'#f97316',
		'#f59e0b',
		'#eab308',
		'#84cc16',
		'#22c55e',
		'#16a34a',
		'#10b981',
		'#14b8a6',
		'#06b6d4',
		'#0ea5e9',
		'#3b82f6',
		'#6366f1',
		'#8b5cf6',
		'#a855f7',
		'#d946ef',
		'#ec4899',
		'#f43f5e'
	];

	// Canonical lowercase #rrggbb, or null. Accepts #rgb / #rrggbb (with or without
	// the #) and expands the 3-digit form — the server regex is 6-digit-only, so we
	// must never emit a 3-digit value.
	export function normalizeHex(input: string | null | undefined): string | null {
		if (!input) return null;
		let s = input.trim().toLowerCase();
		if (s.startsWith('#')) s = s.slice(1);
		if (/^[0-9a-f]{3}$/.test(s))
			s = s
				.split('')
				.map((c) => c + c)
				.join('');
		return /^[0-9a-f]{6}$/.test(s) ? `#${s}` : null;
	}
</script>

<script lang="ts">
	import { tooltip } from '$lib/tooltip';
	import { t } from '$lib/i18n';

	// Controlled colour picker — a preset radiogroup + a custom-hex escape hatch.
	// Pure: emits the chosen value via onSelect (canonical #rrggbb); caller owns
	// persistence (twin of IconPicker.svelte).
	let {
		value,
		onSelect,
		onRemove
	}: {
		value?: string | null;
		onSelect: (hex: string) => void;
		onRemove?: () => void;
	} = $props();

	const COLS = 7;
	const selected = $derived(normalizeHex(value));
	// svelte-ignore state_referenced_locally
	let draft = $state(value ?? '');
	const draftValid = $derived(draft.trim() === '' || normalizeHex(draft) !== null);

	const initIdx = COLOR_PRESETS.findIndex((c) => c === selected);
	let focusIdx = $state(initIdx >= 0 ? initIdx : 0);
	let cells: HTMLButtonElement[] = $state([]);

	function pick(hex: string) {
		const norm = normalizeHex(hex);
		if (!norm) return;
		draft = norm;
		onSelect(norm);
	}

	function commitDraft() {
		const norm = normalizeHex(draft);
		if (norm) pick(norm);
	}

	function onGridKey(e: KeyboardEvent) {
		const n = COLOR_PRESETS.length;
		let next = focusIdx;
		switch (e.key) {
			case 'ArrowRight':
				next = Math.min(n - 1, focusIdx + 1);
				break;
			case 'ArrowLeft':
				next = Math.max(0, focusIdx - 1);
				break;
			case 'ArrowDown':
				next = Math.min(n - 1, focusIdx + COLS);
				break;
			case 'ArrowUp':
				next = Math.max(0, focusIdx - COLS);
				break;
			case 'Home':
				next = 0;
				break;
			case 'End':
				next = n - 1;
				break;
			case 'Enter':
			case ' ':
				e.preventDefault();
				pick(COLOR_PRESETS[focusIdx]);
				return;
			default:
				return;
		}
		e.preventDefault();
		focusIdx = next;
		cells[next]?.focus();
	}
</script>

<div class="color-picker">
	<!-- Roving tabindex lives on the radio children (APG pattern), so the
	     radiogroup container is intentionally not in the tab order. -->
	<!-- svelte-ignore a11y_interactive_supports_focus -->
	<div class="cp-grid" role="radiogroup" aria-label={$t('Color')} onkeydown={onGridKey}>
		{#each COLOR_PRESETS as c, i (c)}
			{@const on = selected === c}
			<button
				bind:this={cells[i]}
				class="cp-cell"
				class:on
				type="button"
				role="radio"
				aria-checked={on}
				aria-label={c}
				tabindex={focusIdx === i ? 0 : -1}
				use:tooltip={c}
				style="--c: {c}"
				onclick={() => {
					focusIdx = i;
					pick(c);
				}}
			></button>
		{/each}
	</div>

	<div class="cp-custom">
		<input
			class="cp-hex"
			bind:value={draft}
			placeholder="#rrggbb"
			aria-label={$t('Custom color (hex)')}
			aria-invalid={!draftValid}
			autocomplete="off"
			spellcheck="false"
			onchange={commitDraft}
		/>
		<input
			class="cp-native"
			type="color"
			value={selected ?? '#71717a'}
			aria-label={$t('Custom color')}
			onchange={(e) => pick(e.currentTarget.value)}
		/>
	</div>

	{#if onRemove && value}
		<button class="cp-remove" type="button" onclick={onRemove}>{$t('Remove color')}</button>
	{/if}
</div>

<style>
	.color-picker {
		width: max-content;
		display: flex;
		flex-direction: column;
	}

	.cp-grid {
		display: grid;
		grid-template-columns: repeat(7, 32px);
		gap: 4px;
		padding: 8px;
	}

	.cp-cell {
		aspect-ratio: 1;
		border: 1px solid color-mix(in oklab, var(--color-fg) 18%, transparent);
		border-radius: var(--radius-field, 0.25rem);
		background: var(--c);
		cursor: pointer;
		padding: 0;
		transition:
			box-shadow var(--dur-fast) ease,
			border-color var(--dur-fast) ease;
	}

	.cp-cell.on {
		border-color: var(--color-fg);
		box-shadow: 0 0 0 2px var(--color-fg);
	}

	/* :focus outline is suppressed app-wide — make keyboard focus self-evident
	   with an offset ring (base-100 gap, then --color-fg). */
	.cp-cell:focus-visible {
		box-shadow:
			0 0 0 2px var(--color-base-100, #fff),
			0 0 0 4px var(--color-fg);
		z-index: 1;
	}

	.cp-custom {
		display: flex;
		gap: 6px;
		align-items: center;
		padding: 6px 8px;
		border-top: 1px solid var(--color-border-subtle);
	}

	.cp-hex {
		flex: 1 1 auto;
		min-width: 0;
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-field, 0.25rem);
		background: var(--color-base-100);
		color: var(--color-fg);
		font-family: var(--font-mono, monospace);
		font-size: 12px;
		padding: 4px 6px;
		outline: none;
	}

	.cp-hex:focus {
		border-color: var(--color-fg);
	}

	.cp-hex[aria-invalid='true'] {
		border-color: var(--color-error, #ef4444);
	}

	.cp-native {
		appearance: none;
		-webkit-appearance: none;
		-moz-appearance: none;
		width: 28px;
		height: 28px;
		padding: 0;
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-field, 0.25rem);
		background: none;
		cursor: pointer;
		flex: 0 0 auto;
	}

	.cp-native::-webkit-color-swatch-wrapper {
		padding: 0;
	}

	.cp-native::-webkit-color-swatch {
		border: none;
		border-radius: calc(var(--radius-field, 0.25rem) - 1px);
	}

	.cp-native::-moz-color-swatch {
		border: none;
		border-radius: calc(var(--radius-field, 0.25rem) - 1px);
	}

	.cp-remove {
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

	.cp-remove:hover {
		color: var(--color-fg);
		background: var(--color-surface-muted);
	}
</style>
