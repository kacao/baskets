<script lang="ts">
	import { page } from '$app/state';
	import { invalidateAll } from '$app/navigation';
	import Icon from '$lib/components/Icon.svelte';
	import Popover from '$lib/components/Popover.svelte';
	import { t as i18n } from '$lib/i18n';
	import type { DueBucket, TaskFilters } from '$lib/taskFilter';
	import { hasActiveFilters } from '$lib/taskFilter';

	type Task = { id: string; title: string };

	let {
		tasks = [],
		statuses = [],
		users = [],
		milestones = [],
		labels = [],
		config = {},
		searchText = $bindable(''),
		viewId = '',
		viewName = '',
		canEditView = false
	}: {
		tasks?: Task[];
		statuses?: { id: string; name: string }[];
		users?: { id: string; name: string }[];
		milestones?: { id: string; name: string }[];
		labels?: { id: string; name: string }[];
		config?: Record<string, unknown>;
		searchText?: string;
		viewId?: string;
		viewName?: string;
		canEditView?: boolean;
	} = $props();

	const PRIORITIES = [
		['urgent', 'Urgent'],
		['high', 'High'],
		['medium', 'Medium'],
		['low', 'Low'],
		['none', 'None']
	] as const;

	const DUE_BUCKETS: [DueBucket, string][] = [
		['overdue', 'Overdue'],
		['today', 'Today'],
		['week', 'Next 7 days'],
		['later', 'Later'],
		['none', 'No due date']
	];

	// Active filter set lives in view.config.filters (persisted via ?/updateView).
	const filters = $derived(
		(config.filters && typeof config.filters === 'object'
			? config.filters
			: {}) as TaskFilters
	);

	const sel = (key: keyof TaskFilters): string[] =>
		Array.isArray(filters[key]) ? (filters[key] as string[]) : [];

	const activeCount = $derived(
		(['statusIds', 'assigneeIds', 'milestoneIds', 'labelIds', 'priorities', 'dueBuckets'] as const).reduce(
			(n, k) => n + sel(k).length,
			0
		)
	);
	const anyActive = $derived(hasActiveFilters(filters, searchText));

	// Posts the merged config the same way TableView's resize does (fetch + invalidateAll),
	// so the filter set survives reloads without needing a new server action.
	async function postFilters(next: TaskFilters) {
		if (!canEditView || !viewId) return;
		const cleaned: TaskFilters = {};
		(Object.keys(next) as (keyof TaskFilters)[]).forEach((k) => {
			const v = next[k];
			if (Array.isArray(v) && v.length) (cleaned[k] as unknown) = v;
		});
		const fd = new FormData();
		fd.set('id', viewId);
		fd.set('name', viewName);
		fd.set(
			'config',
			JSON.stringify({
				...config,
				filters: Object.keys(cleaned).length ? cleaned : undefined
			})
		);
		await fetch(`${page.url.pathname}?/updateView`, { method: 'POST', body: fd });
		await invalidateAll();
	}

	function toggle(key: keyof TaskFilters, value: string) {
		const cur = sel(key);
		const next = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value];
		postFilters({ ...filters, [key]: next });
	}

	function clearAll() {
		searchText = '';
		postFilters({});
	}
</script>

