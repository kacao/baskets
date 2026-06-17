<script lang="ts">
	import { enhance, applyAction, deserialize } from '$app/forms';
	import { onDestroy, tick } from 'svelte';
	import Icon from '$lib/components/Icon.svelte';
	import IconPicker from '$lib/components/IconPicker.svelte';
	import EntityIcon from '$lib/components/EntityIcon.svelte';
	import { page } from '$app/state';
	import { goto, invalidateAll } from '$app/navigation';
	import { slide } from 'svelte/transition';
	import { popover } from '$lib/transitions';
	import { presence, subscribeProject, unsubscribeProject } from '$lib/realtime.svelte';
	import SidePane from '$lib/components/SidePane.svelte';
	import Popover from '$lib/components/Popover.svelte';
	import NewTaskPane from '$lib/components/NewTaskPane.svelte';
	import NewMilestonePane from '$lib/components/NewMilestonePane.svelte';
	import TemplatePicker from '$lib/components/TemplatePicker.svelte';
	import TableView from '$lib/components/views/TableView.svelte';
	import BoardView from '$lib/components/views/BoardView.svelte';
	import ListView from '$lib/components/views/ListView.svelte';
	import TimelineView from '$lib/components/views/TimelineView.svelte';
	import CalendarView from '$lib/components/views/CalendarView.svelte';
	import DashboardView from '$lib/components/views/DashboardView.svelte';
	import MapView from '$lib/components/views/MapView.svelte';
	import FilterBar from '$lib/components/FilterBar.svelte';
	import SavedFilters from '$lib/components/SavedFilters.svelte';
	import BulkActionBar from '$lib/components/BulkActionBar.svelte';
	import { filterTasks } from '$lib/taskFilter';
	import { sortTasks, parseSortBy } from '$lib/taskSort';
	import { fieldAppliesTo } from '$lib/customFields';
	import { selection } from '$lib/selection.svelte';
	import { toast } from '$lib/toast.svelte';
	import { t } from '$lib/i18n';
	import { confirmDialog } from '$lib/confirm.svelte';
	import { tooltip } from '$lib/tooltip';

	let { data, form } = $props();

	let projMenuOpen = $state(false);
	// project icon picker: emit a value through a hidden setProjectIcon form
	let iconFormEl = $state<HTMLFormElement | null>(null);
	let pendingIcon = $state('');
	async function chooseIcon(v: string) {
		pendingIcon = v;
		await tick();
		iconFormEl?.requestSubmit();
	}
	let labelQuery = $state('');
	let addingView = $state(false);
	let customizing = $state(false);
	let milestonesOpen = $state(false);
	let newTaskOpen = $state(false);
	let newTaskPrefill = $state<Record<string, string>>({});
	let newMilestoneOpen = $state(false);
	let ctx = $state<{ id: string; x: number; y: number } | null>(null);
	let ctxSub = $state<'display' | null>(null);
	let ctxRenaming = $state(false);

	const requestedView = $derived(page.url.searchParams.get('view'));
	const visibleViews = $derived(data.views.filter((v) => !v.hidden));
	const hiddenViews = $derived(data.views.filter((v) => v.hidden));
	const activeView = $derived(
		visibleViews.find((v) => v.id === requestedView) ??
			visibleViews.find((v) => v.isDefault) ??
			visibleViews[0]
	);
	const viewConfig = $derived.by(() => parseConfig(activeView?.config));
	const canEditActiveView = $derived(Boolean(activeView && data.perm.views[activeView.id]));
	const ctxView = $derived(data.views.find((v) => v.id === ctx?.id) ?? null);

	// --- Search + filtering (BASDEV-2) + sorting (BASDEV-7) ---
	let searchText = $state('');
	// reset the search box when switching view tabs
	$effect(() => {
		activeView?.id;
		searchText = '';
	});
	const labelIdsOf = (taskId: string) =>
		data.taskLabels.filter((l) => l.taskId === taskId).map((l) => l.labelId);
	const statusRankFn = (id: string) => {
		const i = data.statuses.findIndex((s) => s.id === id);
		return i < 0 ? Number.MAX_SAFE_INTEGER : i;
	};
	const assigneeNameFn = (id: string | null) => data.users.find((u) => u.id === id)?.name ?? null;
	// tasks after the active view's saved filters + the live search box, then sorted.
	const filteredTasks = $derived(
		sortTasks(
			filterTasks(
				data.tasks,
				(viewConfig.filters as Record<string, unknown>) ?? undefined,
				searchText,
				{ labelIdsOf }
			),
			typeof viewConfig.sortBy === 'string' ? (viewConfig.sortBy as string) : null,
			{ statusRank: statusRankFn, assigneeName: assigneeNameFn }
		)
	);

	// Apply a saved filter's config onto the active view (BASDEV-7).
	async function applySavedFilter(filterConfig: Record<string, unknown>) {
		if (!activeView || !canEditActiveView) return;
		const fd = new FormData();
		fd.set('id', activeView.id);
		fd.set('name', activeView.name);
		fd.set('config', JSON.stringify({ ...viewConfig, ...filterConfig }));
		await fetch(`${page.url.pathname}?/updateView`, { method: 'POST', body: fd });
		await invalidateAll();
	}

	// Clear selection whenever the active project changes (and on unmount). (BASDEV-6)
	$effect(() => {
		void data.project.id;
		return () => selection.clear();
	});

	async function bulkSubmit(action: string, fields: Record<string, string>) {
		const body = new FormData();
		for (const id of selection.ids) body.append('ids', id);
		for (const [k, v] of Object.entries(fields)) body.set(k, v);
		const res = await fetch(`?/${action}`, { method: 'POST', body });
		const result = deserialize(await res.text());
		if (result.type === 'failure') {
			toast($t(String(result.data?.message ?? 'Bulk action failed')));
			return;
		}
		await applyAction(result);
		await invalidateAll();
	}

	// Template picker (BASDEV-8)
	let templatePickerOpen = $state(false);
	const openTemplatePicker = () => (templatePickerOpen = true);

	function parseConfig(raw: string | undefined | null) {
		try {
			return JSON.parse(raw ?? '{}') as Record<string, unknown>;
		} catch {
			return {};
		}
	}

	// Customize pane edits the ACTIVE view; choices auto-save (no Save/Cancel) and
	// the pane follows whichever view tab is active.
	const TABLE_COLUMNS = ['priority', 'assignee', 'due', 'milestone', 'labels'] as const;
	// display labels match TableView's column-menu (same i18n keys, title-cased)
	const COLUMN_LABELS: Record<string, string> = {
		priority: 'Priority',
		assignee: 'Assignee',
		due: 'Due date',
		milestone: 'Milestone',
		labels: 'Labels'
	};
	const colOn = (key: string) => viewConfig[key] !== false;
	// custom-field columns shown in the table (top-level rows) — mirror TableView's
	// cfCols so Customize toggles the same `cf:<id>` keys as the table's "…" menu
	const tableCustomCols = $derived(data.customFields.filter((f) => fieldAppliesTo(f, false)));
	/** activeView config with one table column toggled, ready to POST. */
	const toggleColumnConfig = (key: string) =>
		JSON.stringify({ ...viewConfig, [key]: viewConfig[key] === false });

	// Group-by options for table + list views (config.groupBy); '' = no grouping.
	const GROUP_BY_OPTIONS = [
		['', 'None'],
		['milestone', 'Milestone'],
		['status', 'Status'],
		['due', 'Due date'],
		['assignee', 'Assignee'],
		['label', 'Labels']
	] as const;
	const groupByValue = $derived(
		typeof viewConfig.groupBy === 'string' ? (viewConfig.groupBy as string) : ''
	);
	const setGroupByConfig = (val: string) =>
		JSON.stringify({ ...viewConfig, groupBy: val || undefined });

	// Sort-by: a field (config.sortBy key) + a direction toggle (':desc' suffix).
	const SORT_FIELD_OPTIONS = [
		['', 'None'],
		['priority', 'Priority'],
		['order', 'Order'],
		['title', 'Title'],
		['due', 'Due date'],
		['status', 'Status'],
		['assignee', 'Assignee'],
		['createdAt', 'Created']
	] as const;
	const sortParsed = $derived(
		parseSortBy(typeof viewConfig.sortBy === 'string' ? (viewConfig.sortBy as string) : null)
	);
	const sortFieldValue = $derived(sortParsed.key ?? '');
	const setSortFieldConfig = (key: string) =>
		JSON.stringify({
			...viewConfig,
			sortBy: key ? key + (sortParsed.desc ? ':desc' : '') : undefined
		});
	const setSortDirConfig = (desc: boolean) =>
		JSON.stringify({
			...viewConfig,
			sortBy: sortParsed.key ? sortParsed.key + (desc ? ':desc' : '') : undefined
		});

	// Aggregations (config.aggregations): number fields summed per group, shown as "(x)".
	const numberFields = $derived(data.customFields.filter((f) => f.type === 'number'));
	const aggregationIds = $derived(
		Array.isArray(viewConfig.aggregations) ? (viewConfig.aggregations as string[]) : []
	);
	const aggOn = (id: string) => aggregationIds.includes(id);
	/** activeView config with one aggregation field toggled, ready to POST. */
	function toggleAggregationConfig(id: string) {
		const set = new Set(aggregationIds);
		set.has(id) ? set.delete(id) : set.add(id);
		const ids = numberFields.map((f) => f.id).filter((x) => set.has(x));
		return JSON.stringify({ ...viewConfig, aggregations: ids.length ? ids : undefined });
	}

	// Group-by options for the board view (config.groupBy); default = status.
	const BOARD_GROUP_BY_OPTIONS = [
		['status', 'Status'],
		['milestone', 'Milestone'],
		['assignee', 'Assignee'],
		['label', 'Labels']
	] as const;
	const boardGroupByValue = $derived(
		viewConfig.groupBy === 'milestone' ||
			viewConfig.groupBy === 'assignee' ||
			viewConfig.groupBy === 'label'
			? (viewConfig.groupBy as string)
			: 'status'
	);
	const setBoardGroupByConfig = (val: string) =>
		JSON.stringify({ ...viewConfig, groupBy: val === 'status' ? undefined : val });
	const shownStatusIds = $derived(
		Array.isArray(viewConfig.statusIds)
			? (viewConfig.statusIds as string[])
			: data.statuses.map((s) => s.id)
	);
	/** activeView config with one status flipped in the shown set, ready to POST. */
	function toggleStatusConfig(id: string) {
		const set = new Set(shownStatusIds);
		set.has(id) ? set.delete(id) : set.add(id);
		const ids = data.statuses.map((s) => s.id).filter((x) => set.has(x));
		return JSON.stringify({
			...viewConfig,
			statusIds: ids.length === data.statuses.length ? undefined : ids
		});
	}

	// Milestones pane: name → its dependencies (other milestones of this project)
	const milestoneName = (id: string) => data.milestones.find((m) => m.id === id)?.name ?? id;
	const milestoneDepsOf = (id: string) =>
		data.milestoneDeps.filter((d) => d.milestoneId === id).map((d) => d.dependsOnId);

	// Per-milestone task progress (top-level tasks only; done = completed-category status).
	const doneStatusIds = $derived(
		new Set(data.statuses.filter((s) => s.category === 'completed').map((s) => s.id))
	);
	function milestoneProgress(id: string) {
		const rows = data.tasks.filter((t) => !t.parentId && t.milestoneId === id);
		const done = rows.filter((t) => doneStatusIds.has(t.statusId)).length;
		return { done, total: rows.length, pct: rows.length ? Math.round((done / rows.length) * 100) : 0 };
	}

	// Milestone delete needs a confirm (frees its tasks' milestoneId).
	async function confirmDeleteMilestone(e: MouseEvent) {
		const formEl = (e.currentTarget as HTMLElement).closest('form');
		if (await confirmDialog($t('Delete this milestone?'), { danger: true, confirmLabel: $t('Delete') }))
			formEl?.requestSubmit();
	}

	// Tasks are editable by every member with project access; grants gate structure
	function canEditTask(_t: { id: string; parentId: string | null }) {
		return Boolean(data.user);
	}

	const statusDisplay = $derived(
		(data.project.statusDisplay ?? 'text') as 'text' | 'icon' | 'text-icon'
	);

	// New-task pane: opened from the header "+" (no prefill) or a grouped table's
	// per-group "+" (carries that group's status/milestone/assignee/due).
	function openNewTask(prefill: Record<string, string> = {}) {
		customizing = false;
		milestonesOpen = false;
		newMilestoneOpen = false;
		newTaskPrefill = prefill;
		newTaskOpen = true;
	}

	function openNewMilestone() {
		customizing = false;
		milestonesOpen = false;
		newTaskOpen = false;
		newMilestoneOpen = true;
	}

	// Realtime (ADR-026): subscribe to this project for live updates + presence.
	// The component is reused across project navigations, so re-subscribe when the
	// id changes; unsubscribe only when leaving the project route entirely.
	$effect(() => {
		subscribeProject(data.project.id);
	});
	onDestroy(() => unsubscribeProject());
	const others = $derived(presence.users.filter((u) => u.id !== data.user?.id));
	const initials = (name: string) =>
		name
			.split(/\s+/)
			.map((w) => w[0])
			.slice(0, 2)
			.join('')
			.toUpperCase();

	const VIEW_TYPES = ['table', 'board', 'list', 'timeline', 'calendar', 'dashboard', 'map'] as const;
	const VIEW_ICONS: Record<string, string> = {
		table: 'table',
		board: 'view-grid',
		list: 'list',
		timeline: 'calendar',
		calendar: 'calendar',
		dashboard: 'dashboard-dots',
		map: 'map-pin'
	};
	const displayOf = (v: { config: string }) => {
		const d = parseConfig(v.config).display;
		return d === 'icon' || d === 'text-icon' ? d : 'text';
	};

	const projectLabels = $derived(
		data.labels.filter((l) => data.projectLabelIds.includes(l.id))
	);
	const dependsOn = $derived(
		data.allProjects.filter((p) => data.projectDependsOn.includes(p.id))
	);

	// Filters (config.filters: TaskFilters) — mirrors FilterBar's facets, but set from
	// the Customize pane and persisted per view. Same keys/'_none' sentinels so the two
	// stay in sync. Priority/Assignee/Milestone/Label per request.
	const PRIORITY_FILTER_OPTIONS = [
		['urgent', 'Urgent'],
		['high', 'High'],
		['medium', 'Medium'],
		['low', 'Low'],
		['none', 'None']
	] as const;
	const filterGroups = $derived([
		{
			key: 'priorities',
			label: 'Priority',
			opts: PRIORITY_FILTER_OPTIONS.map(([v, l]) => [v, $t(l)] as [string, string])
		},
		{
			key: 'assigneeIds',
			label: 'Assignee',
			opts: [
				['_none', $t('Unassigned')] as [string, string],
				...data.users.map((u) => [u.id, u.name] as [string, string])
			]
		},
		{
			key: 'milestoneIds',
			label: 'Milestone',
			opts: [
				['_none', $t('No milestone')] as [string, string],
				...data.milestones.map((m) => [m.id, m.name] as [string, string])
			]
		},
		{
			key: 'labelIds',
			label: 'Labels',
			opts: [
				['_none', $t('No label')] as [string, string],
				...projectLabels.map((l) => [l.id, l.name] as [string, string])
			]
		}
	]);
	const viewFilters = $derived(
		(viewConfig.filters && typeof viewConfig.filters === 'object'
			? viewConfig.filters
			: {}) as Record<string, string[]>
	);
	const filterChosen = (key: string) => (Array.isArray(viewFilters[key]) ? viewFilters[key] : []);
	/** activeView config with one filter value toggled, ready to POST (empties dropped). */
	function toggleFilterConfig(key: string, value: string) {
		const cur = filterChosen(key);
		const next = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value];
		const merged: Record<string, unknown> = { ...viewFilters, [key]: next };
		const cleaned: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(merged)) if (Array.isArray(v) && v.length) cleaned[k] = v;
		return JSON.stringify({
			...viewConfig,
			filters: Object.keys(cleaned).length ? cleaned : undefined
		});
	}
	// Persist a config JSON to the active view without closing an open popover
	// (fetch + invalidate, like the FilterBar — not a form submit).
	async function postViewConfig(configJson: string) {
		if (!activeView || !canEditActiveView) return;
		const fd = new FormData();
		fd.set('id', activeView.id);
		fd.set('name', activeView.name);
		fd.set('config', configJson);
		await fetch(`${page.url.pathname}?/updateView`, { method: 'POST', body: fd });
		await invalidateAll();
	}

	const labelSections = $derived.by(() => {
		const q = labelQuery.trim().toLowerCase();
		const match = (l: { name: string }) => !q || l.name.toLowerCase().includes(q);
		return [
			...data.labelGroups.map((g) => ({
				group: g as { id: string; name: string } | null,
				labels: data.labels.filter((l) => l.groupId === g.id && match(l))
			})),
			{ group: null, labels: data.labels.filter((l) => !l.groupId && match(l)) }
		].filter((s) => s.labels.length > 0);
	});

	function openCtx(e: MouseEvent, viewId: string) {
		e.preventDefault();
		e.stopPropagation();
		ctx = { id: viewId, x: e.clientX, y: e.clientY };
		ctxSub = null;
		ctxRenaming = false;
	}

	function closeMenus() {
		projMenuOpen = false;
		addingView = false;
		ctx = null;
		ctxSub = null;
		ctxRenaming = false;
	}

	/** Merge a display mode into a view's config via the updateView action. */
	const displayConfig = (v: { config: string }, mode: string) =>
		JSON.stringify({ ...parseConfig(v.config), display: mode === 'text' ? undefined : mode });

	// --- View tab drag-and-drop reorder ---
	let dragViewId = $state<string | null>(null);
	let dragOverId = $state<string | null>(null);
	function onTabDrop(targetId: string) {
		const src = dragViewId;
		dragViewId = null;
		dragOverId = null;
		if (!src || src === targetId) return;
		const ids = visibleViews.map((v) => v.id);
		const from = ids.indexOf(src);
		const to = ids.indexOf(targetId);
		if (from < 0 || to < 0) return;
		ids.splice(from, 1);
		ids.splice(to, 0, src);
		const fd = new FormData();
		fd.set('ids', ids.join(','));
		fetch(`${page.url.pathname}?/reorderView`, { method: 'POST', body: fd }).then(() => invalidateAll());
	}
