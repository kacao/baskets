<script lang="ts">
	import Icon from '$lib/components/Icon.svelte';
	import { t } from '$lib/i18n';

	// Custom month-grid calendar — the click-to-pick replacement for the native
	// `<input type="date">` (which added a mm/dd/yyyy field to click through, and
	// whose native popup emits Escape that closed the surrounding side pane). Fully
	// in-DOM: no native picker, so it styles consistently and leaks no key events.
	// Controlled: caller owns persistence via onSelect / onClear.
	let {
		value = null,
		onSelect,
		onClear
	}: {
		value?: string | null; // 'yyyy-mm-dd'
		onSelect: (date: string) => void;
		onClear?: () => void;
	} = $props();

	const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

	// Parse 'yyyy-mm-dd' as a LOCAL date. `new Date('yyyy-mm-dd')` parses as UTC and
	// can shift a day across time zones, so build it from parts instead.
	function parse(s: string | null | undefined): Date | null {
		if (!s) return null;
		const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
		return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
	}
	function key(d: Date): string {
		return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
	}

	const today = new Date();
	const todayKey = key(today);

	// which month the grid shows; follows the value when it changes externally
	// svelte-ignore state_referenced_locally
	let view = $state(parse(value) ?? new Date(today.getFullYear(), today.getMonth(), 1));
	$effect(() => {
		const s = parse(value);
		if (s) view = new Date(s.getFullYear(), s.getMonth(), 1);
	});

	const monthLabel = $derived(view.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }));

	// 6 weeks × 7 days covering the visible month (leading/trailing days greyed)
	const days = $derived.by(() => {
		const first = new Date(view.getFullYear(), view.getMonth(), 1);
		const start = new Date(first);
		start.setDate(first.getDate() - first.getDay());
		return Array.from({ length: 42 }, (_, i) => {
			const d = new Date(start);
			d.setDate(start.getDate() + i);
			return { n: d.getDate(), k: key(d), inMonth: d.getMonth() === view.getMonth() };
		});
	});

	const step = (delta: number) => (view = new Date(view.getFullYear(), view.getMonth() + delta, 1));
</script>

<div class="cal">
	<div class="cal-head">
		<button type="button" class="cal-nav" aria-label={$t('Previous month')} onclick={() => step(-1)}>
			<Icon name="nav-arrow-left" size={16} />
		</button>
		<span class="cal-month">{monthLabel}</span>
		<button type="button" class="cal-nav" aria-label={$t('Next month')} onclick={() => step(1)}>
			<Icon name="nav-arrow-right" size={16} />
		</button>
	</div>
	<div class="cal-grid cal-dow" aria-hidden="true">
		{#each WEEKDAYS as d, i (i)}<span>{d}</span>{/each}
	</div>
	<div class="cal-grid">
		{#each days as d (d.k)}
			<button
				type="button"
				class="cal-day"
				class:out={!d.inMonth}
				class:today={d.k === todayKey}
				class:sel={d.k === value}
				onclick={() => onSelect(d.k)}
			>{d.n}</button>
		{/each}
	</div>
	<div class="cal-foot">
		<button type="button" class="cal-foot-btn" onclick={() => onSelect(todayKey)}>{$t('Today')}</button>
		{#if onClear}
			<button type="button" class="cal-foot-btn cal-clear" onclick={() => onClear?.()}>{$t('Clear')}</button>
		{/if}
	</div>
</div>

<style>
	.cal {
		width: 240px;
		padding: 4px;
	}

	.cal-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 6px;
	}

	.cal-month {
		font-size: 13px;
		font-weight: 600;
	}

	.cal-nav {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 26px;
		height: 26px;
		border: none;
		background: none;
		border-radius: var(--radius);
		color: var(--color-muted);
		cursor: pointer;
		transition: background var(--dur-fast) ease, color var(--dur-fast) ease;
	}

	.cal-nav:hover {
		background: var(--color-surface-muted);
		color: var(--color-fg);
	}

	.cal-grid {
		display: grid;
		grid-template-columns: repeat(7, 1fr);
		gap: 2px;
	}

	.cal-dow span {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 22px;
		font-size: 11px;
		color: var(--color-muted);
	}

	.cal-day {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 30px;
		border: none;
		background: none;
		border-radius: var(--radius);
		font-size: 12px;
		color: var(--color-fg);
		cursor: pointer;
		transition: background var(--dur-fast) ease, color var(--dur-fast) ease;
	}

	.cal-day:hover {
		background: var(--color-surface-muted);
	}

	.cal-day.out {
		color: var(--color-muted);
		opacity: 0.5;
	}

	.cal-day.today {
		font-weight: 700;
		box-shadow: inset 0 0 0 1px var(--color-border-subtle);
	}

	.cal-day.sel {
		background: var(--color-link, var(--color-primary));
		color: #fff;
	}

	.cal-day.sel:hover {
		background: var(--color-link, var(--color-primary));
	}

	.cal-foot {
		display: flex;
		gap: 6px;
		margin-top: 6px;
		padding-top: 6px;
		border-top: 1px solid var(--color-border-subtle);
	}

	.cal-foot-btn {
		flex: 1;
		padding: 5px 8px;
		border: none;
		background: none;
		border-radius: var(--radius);
		font-size: 12px;
		color: var(--color-fg);
		cursor: pointer;
		transition: background var(--dur-fast) ease;
	}

	.cal-foot-btn:hover {
		background: var(--color-surface-muted);
	}

	.cal-clear {
		color: var(--color-muted);
	}
</style>