<div class="filterbar">
	<label class="search" aria-label={$i18n('Search tasks')}>
		<Icon name="search" size={14} />
		<input
			class="search-input"
			type="search"
			placeholder={$i18n('Search tasks…')}
			bind:value={searchText}
		/>
	</label>

	{@render facet('statusIds', $i18n('Status'), statuses.map((s) => [s.id, s.name]))}
	{@render facet('priorities', $i18n('Priority'), PRIORITIES.map(([v, l]) => [v, $i18n(l)]))}
	{@render facet('assigneeIds', $i18n('Assignee'), [
		['_none', $i18n('Unassigned')],
		...users.map((u) => [u.id, u.name] as [string, string])
	])}
	{@render facet('milestoneIds', $i18n('Milestone'), [
		['_none', $i18n('No milestone')],
		...milestones.map((m) => [m.id, m.name] as [string, string])
	])}
	{@render facet('labelIds', $i18n('Labels'), [
		['_none', $i18n('No label')],
		...labels.map((l) => [l.id, l.name] as [string, string])
	])}
	{@render facet('dueBuckets', $i18n('Due'), DUE_BUCKETS.map(([v, l]) => [v, $i18n(l)]))}

	{#if anyActive}
		<button class="clear-btn" type="button" onclick={clearAll}>
			<Icon name="xmark" size={12} />
			{$i18n('Clear')}{#if activeCount}<span class="count">{activeCount}</span>{/if}
		</button>
	{/if}
</div>

{#snippet facet(key: keyof TaskFilters, label: string, opts: [string, string][])}
	{@const chosen = sel(key)}
	<Popover ariaLabel={label}>
		{#snippet trigger()}
			<span class="facet-btn" class:facet-btn--on={chosen.length > 0}>
				{label}
				{#if chosen.length > 0}<span class="facet-count">{chosen.length}</span>{/if}
				<Icon name="nav-arrow-down" size={11} />
			</span>
		{/snippet}
		{#snippet panel()}
			{#each opts as [val, lbl] (val)}
				<button
					class="opt"
					class:opt--on={chosen.includes(val)}
					type="button"
					disabled={!canEditView}
					onclick={() => toggle(key, val)}
				>
					<span class="opt-check">{#if chosen.includes(val)}<Icon name="check" size={13} />{/if}</span>
					{lbl}
				</button>
			{:else}
				<span class="opt-empty">{$i18n('No options')}</span>
			{/each}
		{/snippet}
	</Popover>
{/snippet}

<style>
	.filterbar {
		display: flex;
		align-items: center;
		gap: var(--sp-1);
		flex-wrap: wrap;
		margin-bottom: var(--sp-3);
	}

	.search {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-field, 0.25rem);
		padding: 3px 8px;
		color: var(--color-muted);
		background: var(--color-bg);
		min-width: 200px;
		flex: 0 1 260px;
	}

	.search:focus-within {
		border-color: color-mix(in oklab, var(--color-fg) 35%, var(--color-bg));
		color: var(--color-fg);
	}

	.search-input {
		border: none;
		background: none;
		outline: none;
		font-family: var(--font-body);
		font-size: 13px;
		color: var(--color-fg);
		width: 100%;
		min-width: 0;
	}

	.facet-btn {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		border: 1px solid var(--color-border-subtle);
		background: var(--color-bg);
		color: var(--color-muted);
		font-family: var(--font-mono);
		font-size: 11px;
		padding: 2px 8px;
		border-radius: var(--radius-field, 0.25rem);
		cursor: pointer;
		transition:
			background var(--dur-fast) ease,
			color var(--dur-fast) ease,
			border-color var(--dur-fast) ease;
	}

	.facet-btn:hover {
		border-color: var(--color-fg);
		color: var(--color-fg);
	}

	.facet-btn--on {
		background: color-mix(in oklab, var(--color-fg) 12%, var(--color-bg));
		border-color: color-mix(in oklab, var(--color-fg) 30%, var(--color-bg));
		color: var(--color-fg);
	}

	.facet-count,
	.count {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 15px;
		height: 15px;
		padding: 0 3px;
		border-radius: 999px;
		background: var(--color-fg);
		color: var(--color-bg);
		font-size: 10px;
		font-weight: 600;
		line-height: 1;
	}

	.clear-btn {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		border: none;
		background: none;
		color: var(--color-muted);
		font-family: var(--font-mono);
		font-size: 11px;
		padding: 2px 6px;
		cursor: pointer;
		border-radius: var(--radius-field, 0.25rem);
		transition: color var(--dur-fast) ease, background var(--dur-fast) ease;
	}

	.clear-btn:hover {
		color: var(--color-fg);
		background: var(--color-surface-muted);
	}

	.opt {
		display: flex;
		align-items: center;
		gap: 6px;
		width: 100%;
		border: none;
		background: none;
		color: var(--color-fg);
		font-family: var(--font-body);
		font-size: 13px;
		text-align: left;
		padding: 6px 8px;
		border-radius: var(--radius-field, 0.25rem);
		cursor: pointer;
		transition: background var(--dur-fast) ease;
	}

	.opt:hover {
		background: var(--color-surface-muted);
	}

	.opt:disabled {
		cursor: default;
		opacity: 0.6;
	}

	.opt--on {
		font-weight: 600;
	}

	.opt-check {
		display: inline-flex;
		width: 13px;
		flex: 0 0 13px;
		color: var(--color-fg);
	}

	.opt-empty {
		display: block;
		font-size: 12px;
		color: var(--color-muted);
		padding: 6px 8px;
	}
</style>