</script>

<svelte:head><title>{data.project.name} — Baskets</title></svelte:head>

<svelte:window
	onclick={closeMenus}
	oncontextmenu={(e) => {
		if (ctx && !(e.target as HTMLElement).closest('.ctx-menu')) closeMenus();
	}}
/>

<div class="proj-page">

<p class="u-tiny" style="margin-bottom: var(--sp-2);">
	<a href="/projects" class="back-link"><Icon name="arrow-left" size={12} /> {$t('Projects')}</a>
</p>

<div class="u-flex" style="margin-bottom: var(--sp-2); flex-wrap: wrap;">
	<h2 class="proj-title">
		{#if data.project.icon}<span class="proj-icon"><EntityIcon value={data.project.icon} size={22} /></span>{/if}<span class="proj-name">{data.project.name}</span>
	</h2>
	{#if data.project.pinned}
		<span class="u-muted" use:tooltip={$t('Pinned')}><Icon name="star" size={14} /></span>
	{/if}
	{#if data.perm.project}
		<!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
		<div class="menu-wrap" onclick={(e) => e.stopPropagation()}>
			<button
				class="dots-btn"
				aria-label={$t('Project menu')}
				aria-expanded={projMenuOpen}
				onclick={() => (projMenuOpen = !projMenuOpen)}
			>
				<Icon name="more-horiz" size={18} />
			</button>
			{#if projMenuOpen}
				<div class="menu" transition:popover>
					<!-- Create… (hover flyout): Task / Milestone -->
					<div class="menu-sub">
						<button class="menu-item menu-item--sub" aria-haspopup="true">
							{$t('Create…')} <span class="sub-arrow"><Icon name="nav-arrow-right" size={11} /></span>
						</button>
						<div class="flyout">
							<button
								class="menu-item"
								onclick={() => {
									projMenuOpen = false;
									openNewTask();
								}}
							>
								{$t('Task')}
							</button>
							<button
								class="menu-item"
								onclick={() => {
									projMenuOpen = false;
									openNewMilestone();
								}}
							>
								{$t('Milestone')}
							</button>
							<button
								class="menu-item"
								onclick={() => {
									projMenuOpen = false;
									openTemplatePicker();
								}}
							>
								{$t('New from template')}
							</button>
						</div>
					</div>

					<div class="menu-rule"></div>

					<!-- Status (hover flyout) -->
					<div class="menu-sub">
						<button class="menu-item menu-item--sub" aria-haspopup="true">
							{$t('Status')} <span class="sub-arrow"><Icon name="nav-arrow-right" size={11} /></span>
						</button>
						<div class="flyout">
							<form method="POST" action="?/setProjectStatus" use:enhance>
								<button class="menu-item" type="submit">
									<span class="check">{data.project.statusId ? '' : '✓'}</span>
									{$t('No status')}
								</button>
							</form>
							{#each data.projectStatuses as s (s.id)}
								<form method="POST" action="?/setProjectStatus" use:enhance>
									<input type="hidden" name="statusId" value={s.id} />
									<button class="menu-item" type="submit">
										<span class="check">{data.project.statusId === s.id ? '✓' : ''}</span>
										<span class="opt-dot" style="--c: {s.color || 'var(--color-muted)'}" aria-hidden="true"></span>
										{s.name}
									</button>
								</form>
							{/each}
						</div>
					</div>

					<div class="menu-rule"></div>

					<a class="menu-item" href="/projects/{data.project.id}/settings">
						{$t('Edit project…')}
					</a>
					<a
						class="menu-item"
						href="/api/projects/{data.project.id}/export?format=csv"
						download
						onclick={() => (projMenuOpen = false)}
					>
						{$t('Export CSV')}
					</a>
					<form
						method="POST"
						action="?/pinProject"
						use:enhance={() => {
							projMenuOpen = false;
							return async ({ update }) => update();
						}}
					>
						<button class="menu-item" type="submit">
							{data.project.pinned ? $t('Unpin') : $t('Pin')}
						</button>
					</form>

					<div class="menu-rule"></div>

					<div class="menu-sub">
						<button class="menu-item menu-item--sub" aria-haspopup="true">
							{$t('Icon')} <span class="sub-arrow"><Icon name="nav-arrow-right" size={11} /></span>
						</button>
						<div class="flyout flyout--picker">
							<IconPicker
								value={data.project.icon}
								onSelect={(v) => chooseIcon(v)}
								onRemove={() => chooseIcon('')}
							/>
						</div>
					</div>

					<div class="menu-sub">
						<button class="menu-item menu-item--sub" aria-haspopup="true">
							{$t('Labels')} <span class="sub-arrow"><Icon name="nav-arrow-right" size={11} /></span>
						</button>
						<div class="flyout">
							<!-- svelte-ignore a11y_autofocus -->
							<input
								class="label-search"
								placeholder={$t('Add labels…')}
								bind:value={labelQuery}
							/>
							{#each labelSections as section (section.group?.id ?? 'ungrouped')}
								{#if section.group}
									<span class="menu-heading">{section.group.name}</span>
								{/if}
								{#each section.labels as l (l.id)}
									{@const on = data.projectLabelIds.includes(l.id)}
									<form method="POST" action="?/toggleProjectLabel" use:enhance>
										<input type="hidden" name="labelId" value={l.id} />
										<button class="menu-item" type="submit">
											<span class="check">{on ? '✓' : ''}</span>
											{l.name}
										</button>
									</form>
								{/each}
							{:else}
								<span class="menu-heading">{$t('No labels.')}</span>
							{/each}
						</div>
					</div>

					<button
						class="menu-item"
						onclick={() => {
							customizing = false;
							milestonesOpen = true;
							projMenuOpen = false;
						}}
					>
						{$t('Milestones…')}
					</button>

					<div class="menu-rule"></div>

					<form
						method="POST"
						action="?/deleteProject"
						use:enhance={({ cancel }) => {
							if (!confirm($t('Delete this project and all its tasks?'))) cancel();
							return async ({ update }) => update();
						}}
					>
						<button class="menu-item menu-item--danger" type="submit">{$t('Delete')}</button>
					</form>

					<!-- hidden target for the IconPicker (emits the chosen value) -->
					<form
						method="POST"
						action="?/setProjectIcon"
						use:enhance={() => async ({ update }) => {
							projMenuOpen = false;
							await update();
						}}
						bind:this={iconFormEl}
						style="display: none;"
					>
						<input type="hidden" name="icon" bind:value={pendingIcon} />
					</form>
				</div>
			{/if}
		</div>
	{/if}
	{#if others.length > 0}
		<span style="flex: 1;"></span>
		<div class="presence" aria-label={$t('People viewing')}>
			{#each others as u (u.id)}
				<span class="avatar" use:tooltip={u.name}>{initials(u.name)}</span>
			{/each}
		</div>
	{/if}
</div>
{#if data.project.description}
	<p class="u-muted" style="margin-bottom: var(--sp-2); max-width: 65ch;">
		{data.project.description}
	</p>
{/if}
{#if projectLabels.length > 0 || dependsOn.length > 0}
	<div class="chips-row" style="margin-bottom: var(--sp-3);">
		{#each projectLabels as l (l.id)}
			<span class="badge">{l.name}</span>
		{/each}
		{#each dependsOn as p (p.id)}
			<a class="badge" href="/projects/{p.id}" style="text-decoration: none;">{p.name}</a>
		{/each}
	</div>
{/if}

{#if form?.message}
	<div class="alert alert-error" role="alert">{form.message}</div>
{/if}

<!-- View tabs -->
<div class="viewbar">
	{#each visibleViews as v (v.id)}
		{@const mode = displayOf(v)}
		<a
			class="view-tab"
			class:active={activeView?.id === v.id}
			class:drag-over={dragOverId === v.id && dragViewId !== v.id}
			class:dragging={dragViewId === v.id}
			href="?view={v.id}"
			data-sveltekit-noscroll
			use:tooltip={v.name}
			draggable={data.perm.views[v.id]}
			ondragstart={(e) => {
				dragViewId = v.id;
				if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
			}}
			ondragover={(e) => {
				if (dragViewId && dragViewId !== v.id) {
					e.preventDefault();
					dragOverId = v.id;
				}
			}}
			ondragleave={() => dragOverId === v.id && (dragOverId = null)}
			ondrop={(e) => {
				e.preventDefault();
				onTabDrop(v.id);
			}}
			ondragend={() => {
				dragViewId = null;
				dragOverId = null;
			}}
			oncontextmenu={(e) => {
				if (data.perm.views[v.id]) openCtx(e, v.id);
			}}
		>
			{#if mode !== 'text'}<Icon name={VIEW_ICONS[v.type] ?? 'table'} size={14} />{/if}
			{#if mode !== 'icon'}{v.name}{/if}
		</a>
	{/each}
	{#if data.perm.project}
		<!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
		<div class="add-view" onclick={(e) => e.stopPropagation()}>
			<button
				class="view-tab view-tab--ghost"
				aria-expanded={addingView}
				aria-label={$t('Add a view')}
				onclick={() => (addingView = !addingView)}
			>
				+
			</button>
			{#if addingView}
				<div class="add-view-menu" transition:slide={{ duration: 150 }}>
					{#each VIEW_TYPES as vt (vt)}
						<form
							method="POST"
							action="?/createView"
							use:enhance={() => {
								addingView = false;
								return async ({ update }) => update();
							}}
						>
							<input type="hidden" name="type" value={vt} />
							<button class="add-view-item" type="submit">
								<Icon name={VIEW_ICONS[vt]} size={14} />
								{$t(vt[0].toUpperCase() + vt.slice(1))}
							</button>
						</form>
					{/each}
					{#if hiddenViews.length > 0}
						<div class="menu-rule"></div>
						<span class="menu-heading">{$t('Hidden views')}</span>
						{#each hiddenViews as hv (hv.id)}
							<form
								method="POST"
								action="?/unhideView"
								use:enhance={() => {
									addingView = false;
									return async ({ update }) => update();
								}}
							>
								<input type="hidden" name="id" value={hv.id} />
								<button class="add-view-item" type="submit">
									<Icon name={VIEW_ICONS[hv.type] ?? 'table'} size={14} />
									{hv.name}
								</button>
							</form>
						{/each}
					{/if}
				</div>
			{/if}
		</div>
	{/if}
</div>

<!-- View context menu (right-click on a tab) -->
{#if ctx && ctxView}
	<!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
	<div
		class="ctx-menu"
		style="left: {ctx.x}px; top: {ctx.y}px;"
		transition:popover
		onclick={(e) => e.stopPropagation()}
	>
		{#if ctxRenaming}
			<form
				method="POST"
				action="?/updateView"
				use:enhance={() => {
					closeMenus();
					return async ({ update }) => update();
				}}
				class="ctx-rename"
			>
				<input type="hidden" name="id" value={ctxView.id} />
				<!-- svelte-ignore a11y_autofocus -->
				<input class="input" name="name" value={ctxView.name} required autofocus />
				<button class="btn btn-sm btn-primary" type="submit">{$t('Save')}</button>
			</form>
		{:else}
			<button class="menu-item" onclick={() => (ctxRenaming = true)}>{$t('Rename')}</button>
			<button
				class="menu-item menu-item--sub"
				aria-expanded={ctxSub === 'display'}
				onclick={() => (ctxSub = ctxSub === 'display' ? null : 'display')}
			>
				{$t('Display as')} <span class="sub-arrow"><Icon name="nav-arrow-right" size={11} /></span>
			</button>
			{#if ctxSub === 'display'}
				<div class="submenu" transition:slide={{ duration: 150 }}>
					{#each [['text-icon', 'Text and icon'], ['text', 'Text only'], ['icon', 'Icon only']] as [mode, label] (mode)}
						<form
							method="POST"
							action="?/updateView"
							use:enhance={() => {
								closeMenus();
								return async ({ update }) => update();
							}}
						>
							<input type="hidden" name="id" value={ctxView.id} />
							<input type="hidden" name="name" value={ctxView.name} />
							<input type="hidden" name="config" value={displayConfig(ctxView, mode)} />
							<button class="menu-item" type="submit">
								<span class="check">{displayOf(ctxView) === mode ? '✓' : ''}</span>
								{$t(label)}
							</button>
						</form>
					{/each}
				</div>
			{/if}
			<button
				class="menu-item"
				type="button"
				onclick={(e) => {
					// stop the window onclick (closeMenus) from swallowing this same
					// click — that race made the pane open then vanish immediately.
					e.stopPropagation();
					const id = ctxView.id;
					closeMenus();
					milestonesOpen = false;
					customizing = true;
					if (activeView?.id !== id) goto(`?view=${id}`, { noScroll: true, keepFocus: true });
				}}
			>
				{$t('Customize')}
			</button>

			<div class="menu-rule"></div>

			<form
				method="POST"
				action="?/duplicateView"
				use:enhance={() => {
					closeMenus();
					return async ({ update }) => update();
				}}
			>
				<input type="hidden" name="id" value={ctxView.id} />
				<button class="menu-item" type="submit">{$t('Duplicate view')}</button>
			</form>
			<form
				method="POST"
				action="?/deleteView"
				use:enhance={({ cancel }) => {
					if (!confirm($t('Delete this view? This cannot be undone.'))) {
						cancel();
						return;
					}
					closeMenus();
					return async ({ update }) => update();
				}}
			>
				<input type="hidden" name="id" value={ctxView.id} />
				<button class="menu-item menu-item--danger" type="submit">{$t('Delete view')}</button>
			</form>
		{/if}
	</div>
{/if}

<!-- Single-select pill (Group by / Sort field): label + current value, popover of options. -->
{#snippet selectPill(
	label: string,
	options: readonly (readonly [string, string])[],
	currentVal: string,
	configFn: (v: string) => string
)}
	{@const curLabel = options.find(([v]) => v === currentVal)?.[1] ?? options[0]?.[1] ?? ''}
	<span class="cz-pill" class:cz-pill--on={!!currentVal}>
		<Popover ariaLabel={label}>
			{#snippet trigger()}{label}: {$t(curLabel)}{/snippet}
			{#snippet panel(close)}
				<div class="cz-opts">
					{#each options as [val, lbl] (val)}
						<button
							class="cz-opt"
							class:cz-opt--on={currentVal === val}
							type="button"
							onclick={() => {
								postViewConfig(configFn(val));
								close();
							}}
						>
							<span class="cz-check">{#if currentVal === val}<Icon name="check" size={13} />{/if}</span>
							{$t(lbl)}
						</button>
					{/each}
				</div>
			{/snippet}
		</Popover>
	</span>
{/snippet}

<!-- Multi-select filter pill: label + count, popover of checkable items (stays open). -->
{#snippet filterPill(group: { key: string; label: string; opts: [string, string][] })}
	{@const chosen = filterChosen(group.key)}
	<span class="cz-pill" class:cz-pill--on={chosen.length > 0}>
		<Popover ariaLabel={$t(group.label)}>
			{#snippet trigger()}{$t(group.label)}{#if chosen.length}<span class="cz-count">{chosen.length}</span>{/if}{/snippet}
			{#snippet panel()}
				<div class="cz-opts">
					{#each group.opts as [val, lbl] (val)}
						<button
							class="cz-opt"
							class:cz-opt--on={chosen.includes(val)}
							type="button"
							onclick={() => postViewConfig(toggleFilterConfig(group.key, val))}
						>
							<span class="cz-check">{#if chosen.includes(val)}<Icon name="check" size={13} />{/if}</span>
							{lbl}
						</button>
					{:else}
						<span class="cz-empty">{$t('No options')}</span>
					{/each}
				</div>
			{/snippet}
		</Popover>
	</span>
{/snippet}

<!-- Customize pane (ADR-025): edits the ACTIVE view; changes apply immediately (auto-save) -->
{#if customizing && activeView && canEditActiveView}
	<SidePane title={`${$t('Customize')} — ${activeView.name}`} onClose={() => (customizing = false)}>
		<div class="field">
			<label class="label" for="vname">{$t('View name')}</label>
			<form method="POST" action="?/updateView" use:enhance>
				<input type="hidden" name="id" value={activeView.id} />
				<input
					id="vname"
					name="name"
					class="input"
					value={activeView.name}
					required
					onblur={(e) => e.currentTarget.form?.requestSubmit()}
				/>
			</form>
		</div>

		{#if activeView.type === 'table'}
			<span class="label">{$t('Group by')}</span>
			<div class="chips-row">
				{@render selectPill($t('Group by'), GROUP_BY_OPTIONS, groupByValue, setGroupByConfig)}
			</div>
			<span class="label">{$t('Sort by')}</span>
			<div class="chips-row">
				{@render selectPill($t('Sort by'), SORT_FIELD_OPTIONS, sortFieldValue, setSortFieldConfig)}
				{#if sortFieldValue}
					<span class="seg">
						<button
							class="seg-btn"
							class:seg-btn--on={!sortParsed.desc}
							type="button"
							onclick={() => postViewConfig(setSortDirConfig(false))}>{$t('A–Z')}</button
						><button
							class="seg-btn"
							class:seg-btn--on={sortParsed.desc}
							type="button"
							onclick={() => postViewConfig(setSortDirConfig(true))}>{$t('Z–A')}</button
						>
					</span>
				{/if}
			</div>
			<span class="label">{$t('Columns')}</span>
			<div class="chips-row">
				{#each TABLE_COLUMNS as key (key)}
					<form method="POST" action="?/updateView" use:enhance>
						<input type="hidden" name="id" value={activeView.id} />
						<input type="hidden" name="name" value={activeView.name} />
						<input type="hidden" name="config" value={toggleColumnConfig(key)} />
						<button class="chip" class:chip--on={colOn(key)} type="submit">{$t(COLUMN_LABELS[key])}</button>
					</form>
				{/each}
				{#each tableCustomCols as f (f.id)}
					<form method="POST" action="?/updateView" use:enhance>
						<input type="hidden" name="id" value={activeView.id} />
						<input type="hidden" name="name" value={activeView.name} />
						<input type="hidden" name="config" value={toggleColumnConfig(`cf:${f.id}`)} />
						<button class="chip" class:chip--on={colOn(`cf:${f.id}`)} type="submit">{f.name}</button>
					</form>
				{/each}
			</div>
			<span class="label">{$t('Statuses shown')}</span>
			<div class="chips-row">
				{#each data.statuses as s (s.id)}
					<form method="POST" action="?/updateView" use:enhance>
						<input type="hidden" name="id" value={activeView.id} />
						<input type="hidden" name="name" value={activeView.name} />
						<input type="hidden" name="config" value={toggleStatusConfig(s.id)} />
						<button class="chip" class:chip--on={shownStatusIds.includes(s.id)} type="submit">{s.name}</button>
					</form>
				{/each}
			</div>
		{/if}

		{#if activeView.type === 'board'}
			<span class="label">{$t('Group by')}</span>
			<div class="chips-row">
				{@render selectPill(
					$t('Group by'),
					BOARD_GROUP_BY_OPTIONS,
					boardGroupByValue,
					setBoardGroupByConfig
				)}
			</div>
			<span class="label">{$t('Statuses shown')}</span>
			<div class="chips-row">
				{#each data.statuses as s (s.id)}
					<form method="POST" action="?/updateView" use:enhance>
						<input type="hidden" name="id" value={activeView.id} />
						<input type="hidden" name="name" value={activeView.name} />
						<input type="hidden" name="config" value={toggleStatusConfig(s.id)} />
						<button class="chip" class:chip--on={shownStatusIds.includes(s.id)} type="submit">{s.name}</button>
					</form>
				{/each}
			</div>
		{/if}

		{#if activeView.type === 'list'}
			<span class="label">{$t('Group by')}</span>
			<div class="chips-row">
				{@render selectPill($t('Group by'), GROUP_BY_OPTIONS, groupByValue, setGroupByConfig)}
			</div>
		{/if}

		{#if ['table', 'board', 'list'].includes(activeView.type)}
			<span class="label">{$t('Filters')}</span>
			<div class="chips-row">
				{#each filterGroups as group (group.key)}
					{@render filterPill(group)}
				{/each}
			</div>
		{/if}

		{#if ['table', 'board', 'list'].includes(activeView.type) && numberFields.length}
			<span class="label">{$t('Aggregations')}</span>
			<div class="chips-row">
				{#each numberFields as f (f.id)}
					<form method="POST" action="?/updateView" use:enhance>
						<input type="hidden" name="id" value={activeView.id} />
						<input type="hidden" name="name" value={activeView.name} />
						<input type="hidden" name="config" value={toggleAggregationConfig(f.id)} />
						<button class="chip" class:chip--on={aggOn(f.id)} type="submit">{f.name}</button>
					</form>
				{/each}
			</div>
		{/if}

		<div class="customize-actions">
			<button class="btn btn-sm" type="button" onclick={() => (customizing = false)}>{$t('Close')}</button>
			{#if visibleViews.length > 1}
				<form
					method="POST"
					action="?/deleteView"
					use:enhance={({ cancel }) => {
						if (!confirm($t('Delete this view? This cannot be undone.'))) {
							cancel();
							return;
						}
						return async ({ update }) => {
							customizing = false;
							update();
						};
					}}
				>
					<input type="hidden" name="id" value={activeView.id} />
					<button class="btn btn-sm btn-outline btn-error" type="submit">{$t('Delete view')}</button>
				</form>
			{/if}
		</div>
	</SidePane>
{/if}

<!-- Milestones pane (ADR-025): opened from the project "…" menu -->
{#if milestonesOpen && data.perm.project}
	<SidePane title={$t('Milestones')} onClose={() => (milestonesOpen = false)}>
		{#each data.milestones as m (m.id)}
			{@const deps = milestoneDepsOf(m.id)}
			{@const prog = milestoneProgress(m.id)}
			<div class="ms-card">
				<div class="ms-head">
					<form method="POST" action="?/updateMilestone" use:enhance class="ms-name-form">
						<input type="hidden" name="id" value={m.id} />
						<input
							class="ms-name"
							name="name"
							value={m.name}
							required
							aria-label={$t('Milestone name')}
							onblur={(e) => e.currentTarget.value.trim() && e.currentTarget.value !== m.name && e.currentTarget.form?.requestSubmit()}
							onkeydown={(e) => e.key === 'Enter' && (e.preventDefault(), e.currentTarget.blur())}
						/>
					</form>
					<form method="POST" action="?/deleteMilestone" use:enhance>
						<input type="hidden" name="id" value={m.id} />
						<button class="ms-del" type="button" onclick={confirmDeleteMilestone} aria-label={$t('Delete milestone')}>
							<Icon name="trash" size={14} />
						</button>
					</form>
				</div>

				<div class="ms-progress" use:tooltip={`${prog.done}/${prog.total} ${$t('done')}`}>
					<div class="ms-bar"><div class="ms-bar-fill" style={`width:${prog.pct}%`}></div></div>
					<span class="ms-prog-text">{prog.done}/{prog.total}</span>
				</div>

				<div class="ms-meta">
					<form method="POST" action="?/updateMilestone" use:enhance class="ms-date-form">
						<input type="hidden" name="id" value={m.id} />
						<Icon name="play" size={13} />
						<input
							class="ms-date"
							type="date"
							name="startDate"
							value={m.startDate ? new Date(m.startDate).toISOString().slice(0, 10) : ''}
							aria-label={$t('Start date')}
							onchange={(e) => e.currentTarget.form?.requestSubmit()}
						/>
					</form>
					<form method="POST" action="?/updateMilestone" use:enhance class="ms-date-form">
						<input type="hidden" name="id" value={m.id} />
						<Icon name="calendar" size={13} />
						<input
							class="ms-date"
							type="date"
							name="targetDate"
							value={m.targetDate ? new Date(m.targetDate).toISOString().slice(0, 10) : ''}
							aria-label={$t('Target date')}
							onchange={(e) => e.currentTarget.form?.requestSubmit()}
						/>
					</form>
				</div>

				<div class="ms-deps">
					<span class="u-tiny u-muted">{$t('Depends on')}</span>
					<Popover ariaLabel={$t('Dependencies')}>
						{#snippet trigger()}
							<span class="pill-val" class:pill-ph={deps.length === 0}>
								{deps.length ? deps.map(milestoneName).join(', ') : $t('No milestone')}
							</span>
						{/snippet}
						{#snippet panel()}
							<form method="POST" action="?/setMilestoneDeps" use:enhance>
								<input type="hidden" name="milestoneId" value={m.id} />
								<button class="opt" class:opt--on={deps.length === 0} type="submit">
									<span class="opt-check">{#if deps.length === 0}<Icon name="check" size={13} />{/if}</span>
									{$t('No milestone')}
								</button>
							</form>
							{#each data.milestones.filter((x) => x.id !== m.id) as opt (opt.id)}
								<form method="POST" action="?/setMilestoneDeps" use:enhance>
									<input type="hidden" name="milestoneId" value={m.id} />
									{#each (deps.includes(opt.id) ? deps.filter((d) => d !== opt.id) : [...deps, opt.id]) as id (id)}
										<input type="hidden" name="dependsOnId" value={id} />
									{/each}
									<button class="opt" class:opt--on={deps.includes(opt.id)} type="submit">
										<span class="opt-check">{#if deps.includes(opt.id)}<Icon name="check" size={13} />{/if}</span>
										{opt.name}
									</button>
								</form>
							{/each}
						{/snippet}
					</Popover>
				</div>
			</div>
		{:else}
			<p class="u-tiny u-muted ms-empty">{$t('No milestones yet.')}</p>
		{/each}

		<form method="POST" action="?/createMilestone" use:enhance={() => async ({ formElement, update }) => { await update({ reset: false }); formElement.reset(); }} class="ms-new">
			<div class="ms-new-row">
				<input name="name" class="input" style="flex:0 1 180px; min-width:0;" placeholder={$t('New milestone…')} required />
				<span class="ms-date-pill">
					<Icon name="calendar" size={13} />
					<span class="u-tiny u-muted">{$t('Due date')}</span>
					<input name="targetDate" type="date" class="ms-date" aria-label={$t('Due date')} />
				</span>
			</div>
			<button class="btn btn-sm btn-primary" type="submit">{$t('Add milestone')}</button>
		</form>
	</SidePane>
{/if}

<!-- New task pane (ADR-027): header "+" or a grouped table's per-group "+" -->
{#if newTaskOpen && data.user}
	<NewTaskPane
		statuses={data.statuses}
		users={data.users}
		milestones={data.milestones}
		locations={data.locations}
		tasks={data.tasks}
		customFields={data.customFields}
		customFieldOptions={data.customFieldOptions}
		prefill={newTaskPrefill}
		onClose={() => (newTaskOpen = false)}
	/>
{/if}

{#if newMilestoneOpen && data.perm.project}
	<NewMilestonePane onClose={() => (newMilestoneOpen = false)} />
{/if}

{#if activeView && ['table', 'board', 'list'].includes(activeView.type)}
	<div class="filter-row">
		<FilterBar
			tasks={data.tasks}
			statuses={data.statuses}
			users={data.users}
			milestones={data.milestones}
			labels={projectLabels}
			config={viewConfig}
			bind:searchText
			viewId={activeView.id}
			viewName={activeView.name}
			canEditView={canEditActiveView}
		/>
		<div class="saved-filters-slot">
			<SavedFilters
				savedFilters={data.savedFilters}
				currentConfig={viewConfig}
				canEdit={canEditActiveView}
				onApply={applySavedFilter}
			/>
		</div>
	</div>
{/if}

<!-- Active view -->
{#if activeView?.type === 'table'}
	<TableView
		tasks={filteredTasks}
		users={data.users}
		statuses={data.statuses}
		milestones={data.milestones}
		locations={data.locations}
		labels={data.labels}
		taskLabels={data.taskLabels}
		taskDeps={data.taskDeps}
		customFields={data.customFields}
		customFieldOptions={data.customFieldOptions}
		taskCustomValues={data.taskCustomValues}
		files={data.files}
		config={viewConfig}
		viewId={activeView.id}
		viewName={activeView.name}
		canEditView={Boolean(activeView && data.perm.views[activeView.id])}
		onNewTask={openNewTask}
		{statusDisplay}
		{canEditTask}
		templates={data.templates}
	/>
{:else if activeView?.type === 'board'}
	<BoardView
		tasks={filteredTasks}
		statuses={data.statuses}
		users={data.users}
		labels={data.labels}
		taskLabels={data.taskLabels}
		taskDeps={data.taskDeps}
		milestones={data.milestones}
		locations={data.locations}
		customFields={data.customFields}
		customFieldOptions={data.customFieldOptions}
		taskCustomValues={data.taskCustomValues}
		files={data.files}
		config={viewConfig}
		viewId={activeView.id}
		viewName={activeView.name}
		canEditView={Boolean(activeView && data.perm.views[activeView.id])}
		onNewTask={openNewTask}
		{statusDisplay}
		{canEditTask}
		templates={data.templates}
	/>
{:else if activeView?.type === 'list'}
	<ListView
		tasks={filteredTasks}
		statuses={data.statuses}
		users={data.users}
		labels={data.labels}
		taskLabels={data.taskLabels}
		taskDeps={data.taskDeps}
		milestones={data.milestones}
		locations={data.locations}
		customFields={data.customFields}
		customFieldOptions={data.customFieldOptions}
		taskCustomValues={data.taskCustomValues}
		files={data.files}
		config={viewConfig}
		{statusDisplay}
		{canEditTask}
		templates={data.templates}
	/>
{:else if activeView?.type === 'timeline'}
	<TimelineView
		tasks={filteredTasks}
		statuses={data.statuses}
		users={data.users}
		labels={data.labels}
		taskLabels={data.taskLabels}
		taskDeps={data.taskDeps}
		milestones={data.milestones}
		locations={data.locations}
		customFields={data.customFields}
		customFieldOptions={data.customFieldOptions}
		taskCustomValues={data.taskCustomValues}
		files={data.files}
		config={viewConfig}
		viewId={activeView.id}
		viewName={activeView.name}
		canEditView={Boolean(activeView && data.perm.views[activeView.id])}
		onNewTask={openNewTask}
		{statusDisplay}
		{canEditTask}
		templates={data.templates}
	/>
{:else if activeView?.type === 'calendar'}
	<CalendarView
		tasks={filteredTasks}
		statuses={data.statuses}
		users={data.users}
		labels={data.labels}
		taskLabels={data.taskLabels}
		taskDeps={data.taskDeps}
		milestones={data.milestones}
		locations={data.locations}
		customFields={data.customFields}
		customFieldOptions={data.customFieldOptions}
		taskCustomValues={data.taskCustomValues}
		files={data.files}
		config={viewConfig}
		viewId={activeView.id}
		viewName={activeView.name}
		canEditView={Boolean(activeView && data.perm.views[activeView.id])}
		onNewTask={openNewTask}
		{statusDisplay}
		{canEditTask}
		templates={data.templates}
	/>
{:else if activeView?.type === 'dashboard'}
	<DashboardView tasks={data.tasks} statuses={data.statuses} milestones={data.milestones} />
{:else if activeView?.type === 'map'}
	<MapView tasks={data.tasks} locations={data.locations} />
{/if}

{#if templatePickerOpen}
	<TemplatePicker templates={data.templates} onClose={() => (templatePickerOpen = false)} />
{/if}

{#if (activeView?.type === 'table' || activeView?.type === 'board' || activeView?.type === 'list') && selection.size > 0}
	<BulkActionBar
		count={selection.size}
		statuses={data.statuses}
		users={data.users}
		milestones={data.milestones}
		canEdit={canEditActiveView}
		onSetStatus={(statusId) => bulkSubmit('bulkPatchTasks', { statusId })}
		onSetAssignee={(assigneeId) => bulkSubmit('bulkPatchTasks', { assigneeId: assigneeId ?? '' })}
		onSetMilestone={(milestoneId) => bulkSubmit('bulkPatchTasks', { milestoneId: milestoneId ?? '' })}
		onSetPriority={(priority) => bulkSubmit('bulkPatchTasks', { priority })}
		onDelete={async () => {
			await bulkSubmit('bulkDeleteTasks', {});
			selection.clear();
		}}
		onClear={() => selection.clear()}
	/>
{/if}

</div>

<style>
	.menu-wrap {
		position: relative;
	}

	.dots-btn {
		border: none;
		background: none;
		font-size: 18px;
		line-height: 1;
		letter-spacing: 1px;
		color: var(--color-muted);
		cursor: pointer;
		padding: 2px 8px;
		transition: color var(--dur-fast) ease, background var(--dur-fast) ease;
	}

	.dots-btn:hover {
		color: var(--color-fg);
		background: var(--color-surface-muted);
	}

	.menu,
	.ctx-menu {
		background: var(--color-bg);
		border: 1px solid var(--color-border-subtle);
		min-width: 200px;
		max-width: 280px;
		z-index: 30;
		padding: var(--sp-1) 0;
	}

	.menu {
		position: absolute;
		top: 100%;
		left: 0;
		transform-origin: top left;
	}

	.ctx-menu {
		position: fixed;
		transform-origin: top left;
	}

	.menu-item {
		display: flex;
		align-items: center;
		gap: var(--sp-1);
		width: 100%;
		border: none;
		background: none;
		font-family: var(--font-body);
		font-size: 13px;
		font-weight: 400;
		color: var(--color-fg);
		text-align: left;
		text-decoration: none;
		padding: var(--sp-1) var(--sp-2);
		cursor: pointer;
		transition: background var(--dur-fast) ease;
	}

	.menu-item:hover {
		background: var(--color-surface-muted);
	}

	.menu-item--sub {
		justify-content: space-between;
	}

	.menu-item--danger {
		color: var(--color-error);
	}

	.sub-arrow {
		color: var(--color-muted);
		font-size: 11px;
	}

	.menu-rule {
		border-top: 1px solid var(--color-border-subtle);
		margin: var(--sp-1) 0;
	}

	.menu-heading {
		display: block;
		font-size: 11px;
		color: var(--color-muted);
		padding: var(--sp-1) var(--sp-2) 2px;
	}

	.submenu {
		border-top: 1px solid var(--color-border-subtle);
		border-bottom: 1px solid var(--color-border-subtle);
		background: var(--color-surface-muted);
		max-height: 240px;
		overflow-y: auto;
	}

	.check {
		display: inline-block;
		width: 14px;
		font-size: 11px;
	}

	.back-link {
		display: inline-flex;
		align-items: center;
		gap: 4px;
	}

	.proj-title {
		display: inline-flex;
		align-items: center;
		gap: var(--sp-1);
		overflow-wrap: anywhere;
	}

	.proj-icon {
		flex: 0 0 auto;
		line-height: 1;
	}

	.proj-name {
		min-width: 0;
	}

	/* Realtime presence cluster (ADR-026): avatars of others viewing the project */
	.presence {
		display: flex;
		align-items: center;
	}

	.presence .avatar {
		width: 24px;
		height: 24px;
		flex: 0 0 24px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border-radius: 999px;
		background: var(--color-fg);
		color: var(--color-bg);
		font-size: 10px;
		font-weight: 600;
		letter-spacing: 0.02em;
		border: 2px solid var(--color-bg);
		margin-left: -8px;
	}

	.presence .avatar:first-child {
		margin-left: 0;
	}

	.opt-dot {
		display: inline-block;
		width: 8px;
		height: 8px;
		border-radius: 999px;
		background: var(--c);
	}

	/* Hover-flyout submenus inside the "…" menu */
	.menu-sub {
		position: relative;
	}

	.flyout {
		position: absolute;
		top: 0;
		left: 100%;
		margin-left: -1px;
		min-width: 200px;
		max-width: 280px;
		max-height: 300px;
		overflow-y: auto;
		background: var(--color-bg);
		border: 1px solid var(--color-border-subtle);
		padding: var(--sp-1) 0;
		z-index: 31;
		display: none;
	}

	.menu-sub:hover > .flyout,
	.menu-sub:focus-within > .flyout {
		display: block;
	}

	/* the icon picker manages its own width + internal scroll */
	.flyout--picker {
		min-width: 0;
		max-width: none;
		max-height: none;
		overflow: visible;
		padding: 0;
	}

	/* keep the flyout on-screen if the menu is near the right edge */
	@media (max-width: 720px) {
		.flyout {
			left: auto;
			right: 100%;
			margin-left: 0;
			margin-right: -1px;
		}
	}

	.label-search {
		display: block;
		width: calc(100% - var(--sp-2) * 2);
		margin: var(--sp-1) var(--sp-2);
		border: none;
		border-bottom: 1px solid var(--color-border-subtle);
		background: none;
		font-family: var(--font-body);
		font-size: 13px;
		padding: 2px 0;
		outline: none;
	}

	.label-search:focus {
		border-bottom-color: var(--color-fg);
	}

	.ctx-rename {
		display: flex;
		gap: var(--sp-1);
		padding: var(--sp-1) var(--sp-2);
	}

	.ctx-rename .input {
		font-size: 13px;
		padding: 2px 6px;
	}

	.viewbar {
		display: flex;
		align-items: center;
		gap: var(--sp-1);
		border-bottom: 1px solid var(--color-border-subtle);
		margin-bottom: var(--sp-3);
		padding-bottom: 0;
		flex-wrap: wrap;
	}

	/* filter bar row: FilterBar fills, Saved filters pinned far right */
	.filter-row {
		display: flex;
		align-items: flex-start;
		gap: var(--sp-2);
		margin-bottom: var(--sp-3);
	}

	.filter-row :global(.filterbar) {
		flex: 1 1 auto;
		margin-bottom: 0;
	}

	.saved-filters-slot {
		margin-left: auto;
		flex: 0 0 auto;
	}

	.view-tab {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 14px;
		font-weight: 400;
		color: var(--color-muted);
		text-decoration: none;
		padding: var(--sp-1) var(--sp-2);
		border: none;
		background: none;
		cursor: pointer;
		border-bottom: 2px solid transparent;
		margin-bottom: -1px;
		transition: color var(--dur) ease;
	}

	.view-tab:hover {
		color: var(--color-fg);
	}

	.view-tab.active {
		color: var(--color-fg);
		font-weight: 600;
		border-bottom-color: var(--color-fg);
	}

	.view-tab.dragging {
		opacity: 0.4;
	}

	.view-tab.drag-over {
		border-bottom-color: color-mix(in oklab, var(--color-fg) 40%, var(--color-bg));
		color: var(--color-fg);
	}

	.view-tab--ghost {
		font-family: var(--font-body);
		font-size: 15px;
	}

	.add-view {
		position: relative;
		opacity: 0;
		transition: opacity var(--dur) ease;
	}

	.viewbar:hover .add-view,
	.viewbar:focus-within .add-view,
	.add-view:has([aria-expanded='true']) {
		opacity: 1;
	}

	.add-view-menu {
		position: absolute;
		top: 100%;
		left: 0;
		z-index: 9;
		background: var(--color-bg);
		border: 1px solid var(--color-border-subtle);
		min-width: 160px;
	}

	.add-view-item {
		display: flex;
		align-items: center;
		gap: var(--sp-1);
		width: 100%;
		border: none;
		background: none;
		font-family: var(--font-body);
		font-size: 14px;
		color: var(--color-fg);
		text-align: left;
		padding: var(--sp-1) var(--sp-2);
		cursor: pointer;
		transition: background var(--dur-fast) ease;
	}

	.add-view-item:hover {
		background: var(--color-surface-muted);
	}

	.chips-row {
		display: flex;
		align-items: center;
		gap: var(--sp-1);
		flex-wrap: wrap;
		margin-bottom: var(--sp-2);
	}

	/* Customize pills (Group by / Sort / Filters) — Popover-driven facets. */
	.cz-pill {
		display: inline-flex;
	}

	.cz-pill :global(.pill) {
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--color-muted);
		gap: 4px;
		padding: 2px 8px;
	}

	.cz-pill--on :global(.pill) {
		background: color-mix(in oklab, var(--color-fg) 12%, var(--color-bg));
		border-color: color-mix(in oklab, var(--color-fg) 30%, var(--color-bg));
		color: var(--color-fg);
	}

	.cz-count {
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

	.cz-opts {
		display: flex;
		flex-direction: column;
		min-width: 180px;
		max-height: 260px;
		overflow-y: auto;
	}

	.cz-opt {
		display: flex;
		align-items: center;
		gap: 6px;
		width: 100%;
		border: none;
		background: none;
		color: var(--color-fg);
		font-size: 13px;
		text-align: left;
		padding: 6px 8px;
		border-radius: var(--radius-field, 0.25rem);
		cursor: pointer;
	}

	.cz-opt:hover {
		background: var(--color-surface-muted);
	}

	.cz-opt--on {
		font-weight: 600;
	}

	.cz-check {
		display: inline-flex;
		width: 13px;
		flex: 0 0 13px;
		color: var(--color-fg);
	}

	.cz-empty {
		font-size: 12px;
		color: var(--color-muted);
		padding: 6px 8px;
	}

	/* Sort direction segmented toggle [A–Z | Z–A] */
	.seg {
		display: inline-flex;
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-field, 0.25rem);
		overflow: hidden;
	}

	.seg-btn {
		border: none;
		background: var(--color-bg);
		color: var(--color-muted);
		font-family: var(--font-mono);
		font-size: 11px;
		line-height: 1.7;
		padding: 0 8px;
		cursor: pointer;
		transition: background var(--dur-fast) ease, color var(--dur-fast) ease;
	}

	.seg-btn + .seg-btn {
		border-left: 1px solid var(--color-border-subtle);
	}

	.seg-btn:hover {
		background: var(--color-surface-muted);
	}

	.seg-btn--on {
		background: var(--color-surface-muted);
		color: var(--color-fg);
		font-weight: 600;
	}

	.chip {
		border: 1px solid var(--color-border-subtle);
		background: var(--color-bg);
		color: var(--color-muted);
		font-family: var(--font-mono);
		font-size: 11px;
		padding: 1px 8px;
		cursor: pointer;
		transition:
			background 0.15s ease,
			color 0.15s ease;
	}

	.chip:hover {
		border-color: var(--color-fg);
		color: var(--color-fg);
	}

	.customize-actions {
		display: flex;
		gap: var(--sp-2);
		align-items: center;
		margin-top: var(--sp-3);
	}

	.chip--on {
		background: color-mix(in oklab, var(--color-fg) 12%, var(--color-bg));
		border-color: color-mix(in oklab, var(--color-fg) 30%, var(--color-bg));
		color: var(--color-fg);
	}

	.chip--on:hover {
		border-color: color-mix(in oklab, var(--color-fg) 45%, var(--color-bg));
		color: var(--color-fg);
	}

	.ms-card {
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-box, 0.5rem);
		padding: var(--sp-2);
		margin-bottom: var(--sp-2);
		display: flex;
		flex-direction: column;
		gap: var(--sp-1);
		background: var(--color-bg);
	}

	.ms-head {
		display: flex;
		align-items: center;
		gap: var(--sp-1);
	}

	.ms-name-form {
		flex: 1;
		min-width: 0;
	}

	.ms-name {
		width: 100%;
		border: 1px solid transparent;
		background: none;
		font-size: 14px;
		font-weight: 600;
		color: var(--color-fg);
		padding: 2px 6px;
		border-radius: var(--radius-field, 0.25rem);
	}

	.ms-name:hover {
		border-color: var(--color-border-subtle);
	}

	.ms-name:focus {
		border-color: color-mix(in oklab, var(--color-fg) 35%, var(--color-bg));
		background: var(--color-base-100);
	}

	.ms-del {
		display: inline-flex;
		border: none;
		background: none;
		cursor: pointer;
		color: var(--color-muted);
		padding: 4px;
		border-radius: var(--radius-field, 0.25rem);
	}

	.ms-del:hover {
		color: var(--color-error);
		background: var(--color-surface-muted);
	}

	.ms-progress {
		display: flex;
		align-items: center;
		gap: var(--sp-2);
	}

	.ms-bar {
		flex: 1;
		height: 6px;
		border-radius: 999px;
		background: var(--color-surface-muted);
		overflow: hidden;
	}

	.ms-bar-fill {
		height: 100%;
		border-radius: 999px;
		background: color-mix(in oklab, var(--color-success, var(--color-fg)) 70%, var(--color-bg));
		transition: width var(--dur) ease;
	}

	.ms-prog-text {
		font-size: 11px;
		color: var(--color-muted);
		font-variant-numeric: tabular-nums;
	}

	.ms-meta {
		display: flex;
		align-items: center;
	}

	.ms-date-form {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		color: var(--color-muted);
	}

	.ms-date {
		border: 1px solid transparent;
		background: none;
		font-size: 12px;
		color: var(--color-muted);
		padding: 2px 4px;
		border-radius: var(--radius-field, 0.25rem);
		font-family: var(--font-mono);
	}

	.ms-date:hover {
		border-color: var(--color-border-subtle);
	}

	.ms-deps {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px;
	}

	.ms-empty {
		margin-bottom: var(--sp-2);
	}

	.ms-new {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--sp-2);
		margin-top: var(--sp-3);
		padding-top: var(--sp-3);
		border-top: 1px solid var(--color-border-subtle);
	}

	.ms-new-row {
		display: flex;
		gap: var(--sp-2);
		align-items: center;
		width: 100%;
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

	.opt--on {
		font-weight: 600;
	}

	.opt-check {
		display: inline-flex;
		width: 13px;
		flex: 0 0 13px;
		color: var(--color-fg);
	}

	.ms-date-pill {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 2px 8px;
		border: 1px solid var(--color-border-subtle);
		border-radius: 999px;
		color: var(--color-muted);
	}

	.ms-date-pill:focus-within {
		border-color: color-mix(in oklab, var(--color-fg) 35%, var(--color-bg));
	}

	.ms-date-pill .ms-date {
		border: none;
		padding: 0;
	}

	.ms-date-pill .ms-date:hover {
		border: none;
	}

</style>
