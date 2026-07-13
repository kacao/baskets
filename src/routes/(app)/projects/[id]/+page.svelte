<script lang="ts">
	import { enhance, applyAction, deserialize } from '$app/forms';
	import { onDestroy, tick, untrack } from 'svelte';
	import Icon from '$lib/components/Icon.svelte';
	import IconPicker from '$lib/components/IconPicker.svelte';
	import { page } from '$app/state';
	import { goto, invalidateAll } from '$app/navigation';
	import { setPaneUrl, readPaneParam } from '$lib/paneUrl';
	import { slide } from 'svelte/transition';
	import { popover } from '$lib/transitions';
	import { portal } from '$lib/portal';
	import { presence, subscribeProject, unsubscribeProject } from '$lib/realtime.svelte';
	import SidePane from '$lib/components/SidePane.svelte';
	import Popover from '$lib/components/Popover.svelte';
	import NewTaskPane from '$lib/components/NewTaskPane.svelte';
	import NewMilestonePane from '$lib/components/NewMilestonePane.svelte';
	import MilestonesManager from '$lib/components/MilestonesManager.svelte';
	import TemplatePicker from '$lib/components/TemplatePicker.svelte';
	import TableView from '$lib/components/views/TableView.svelte';
	import BoardView from '$lib/components/views/BoardView.svelte';
	import ListView from '$lib/components/views/ListView.svelte';
	import TimelineView from '$lib/components/views/TimelineView.svelte';
	import CalendarView from '$lib/components/views/CalendarView.svelte';
	import DashboardView from '$lib/components/views/DashboardView.svelte';
	import MapView from '$lib/components/views/MapView.svelte';
	import FlowView from '$lib/components/views/FlowView.svelte';
	import FilterBar from '$lib/components/FilterBar.svelte';
	import BulkActionBar from '$lib/components/BulkActionBar.svelte';
	import { filterTasks } from '$lib/taskFilter';
	import { sortTasks, parseSortBy } from '$lib/taskSort';
	import { fieldAppliesTo, buildTaskCfSearch, fieldDisplayText } from '$lib/customFields';
	import { selection } from '$lib/selection.svelte';
	import { toast } from '$lib/toast.svelte';
	import { t } from '$lib/i18n';
	import { confirmDialog } from '$lib/confirm.svelte';
	import { tooltip } from '$lib/tooltip';
	import { longpress } from '$lib/longpress';

	let { data, form } = $props();

	let projMenuOpen = $state(false);
	// which "…"-menu submenu is expanded (touch has no hover, so flyouts are
	// click-toggled — they render as inline accordions on mobile). ADR-042.
	let openSub = $state<string | null>(null);
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
	// Project-level panes are reflected in the URL (?pane=…) so they're linkable /
	// restorable in another window. The task pane uses ?task= (owned by the views);
	// the single-open-pane registry keeps the two mutually exclusive. Initialise from
	// the URL so a deep-link opens the right pane on load.
	const paneFromUrl = () => page.url.searchParams.get('pane');
	let customizing = $state(paneFromUrl() === 'customize');
	let milestonesOpen = $state(paneFromUrl() === 'milestones');
	let newTaskOpen = $state(paneFromUrl() === 'new-task');
	let newTaskPrefill = $state<Record<string, string>>({});
	let newMilestoneOpen = $state(paneFromUrl() === 'new-milestone');
	let ctx = $state<{ id: string; x: number; y: number } | null>(null);
	let ctxSub = $state<'display' | null>(null);
	let ctxRenaming = $state(false);

	const requestedView = $derived(page.url.searchParams.get('view'));

	// ── URL ⇄ project-pane sync ───────────────────────────────────────────────
	// Which project-level pane is open (only one at a time). Mirrored to ?pane=.
	const openPaneName = $derived(
		customizing
			? 'customize'
			: milestonesOpen
				? 'milestones'
				: newTaskOpen
					? 'new-task'
					: newMilestoneOpen
						? 'new-milestone'
						: null
	);
	function applyPaneParam(name: string | null) {
		customizing = name === 'customize';
		milestonesOpen = name === 'milestones';
		newTaskOpen = name === 'new-task';
		newMilestoneOpen = name === 'new-milestone';
	}
	// `lastPaneParam` is a plain sentinel: it must be read via untrack() in BOTH
	// effects. If either effect *tracked* it, changing it in one would re-run the
	// other with a stale page.url and clobber the state. So the read effect fires
	// only on page.url changes and the write effect only on openPaneName changes.
	let lastPaneParam = $state(paneFromUrl());
	// URL → state: browser back/forward + external navigation open/close the pane
	$effect(() => {
		const fromUrl = readPaneParam('pane');
		if (fromUrl !== untrack(() => lastPaneParam)) {
			lastPaneParam = fromUrl;
			applyPaneParam(fromUrl);
		}
	});
	// state → URL: opening/closing a pane reflects it (shallow routing — no reload).
	$effect(() => {
		const name = openPaneName;
		if (name !== untrack(() => lastPaneParam)) {
			lastPaneParam = name;
			setPaneUrl({ pane: name });
		}
	});
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

	// Per-task searchable text from custom-field values (resolved to display labels).
	// Lets free-text search + the task-cf link picker hit custom fields. ponytail:
	// rebuilt on any data change, O(values) — fine at app scale.
	const optionTitleById = $derived(new Map(data.customFieldOptions.map((o) => [o.id, o.title])));
	const userNameById = $derived(new Map(data.users.map((u) => [u.id, u.name])));
	const locationTitleById = $derived(new Map(data.locations.map((l) => [l.id, l.title])));
	const taskTitleById = $derived(new Map(data.tasks.map((t) => [t.id, t.title])));
	const fileNameById = $derived(new Map(data.files.map((f) => [f.id, f.filename])));
	const cfSearchByTask = $derived(
		buildTaskCfSearch(data.customFields, data.taskCustomValues, {
			option: (id) => optionTitleById.get(id) ?? '',
			user: (id) => userNameById.get(id) ?? '',
			location: (id) => locationTitleById.get(id) ?? '',
			task: (id) => taskTitleById.get(id) ?? '',
			file: (id) => fileNameById.get(id) ?? ''
		})
	);
	const taskCfSearch = (id: string) => cfSearchByTask.get(id) ?? '';

	// tasks after the active view's saved filters + the live search box, then sorted.
	const filteredTasks = $derived(
		sortTasks(
			filterTasks(
				data.tasks,
				(viewConfig.filters as Record<string, unknown>) ?? undefined,
				searchText,
				{ labelIdsOf, searchableText: taskCfSearch }
			),
			typeof viewConfig.sortBy === 'string' ? (viewConfig.sortBy as string) : null,
			{ statusRank: statusRankFn, assigneeName: assigneeNameFn }
		)
	);

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

	// Hide empty groups (config.hideEmptyGroups, default true = current behavior).
	// Emptiness honors the view's filters/search/sort since groups derive from them.
	const hideEmptyOn = $derived(viewConfig.hideEmptyGroups !== false);
	const setHideEmptyConfig = () =>
		JSON.stringify({ ...viewConfig, hideEmptyGroups: hideEmptyOn ? false : undefined });

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

	// Flow view: show milestone nodes/membership (config.flowMilestones, default on).
	const flowMilestonesOn = $derived(viewConfig.flowMilestones !== false);
	const setFlowMilestonesConfig = () =>
		JSON.stringify({ ...viewConfig, flowMilestones: flowMilestonesOn ? false : undefined });

	// Table grouped view: show the per-group task count (config.showCount, default off).
	const showCountOn = $derived(viewConfig.showCount === true);
	const setShowCountConfig = () =>
		JSON.stringify({ ...viewConfig, showCount: showCountOn ? undefined : true });

	// Per-milestone task progress map (top-level tasks only; done = completed category),
	// passed to the shared MilestonesManager rendered in the Milestones pane.
	const doneStatusIds = $derived(
		new Set(data.statuses.filter((s) => s.category === 'completed').map((s) => s.id))
	);
	const milestoneProgressMap = $derived.by(() => {
		const acc: Record<string, { done: number; total: number; pct: number }> = {};
		for (const t of data.tasks) {
			if (t.parentId || !t.milestoneId) continue;
			const a = (acc[t.milestoneId] ??= { done: 0, total: 0, pct: 0 });
			a.total++;
			if (doneStatusIds.has(t.statusId)) a.done++;
		}
		for (const k in acc) acc[k].pct = acc[k].total ? Math.round((acc[k].done / acc[k].total) * 100) : 0;
		return acc;
	});

	// Tasks are editable by every member with project access; grants gate structure
	function canEditTask(_t: { id: string; parentId: string | null }) {
		return Boolean(data.user);
	}

	// Status display is per-view (config.statusDisplay), falling back to the project's
	// saved default (legacy) then 'text'. Only the active view renders, so this drives
	// every view's StatusSelect rendering.
	const statusDisplay = $derived(
		((typeof viewConfig.statusDisplay === 'string'
			? viewConfig.statusDisplay
			: data.project.statusDisplay) ?? 'text') as 'text' | 'icon' | 'text-icon'
	);
	const STATUS_DISPLAY_OPTIONS = [
		['text', 'Text only'],
		['icon', 'Icon only'],
		['text-icon', 'Text & icon']
	] as const;
	// Always store the chosen value (even 'text') so it overrides the legacy project
	// default; an absent key means "inherit project default" for untouched views.
	const setStatusDisplayConfig = (val: string) =>
		JSON.stringify({ ...viewConfig, statusDisplay: val });

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

	const VIEW_TYPES = ['table', 'board', 'list', 'timeline', 'calendar', 'dashboard', 'map', 'flow'] as const;
	const VIEW_ICONS: Record<string, string> = {
		table: 'table',
		board: 'view-grid',
		list: 'list',
		timeline: 'calendar',
		calendar: 'calendar',
		dashboard: 'dashboard-dots',
		map: 'map-pin',
		flow: 'git-fork'
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

	// Project header chips (ADR-040 design): the project's OWN (entity='project') custom
	// fields rendered as two-tone key-value pills [ name | value ]. Display-only; values
	// are edited in project settings. Resolves each type to a human label, skips empties.
	// Header-chip value display — shares the pure resolver with the `field` mention
	// chip (ADR-051). Reference ids resolve against the project's rosters.
	function projectFieldDisplay(
		field: { id: string; type: string; config: Record<string, unknown> },
		raw: string | null | undefined
	): string {
		return fieldDisplayText(field, raw, {
			option: (id) => data.projectFieldOptions.find((o) => o.id === id)?.title ?? '',
			user: (id) => data.users.find((u) => u.id === id)?.name ?? '',
			location: (id) => data.locations.find((l) => l.id === id)?.title ?? '',
			task: (id) => data.tasks.find((t) => t.id === id)?.title ?? ''
		});
	}
	// Header chips honor `project.chipFields` (an ordered id list set on the custom-fields
	// page's "Show" bar): null/unset = all project fields in their natural order; a list =
	// only those ids in that order. Rollup values are computed server-side (projectRollupText);
	// empty-valued fields never render.
	const chipFieldOrder = $derived.by(() => {
		const raw = data.project.chipFields;
		if (raw == null) return null;
		try {
			const arr = JSON.parse(raw);
			return Array.isArray(arr) ? arr.map(String) : null;
		} catch {
			return null;
		}
	});
	const projectFieldPills = $derived.by(() => {
		const byId = new Map(data.projectFields.map((f) => [f.id, f]));
		const ordered = chipFieldOrder
			? chipFieldOrder.map((id) => byId.get(id)).filter((f): f is (typeof data.projectFields)[number] => Boolean(f))
			: data.projectFields;
		return ordered
			.map((f) => ({
				id: f.id,
				name: f.name,
				// rollup is computed server-side (never stored); others resolve their value
				value:
					f.type === 'rollup'
						? (data.projectRollupText[f.id] ?? '')
						: projectFieldDisplay(f, data.projectCustomValues.find((v) => v.fieldId === f.id)?.value)
			}))
			.filter((p) => p.value !== '');
	});

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
	const isFilterActive = (key: string) => Array.isArray(viewFilters[key]);
	const filterChosen = (key: string) => (Array.isArray(viewFilters[key]) ? viewFilters[key] : []);
	/** activeView config with one filter value toggled, ready to POST. Inclusion
	 * (ADR-035): seed all-checked from inactive, drop the key when all are re-checked. */
	function toggleFilterConfig(key: string, value: string, allVals: string[]) {
		const cur = isFilterActive(key) ? filterChosen(key) : allVals;
		const next = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value];
		const merged: Record<string, unknown> = { ...viewFilters };
		if (next.length === allVals.length) delete merged[key];
		else merged[key] = next;
		const cleaned: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(merged)) if (Array.isArray(v)) cleaned[k] = v;
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

	function openCtxAt(x: number, y: number, viewId: string) {
		ctx = { id: viewId, x, y };
		ctxSub = null;
		ctxRenaming = false;
	}
	function openCtx(e: MouseEvent, viewId: string) {
		e.preventDefault();
		e.stopPropagation();
		openCtxAt(e.clientX, e.clientY, viewId);
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

<!-- Project header — portaled up into the shell topbar ([data-page-header]) -->
<div class="proj-topbar" use:portal={'[data-page-header]'}>
	<a href="/projects" class="back-link" use:tooltip={$t('Projects')} aria-label={$t('Projects')}><Icon name="arrow-left" size={16} /></a>
	<h2 class="proj-title">
		<span class="proj-name">{data.project.name}</span>
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
				onclick={() => {
					projMenuOpen = !projMenuOpen;
					openSub = null;
				}}
			>
				<Icon name="more-horiz" size={18} />
			</button>
			{#if projMenuOpen}
				<div class="menu" transition:popover>
					<!-- Create… (flyout / mobile accordion): Task / Milestone -->
					<div class="menu-sub" class:open={openSub === 'create'}>
						<button
							class="menu-item menu-item--sub"
							aria-haspopup="true"
							aria-expanded={openSub === 'create'}
							onclick={() => (openSub = openSub === 'create' ? null : 'create')}
						>
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

					<!-- Status (flyout / mobile accordion) -->
					<div class="menu-sub" class:open={openSub === 'status'}>
						<button
							class="menu-item menu-item--sub"
							aria-haspopup="true"
							aria-expanded={openSub === 'status'}
							onclick={() => (openSub = openSub === 'status' ? null : 'status')}
						>
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

					<div class="menu-sub" class:open={openSub === 'icon'}>
						<button
							class="menu-item menu-item--sub"
							aria-haspopup="true"
							aria-expanded={openSub === 'icon'}
							onclick={() => (openSub = openSub === 'icon' ? null : 'icon')}
						>
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

					<div class="menu-sub" class:open={openSub === 'labels'}>
						<button
							class="menu-item menu-item--sub"
							aria-haspopup="true"
							aria-expanded={openSub === 'labels'}
							onclick={() => (openSub = openSub === 'labels' ? null : 'labels')}
						>
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
	{#if projectFieldPills.length > 0 || dependsOn.length > 0}
		<div class="topbar-pills">
			{#each projectFieldPills as f (f.id)}
				<span class="kv-pill">
					<span class="kv-key">{f.name}</span>
					<span class="kv-val">{f.value}</span>
				</span>
			{/each}
			{#each dependsOn as p (p.id)}
				<a class="badge" href="/projects/{p.id}" style="text-decoration: none;">{p.name}</a>
			{/each}
		</div>
	{/if}
	{#if others.length > 0}
		<div class="presence" aria-label={$t('People viewing')}>
			{#each others as u (u.id)}
				<span class="avatar" use:tooltip={u.name}>{initials(u.name)}</span>
			{/each}
		</div>
	{/if}
</div>
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
			use:longpress={(p) => {
				if (data.perm.views[v.id]) openCtxAt(p.clientX, p.clientY, v.id);
			}}
			ondblclick={(e) => {
				if (!data.perm.views[v.id]) return;
				e.preventDefault();
				closeMenus();
				milestonesOpen = false;
				customizing = true;
				if (activeView?.id !== v.id) goto(`?view=${v.id}&pane=customize`, { noScroll: true, keepFocus: true });
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
					if (activeView?.id !== id) goto(`?view=${id}&pane=customize`, { noScroll: true, keepFocus: true });
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
	{@const on = isFilterActive(group.key)}
	{@const chosen = filterChosen(group.key)}
	{@const hidden = on ? group.opts.length - chosen.length : 0}
	<span class="cz-pill" class:cz-pill--on={on}>
		<Popover ariaLabel={$t(group.label)}>
			{#snippet trigger()}{$t(group.label)}{#if hidden > 0}<span class="cz-count">{hidden}</span>{/if}{/snippet}
			{#snippet panel()}
				<div class="cz-opts">
					{#each group.opts as [val, lbl] (val)}
						{@const ok = !on || chosen.includes(val)}
						<button
							class="cz-opt"
							class:cz-opt--on={ok}
							type="button"
							onclick={() => postViewConfig(toggleFilterConfig(group.key, val, group.opts.map((o) => o[0])))}
						>
							<span class="cz-check">{#if ok}<Icon name="check" size={13} />{/if}</span>
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
			<!-- reset:false: value={activeView.name} is set as a property, so a default
			     form.reset() on submit would blank it to its empty defaultValue (same as
			     the task title) — clearing the name on click-in / click-out. -->
			<form method="POST" action="?/updateView" use:enhance={() => async ({ update }) => update({ reset: false })}>
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

		{#if ['table', 'board', 'list', 'flow', 'timeline', 'calendar'].includes(activeView.type)}
			<span class="label">{$t('Status display')}</span>
			<div class="chips-row">
				{@render selectPill(
					$t('Status display'),
					STATUS_DISPLAY_OPTIONS,
					statusDisplay,
					setStatusDisplayConfig
				)}
			</div>
		{/if}

		{#if activeView.type === 'table'}
			<span class="label">{$t('Group by')}</span>
			<div class="chips-row">
				{@render selectPill($t('Group by'), GROUP_BY_OPTIONS, groupByValue, setGroupByConfig)}
				{#if groupByValue}
					<form method="POST" action="?/updateView" use:enhance>
						<input type="hidden" name="id" value={activeView.id} />
						<input type="hidden" name="name" value={activeView.name} />
						<input type="hidden" name="config" value={setHideEmptyConfig()} />
						<button class="chip" class:chip--on={hideEmptyOn} type="submit"
							>{$t('Hide empty groups')}</button
						>
					</form>
				{/if}
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
			<span class="label">{$t('Task count')}</span>
			<div class="chips-row">
				<form method="POST" action="?/updateView" use:enhance>
					<input type="hidden" name="id" value={activeView.id} />
					<input type="hidden" name="name" value={activeView.name} />
					<input type="hidden" name="config" value={setShowCountConfig()} />
					<button class="chip" class:chip--on={showCountOn} type="submit">{$t('Show task count')}</button>
				</form>
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
				{#if boardGroupByValue !== 'status'}
					<form method="POST" action="?/updateView" use:enhance>
						<input type="hidden" name="id" value={activeView.id} />
						<input type="hidden" name="name" value={activeView.name} />
						<input type="hidden" name="config" value={setHideEmptyConfig()} />
						<button class="chip" class:chip--on={hideEmptyOn} type="submit"
							>{$t('Hide empty groups')}</button
						>
					</form>
				{/if}
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
				{#if groupByValue}
					<form method="POST" action="?/updateView" use:enhance>
						<input type="hidden" name="id" value={activeView.id} />
						<input type="hidden" name="name" value={activeView.name} />
						<input type="hidden" name="config" value={setHideEmptyConfig()} />
						<button class="chip" class:chip--on={hideEmptyOn} type="submit"
							>{$t('Hide empty groups')}</button
						>
					</form>
				{/if}
			</div>
		{/if}

		{#if activeView.type === 'flow'}
			<span class="label">{$t('Milestones')}</span>
			<div class="chips-row">
				<form method="POST" action="?/updateView" use:enhance>
					<input type="hidden" name="id" value={activeView.id} />
					<input type="hidden" name="name" value={activeView.name} />
					<input type="hidden" name="config" value={setFlowMilestonesConfig()} />
					<button class="chip" class:chip--on={flowMilestonesOn} type="submit">{$t('Show milestones')}</button>
				</form>
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

		{#if ['table', 'board', 'list', 'flow'].includes(activeView.type)}
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
		<MilestonesManager
			milestones={data.milestones}
			progress={milestoneProgressMap}
			milestoneDeps={data.milestoneDeps}
			canEdit={data.perm.project}
		/>
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
		taskSearch={taskCfSearch}
		prefill={newTaskPrefill}
		onClose={() => (newTaskOpen = false)}
	/>
{/if}

{#if newMilestoneOpen && data.perm.project}
	<NewMilestonePane onClose={() => (newMilestoneOpen = false)} />
{/if}

{#if activeView && ['table', 'board', 'list', 'flow'].includes(activeView.type)}
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
	</div>
{/if}

<!-- Active view -->
{#if activeView?.type === 'table'}
	<TableView
		tasks={filteredTasks}
		allTasks={data.tasks}
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
		allTasks={data.tasks}
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
		allTasks={data.tasks}
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
		allTasks={data.tasks}
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
		allTasks={data.tasks}
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
		onNewTask={openNewTask}
		{statusDisplay}
		{canEditTask}
		templates={data.templates}
	/>
{:else if activeView?.type === 'dashboard'}
	<DashboardView tasks={data.tasks} statuses={data.statuses} milestones={data.milestones} />
{:else if activeView?.type === 'map'}
	<MapView tasks={data.tasks} locations={data.locations} />
{:else if activeView?.type === 'flow'}
	<FlowView
		tasks={filteredTasks}
		allTasks={data.tasks}
		statusIds={shownStatusIds}
		showMilestones={flowMilestonesOn}
		users={data.users}
		statuses={data.statuses}
		milestones={data.milestones}
		locations={data.locations}
		labels={data.labels}
		taskLabels={data.taskLabels}
		taskDeps={data.taskDeps}
		milestoneDeps={data.milestoneDeps}
		customFields={data.customFields}
		customFieldOptions={data.customFieldOptions}
		taskCustomValues={data.taskCustomValues}
		files={data.files}
		templates={data.templates}
		{statusDisplay}
		{canEditTask}
	/>
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
		labels={projectLabels}
		canEdit={canEditActiveView}
		onSetStatus={(statusId) => bulkSubmit('bulkPatchTasks', { statusId })}
		onSetAssignee={(assigneeId) => bulkSubmit('bulkPatchTasks', { assigneeId: assigneeId ?? '' })}
		onSetMilestone={(milestoneId) => bulkSubmit('bulkPatchTasks', { milestoneId: milestoneId ?? '' })}
		onSetPriority={(priority) => bulkSubmit('bulkPatchTasks', { priority })}
		labelOn={(labelId) =>
			selection.size > 0 && selection.ids.every((id) => labelIdsOf(id).includes(labelId))}
		onToggleLabel={(labelId, add) => bulkSubmit('bulkSetLabel', { labelId, add: add ? '1' : '0' })}
		onDelete={async () => {
			await bulkSubmit('bulkDeleteTasks', {});
			selection.clear();
		}}
		onClear={() => selection.clear()}
	/>
{/if}

</div>

<style>
	/* Project header, portaled into the shell topbar's center slot ([data-page-header]).
	   Title (left, truncates) · pinned · "…" menu · pills (fill, scroll) · presence (right). */
	.proj-topbar {
		display: flex;
		align-items: center;
		gap: var(--sp-2);
		min-width: 0;
		flex: 1 1 auto;
	}

	/* Hidden until the portal action relocates it into the topbar. Without this the
	   server-rendered header paints at the top of .content and visibly teleports up
	   on hydration. display:none (not visibility) reserves no space, so there's no
	   layout shift in .content either. */
	.proj-topbar:not([data-portaled]) {
		display: none;
	}

	.proj-topbar .proj-title {
		font-size: 15px;
		font-weight: 600;
		margin: 0;
		flex: 0 1 auto;
		min-width: 3ch;
		overflow: hidden;
	}

	.proj-topbar .proj-name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* inline, horizontally-scrollable pill strip (hidden scrollbar) */
	.topbar-pills {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
		flex: 1 1 auto;
		overflow-x: auto;
		scrollbar-width: none;
	}

	.topbar-pills::-webkit-scrollbar {
		display: none;
	}

	.proj-topbar .presence {
		margin-left: auto;
		flex: 0 0 auto;
	}

	/* slim screens: drop the pills, keep title + menu + presence */
	@media (max-width: 768px) {
		.topbar-pills {
			display: none;
		}
	}

	.menu-wrap {
		position: relative;
	}

	.dots-btn {
		position: relative;
		display: inline-flex;
		align-items: center;
		justify-content: center;
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

	/* extend the icon-only hit area toward ~40px without shifting layout */
	.dots-btn::before {
		content: '';
		position: absolute;
		inset: -9px -4px;
	}

	.dots-btn:hover {
		color: var(--color-fg);
		background: var(--color-surface-muted);
	}

	.menu,
	.ctx-menu {
		background: var(--color-bg);
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-box, 0.5rem);
		box-shadow:
			0 1px 2px rgba(0, 0, 0, 0.04),
			0 8px 24px rgba(0, 0, 0, 0.12);
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
		justify-content: center;
		flex: 0 0 auto;
		color: var(--color-muted);
		border-radius: var(--radius-field, 0.25rem);
		padding: 2px;
		transition: color var(--dur-fast) ease, background var(--dur-fast) ease;
	}

	.back-link:hover {
		color: var(--color-fg);
		background: var(--color-surface-muted);
	}

	.proj-title {
		display: inline-flex;
		align-items: center;
		gap: var(--sp-1);
		overflow-wrap: anywhere;
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
		border-radius: var(--radius-box, 0.5rem);
		box-shadow:
			0 1px 2px rgba(0, 0, 0, 0.04),
			0 8px 24px rgba(0, 0, 0, 0.12);
		padding: var(--sp-1) 0;
		z-index: 31;
		display: none;
	}

	/* desktop: open on hover/keyboard focus. Gated to pointer devices so the
	   click-toggle below is the sole driver on touch (a focused button keeps
	   :focus-within true and would otherwise fight the toggle). */
	@media (hover: hover) {
		.menu-sub:hover > .flyout,
		.menu-sub:focus-within > .flyout {
			display: block;
		}
	}

	/* click-toggle (all devices; the only opener on touch) */
	.menu-sub.open > .flyout {
		display: block;
	}

	.sub-arrow {
		transition: transform var(--dur-fast) ease;
	}

	.menu-sub.open .sub-arrow {
		transform: rotate(90deg);
	}

	/* the icon picker manages its own width + internal scroll */
	.flyout--picker {
		min-width: 0;
		max-width: none;
		max-height: none;
		overflow: visible;
		padding: 0;
	}

	/* Mobile: side-positioned flyouts fall off-screen, so render the open
	   submenu as an inline accordion that pushes the menu content down. */
	@media (max-width: 720px) {
		.menu {
			max-height: calc(100dvh - 80px);
			overflow-y: auto;
		}

		.flyout {
			position: static;
			left: auto;
			right: auto;
			margin: 2px 0 var(--sp-1);
			min-width: 0;
			max-width: none;
			width: 100%;
			max-height: 260px;
			border: none;
			border-radius: 0;
			box-shadow: none;
			background: var(--color-surface-muted);
			padding-left: var(--sp-2);
		}

		.flyout--picker {
			max-height: 300px;
			overflow-y: auto;
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
		/* long-press opens the tab menu on touch — suppress the iOS link callout */
		-webkit-touch-callout: none;
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
		border-radius: var(--radius-box, 0.5rem);
		box-shadow:
			0 1px 2px rgba(0, 0, 0, 0.04),
			0 8px 24px rgba(0, 0, 0, 0.12);
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

	/* Two-tone key-value pill for project custom fields: [ name | value ] */
	.kv-pill {
		display: inline-flex;
		align-items: stretch;
		font-size: 12px;
		line-height: 1.6;
		border: 1px solid var(--color-border-subtle);
		border-radius: 999px;
		overflow: hidden;
	}

	.kv-key {
		padding: 1px 8px;
		background: var(--color-surface-muted);
		color: var(--color-muted);
		font-weight: 500;
	}

	.kv-val {
		padding: 1px 8px;
		color: var(--color-fg);
		max-width: 32ch;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
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
		font-variant-numeric: tabular-nums;
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

</style>
