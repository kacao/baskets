<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import { createPaneNav } from '$lib/paneNav.svelte';
	import { popover } from '$lib/transitions';
	import StatusSelect from '$lib/components/StatusSelect.svelte';
	import PriorityBadge from '$lib/components/PriorityBadge.svelte';
	import TaskPanel from '$lib/components/TaskPanel.svelte';
	import CustomFieldValue from '$lib/components/CustomFieldValue.svelte';
	import LabelChip from '$lib/components/LabelChip.svelte';
	import {
		fieldAppliesTo,
		fieldAggregations,
		rollsUpToParent,
		rollupDisplayText
	} from '$lib/customFields';
	import { sortTasks } from '$lib/taskSort';
	import { selection } from '$lib/selection.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { tooltip } from '$lib/tooltip';
	import { t as i18n } from '$lib/i18n';
	import { fmtDate } from '$lib/date';
	import { groupTasks } from '$lib/taskGroups';

	type Task = {
		id: string;
		parentId: string | null;
		title: string;
		description: string | null;
		statusId: string;
		priority: string;
		assigneeId: string | null;
		milestoneId: string | null;
		locationId: string | null;
		location: string | null;
		order: number | null;
		dueDate: Date | string | null;
		coverFileId?: string | null;
	};
	type Status = { id: string; name: string; category: string };
	type Location = {
		id: string;
		title: string;
		address: string | null;
		latitude: number | null;
		longitude: number | null;
	};
	type CustomFieldDef = {
		id: string;
		name: string;
		type: string;
		config: Record<string, unknown>;
		appliesTo?: string;
		position?: number;
	};
	type CustomFieldOption = {
		id: string;
		fieldId: string;
		title: string;
		color: string | null;
		icon: string | null;
	};
	type FileRef = {
		id: string;
		taskId: string | null;
		fieldId: string | null;
		filename: string;
		mimeType: string;
		size: number;
	};

	let {
		tasks,
		allTasks = tasks,
		users,
		statuses,
		milestones,
		locations,
		labels,
		taskLabels,
		taskDeps,
		customFields = [],
		customFieldOptions = [],
		taskCustomValues = [],
		files = [],
		config,
		canEditTask,
		viewId = '',
		viewName = '',
		canEditView = false,
		onNewTask,
		statusDisplay = 'text',
		templates = []
	}: {
		tasks: Task[];
		allTasks?: Task[];
		users: { id: string; name: string }[];
		statuses: Status[];
		milestones: { id: string; name: string }[];
		locations: Location[];
		labels: { id: string; name: string; color?: string | null; icon?: string | null }[];
		taskLabels: { taskId: string; labelId: string }[];
		taskDeps: { taskId: string; dependsOnId: string }[];
		customFields?: CustomFieldDef[];
		customFieldOptions?: CustomFieldOption[];
		taskCustomValues?: { taskId: string; fieldId: string; value: string }[];
		files?: FileRef[];
		config: Record<string, unknown>;
		canEditTask: (t: { id: string; parentId: string | null }) => boolean;
		viewId?: string;
		viewName?: string;
		canEditView?: boolean;
		onNewTask?: (prefill?: Record<string, string>) => void;
		statusDisplay?: 'text' | 'icon' | 'text-icon';
		templates?: { id: string; name: string }[];
	} = $props();

	// Task editing opens the shared right-side pane (ADR-025); the chevron only
	// expands sub-task rows inline. ?task= deep-links a task open (board card clicks).
	let expanded = $state<Record<string, boolean>>({});
	// ADR-055, extracted to paneNav.svelte.ts
	const nav = createPaneNav<Task>(() => allTasks);

	const show = (key: string) => config[key] !== false; // columns default on
	const showCount = $derived(config.showCount === true); // group task count — default off
	const statusFilter = $derived(
		Array.isArray(config.statusIds) ? (config.statusIds as string[]) : null
	);

	const topTasks = $derived(
		tasks
			.filter((t) => !t.parentId)
			.filter((t) => !statusFilter || statusFilter.includes(t.statusId))
	);

	// optional columns (config-driven) + status + title + actions
	const COLS = ['priority', 'assignee', 'milestone', 'due', 'labels'] as const;
	const COL_LABELS: Record<string, string> = {
		priority: 'Priority',
		assignee: 'Assignee',
		milestone: 'Milestone',
		due: 'Due date',
		labels: 'Labels'
	};
	// custom-field columns, keyed `cf:<fieldId>` — toggled the same way as COLS.
	// rows here are top-level tasks, so only show fields that apply to them.
	// Top-level columns: fields applying to top-level tasks, plus number rollup-to-parent
	// fields (incl. `subtasks`-only ones) so a parent's computed rollup shows in the table.
	const cfCols = $derived(
		customFields
			.filter((f) => fieldAppliesTo(f, false) || rollsUpToParent(f))
			.map((f) => ({ key: `cf:${f.id}`, label: f.name, field: f }))
	);
	// $derived lookup maps replace per-row/per-cell full-array scans (O(1) Map.get
	// instead of O(n) find/filter, re-run on every realtime refetch).
	const valueByTaskField = $derived(
		new Map(taskCustomValues.map((v) => [`${v.taskId}:${v.fieldId}`, v.value]))
	);
	const optionsByField = $derived.by(() => {
		const m = new Map<string, CustomFieldOption[]>();
		for (const o of customFieldOptions) {
			const arr = m.get(o.fieldId) ?? [];
			arr.push(o);
			m.set(o.fieldId, arr);
		}
		return m;
	});
	const userById = $derived(new Map(users.map((u) => [u.id, u])));
	const milestoneById = $derived(new Map(milestones.map((m) => [m.id, m])));
	const labelById = $derived(new Map(labels.map((l) => [l.id, l])));
	// built from allTasks (the full project task list, not the view's filtered `tasks`)
	// so a dependency/link pointing at a filtered-out task still resolves — matches
	// `tasks={allTasks}` already passed to CustomFieldValue.
	const taskById = $derived(new Map(allTasks.map((t) => [t.id, t])));
	const labelIdsByTask = $derived.by(() => {
		const m = new Map<string, string[]>();
		for (const tl of taskLabels) {
			const arr = m.get(tl.taskId) ?? [];
			arr.push(tl.labelId);
			m.set(tl.taskId, arr);
		}
		return m;
	});
	const depIdsByTask = $derived.by(() => {
		const m = new Map<string, string[]>();
		for (const d of taskDeps) {
			const arr = m.get(d.taskId) ?? [];
			arr.push(d.dependsOnId);
			m.set(d.taskId, arr);
		}
		return m;
	});
	const filesByTask = $derived.by(() => {
		const m = new Map<string, FileRef[]>();
		for (const f of files) {
			if (f.taskId == null) continue;
			const arr = m.get(f.taskId) ?? [];
			arr.push(f);
			m.set(f.taskId, arr);
		}
		return m;
	});
	const cfOptions = (fieldId: string) => optionsByField.get(fieldId) ?? [];
	const cfValue = (taskId: string, fieldId: string) =>
		valueByTaskField.get(`${taskId}:${fieldId}`) ?? null;
	function rollupText(
		taskId: string,
		field: { id: string; type: string; config: Record<string, unknown>; appliesTo?: string }
	): string | null {
		const valueOf = (tid: string, fid: string) => {
			const raw = cfValue(tid, fid);
			const n = raw == null ? null : Number(raw);
			return n != null && Number.isFinite(n) ? n : null;
		};
		return rollupDisplayText(field, taskId, {
			tasks: allTasks,
			taskDeps,
			fields: customFields,
			valueOf,
			hasSubtasks: allTasks.some((t) => t.parentId === taskId)
		});
	}
	const colCount = $derived(
		4 + COLS.filter((k) => show(k)).length + cfCols.filter((c) => show(c.key)).length
	);
	let colMenuOpen = $state(false);
	let collapsed = $state<Record<string, boolean>>({}); // group.key → collapsed
	// config with one column toggled, ready to POST to ?/updateView
	const toggledConfig = (key: string) =>
		JSON.stringify({ ...config, [key]: config[key] === false });

	// ---- column resize (persisted to view.config.colWidths) ----
	// columns in render order; colgroup/headers/cells follow the same sequence.
	const orderedCols = $derived([
		'select',
		'status',
		'title',
		...COLS.filter((k) => show(k)),
		...cfCols.filter((c) => show(c.key)).map((c) => c.key),
		'actions'
	]);
	const COL_DEFAULTS: Record<string, number> = {
		select: 300,
		title: 320,
		priority: 110,
		assignee: 140,
		milestone: 160,
		due: 120,
		labels: 160,
		actions: 44
	};
	// status is a control column: its width fits the longest status pill in the current
	// display mode (never frozen by a resize) — so the pill always fits and Title starts
	// cleanly after it. ~7px/char at the 12px pill font + chrome (padding + icon + gap).
	const statusColW = $derived.by(() => {
		if (statusDisplay === 'icon') return 56;
		const maxLen = Math.max(7, ...statuses.map((s) => s.name.length));
		// ~6px/char at the 12px pill font + chrome (pill padding/border 26, icon+gap 20)
		return Math.min(220, Math.round(maxLen * 6.5 + 26 + (statusDisplay === 'text-icon' ? 20 : 0)));
	});
	const colDefault = (key: string) => (key.startsWith('cf:') ? 160 : (COL_DEFAULTS[key] ?? 140));
	const colWidths = $derived(
		(config.colWidths && typeof config.colWidths === 'object' ? config.colWidths : {}) as Record<
			string,
			number
		>
	);
	let liveWidths = $state<Record<string, number>>({});
	let resizing = $state<string | null>(null);
	// fixed layout (explicit widths) kicks in once a view has saved widths or a drag is active
	const hasWidths = $derived(
		resizing !== null || Object.keys(liveWidths).length > 0 || Object.keys(colWidths).length > 0
	);
	// saved width wins for every column; status falls back to its mode-derived width,
	// the rest to their static default
	const effW = (key: string) =>
		liveWidths[key] ?? colWidths[key] ?? (key === 'status' ? statusColW : colDefault(key));
	const colStyle = (key: string) => (hasWidths ? `width:${effW(key)}px` : '');
	// explicit table width = sum of column widths (fixed layout needs a definite
	// width; max-content would re-size columns to content and ignore the colgroup)
	const tableWidth = $derived(hasWidths ? orderedCols.reduce((s, k) => s + effW(k), 0) : 0);

	function startResize(e: PointerEvent, key: string) {
		e.preventDefault();
		e.stopPropagation();
		const th = (e.currentTarget as HTMLElement).closest('th');
		const ths = th?.closest('table')?.querySelectorAll('thead tr th') ?? [];
		// seed every column from its current rendered width so switching to fixed
		// layout doesn't jump, then only the dragged column changes
		const base: Record<string, number> = {};
		orderedCols.forEach((k, i) => {
			const el = ths[i] as HTMLElement | undefined;
			if (el) base[k] = el.offsetWidth;
		});
		const startX = e.clientX;
		const startW = base[key] ?? colDefault(key);
		liveWidths = base;
		resizing = key;
		const onMove = (ev: PointerEvent) => {
			liveWidths = {
				...liveWidths,
				[key]: Math.max(60, Math.round(startW + (ev.clientX - startX)))
			};
		};
		const onUp = async () => {
			window.removeEventListener('pointermove', onMove);
			window.removeEventListener('pointerup', onUp);
			const widths = { ...colWidths, ...liveWidths };
			resizing = null;
			if (canEditView && viewId) {
				const fd = new FormData();
				fd.set('id', viewId);
				fd.set('name', viewName);
				fd.set('config', JSON.stringify({ ...config, colWidths: widths }));
				await fetch(`${page.url.pathname}?/updateView`, { method: 'POST', body: fd });
				await invalidateAll();
			}
			liveWidths = {};
		};
		window.addEventListener('pointermove', onMove);
		window.addEventListener('pointerup', onUp);
	}

	const cat = (id: string) => statuses.find((s) => s.id === id)?.category ?? 'backlog';
	const isDone = (t: Task) => cat(t.statusId) === 'completed';
	const subsOf = (id: string) => tasks.filter((t) => t.parentId === id);
	const userName = (id: string | null) => (id == null ? null : (userById.get(id)?.name ?? null));
	const milestoneName = (id: string | null) =>
		id == null ? null : (milestoneById.get(id)?.name ?? null);
	const labelsOf = (taskId: string) =>
		(labelIdsByTask.get(taskId) ?? []).map((id) => labelById.get(id)).filter(Boolean);
	const taskLabelIds = (taskId: string) => labelIdsByTask.get(taskId) ?? [];
	const depsOf = (taskId: string) =>
		(depIdsByTask.get(taskId) ?? []).map((id) => taskById.get(id)).filter(Boolean);

	// Group by (config.groupBy): render one table per group with its title above.
	// null/absent = a single ungrouped table (default).
	const groupBy = $derived(typeof config.groupBy === 'string' ? (config.groupBy as string) : null);
	// Hide empty groups (config.hideEmptyGroups, default true). Emptiness reflects the
	// view's filters/search/sort since groups derive from the already-filtered rows.
	const hideEmptyGroups = $derived(config.hideEmptyGroups !== false);

	// Aggregations (config.aggregations): number field ids summed per group, shown as "(x)".
	const aggFieldIds = $derived(
		Array.isArray(config.aggregations) ? (config.aggregations as string[]) : []
	);

	// Sort (config.sortBy): handled by the shared sortTasks helper (BASDEV-7).
	const sortBy = $derived(typeof config.sortBy === 'string' ? (config.sortBy as string) : null);
	const statusRank = (id: string) => {
		const i = statuses.findIndex((s) => s.id === id);
		return i < 0 ? Number.MAX_SAFE_INTEGER : i;
	};
	const assigneeName = (id: string | null) => users.find((u) => u.id === id)?.name ?? null;
	const sortedTop = $derived(sortTasks(topTasks, sortBy, { statusRank, assigneeName }));
	// visible top-level ids in render order — used by shift-range bulk select.
	const orderedIds = $derived(sortedTop.map((t) => t.id));

	// today as a local yyyy-mm-dd (for the "Today" due-group prefill)
	function todayStr() {
		const d = new Date();
		const m = String(d.getMonth() + 1).padStart(2, '0');
		const day = String(d.getDate()).padStart(2, '0');
		return `${d.getFullYear()}-${m}-${day}`;
	}

	type Group = { key: string; title: string; tasks: Task[] };

	// Prefill the new-task pane from a group's defining value (grouped tables).
	function groupPrefill(g: Group): Record<string, string> {
		if (!groupBy) return {};
		if (groupBy === 'status') return { statusId: g.key };
		if (groupBy === 'milestone') return g.key === '_none' ? {} : { milestoneId: g.key };
		if (groupBy === 'assignee') return g.key === '_none' ? {} : { assigneeId: g.key };
		if (groupBy === 'due') return g.key === 'today' ? { dueDate: todayStr() } : {};
		if (groupBy === 'label') return g.key === '_none' ? {} : { labelId: g.key };
		return {};
	}

	const groups = $derived.by((): Group[] =>
		groupTasks(
			sortedTop,
			groupBy,
			{ statuses, milestones, users, labels, labelIdsOf: taskLabelIds, t: $i18n },
			hideEmptyGroups
		)
	);
</script>

<div class="table-view">
	{#if topTasks.length === 0}
		<div class="empty">
			<p class="u-muted" style="margin-bottom: var(--sp-3);">{$i18n('No tasks here.')}</p>
			<button class="add-fab" aria-label={$i18n('New task')} onclick={() => onNewTask?.()}>
				+
			</button>
			<p class="u-tiny u-muted" style="margin-top: var(--sp-2);">{$i18n('New task')}</p>
		</div>
	{:else}
		<div class="table-wrap">
			<table
				class="table"
				class:cols-fixed={hasWidths}
				style={hasWidths ? `width:${tableWidth}px` : ''}
			>
				<colgroup>
					{#each orderedCols as key (key)}<col style={colStyle(key)} />{/each}
				</colgroup>
				<thead>
					<tr>
						<th class="col-select">
							<input
								type="checkbox"
								aria-label={$i18n('Select all')}
								checked={selection.allSelected(orderedIds)}
								onclick={() =>
									selection.allSelected(orderedIds)
										? selection.clear()
										: selection.selectAll(orderedIds)}
							/>{@render rh('select')}
						</th>
						<th class="col-status">{$i18n('Status')}{@render rh('status')}</th>
						<th class="col-title">{$i18n('Title')}{@render rh('title')}</th>
						{#if show('priority')}<th>{$i18n('Priority')}{@render rh('priority')}</th>{/if}
						{#if show('assignee')}<th>{$i18n('Assignee')}{@render rh('assignee')}</th>{/if}
						{#if show('milestone')}<th>{$i18n('Milestone')}{@render rh('milestone')}</th>{/if}
						{#if show('due')}<th>{$i18n('Due date')}{@render rh('due')}</th>{/if}
						{#if show('labels')}<th>{$i18n('Labels')}{@render rh('labels')}</th>{/if}
						{#each cfCols as c (c.key)}{#if show(c.key)}<th>{c.label}{@render rh(c.key)}</th
								>{/if}{/each}
						<th class="col-actions">
							{#if canEditView && viewId}
								<!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
								<div class="col-menu-wrap" onclick={(e) => e.stopPropagation()}>
									<button
										class="col-menu-btn"
										aria-label={$i18n('Show or hide columns')}
										aria-expanded={colMenuOpen}
										onclick={() => (colMenuOpen = !colMenuOpen)}
									>
										<Icon name="more-horiz" size={16} />
									</button>
									{#if colMenuOpen}
										<div class="col-menu" transition:popover>
											{#if onNewTask}
												<button
													class="col-menu-item"
													type="button"
													onclick={() => {
														colMenuOpen = false;
														onNewTask?.();
													}}
												>
													<span class="col-check">+</span>
													{$i18n('Create task…')}
												</button>
												<div class="col-menu-rule"></div>
											{/if}
											{#each COLS as key (key)}
												<form
													method="POST"
													action="?/updateView"
													use:enhance={() =>
														async ({ update }) =>
															update()}
												>
													<input type="hidden" name="id" value={viewId} />
													<input type="hidden" name="name" value={viewName} />
													<input type="hidden" name="config" value={toggledConfig(key)} />
													<button class="col-menu-item" type="submit">
														<span class="col-check">{show(key) ? '✓' : ''}</span>
														{$i18n(COL_LABELS[key])}
													</button>
												</form>
											{/each}
											{#each cfCols as c (c.key)}
												<form
													method="POST"
													action="?/updateView"
													use:enhance={() =>
														async ({ update }) =>
															update()}
												>
													<input type="hidden" name="id" value={viewId} />
													<input type="hidden" name="name" value={viewName} />
													<input type="hidden" name="config" value={toggledConfig(c.key)} />
													<button class="col-menu-item" type="submit">
														<span class="col-check">{show(c.key) ? '✓' : ''}</span>
														{c.label}
													</button>
												</form>
											{/each}
										</div>
									{/if}
								</div>
							{/if}
						</th>
					</tr>
				</thead>
				{#each groups as g (g.key)}
					<tbody>
						{#if groupBy}
							<tr class="group-row">
								<td class="col-select">
									<button
										class="group-toggle"
										type="button"
										aria-expanded={!collapsed[g.key]}
										aria-label={$i18n('Toggle group')}
										onclick={() => (collapsed[g.key] = !collapsed[g.key])}
									>
										<Icon
											name={collapsed[g.key] ? 'nav-arrow-right' : 'nav-arrow-down'}
											size={14}
										/>
									</button>
								</td>
								<td colspan={colCount - 1}>
									<div class="group-head">
										<span class="group-title">{g.title}</span>
										{#if showCount}<span class="group-count">{g.tasks.length}</span>{/if}
										{#each fieldAggregations(aggFieldIds, customFields, g.tasks, taskCustomValues, tasks) as a (a.id)}
											<span class="group-agg" use:tooltip={a.name}>({a.text})</span>
										{/each}
										{#if onNewTask}
											<button
												class="group-add"
												aria-label={$i18n('New task')}
												use:tooltip={$i18n('New task')}
												onclick={() => onNewTask?.(groupPrefill(g))}
											>
												+
											</button>
										{/if}
									</div>
								</td>
							</tr>
						{/if}
						{#if !collapsed[g.key]}{@render groupRows(g.tasks)}{/if}
					</tbody>
				{/each}
			</table>
		</div>
	{/if}

	{#snippet rh(key: string)}
		{#if canEditView && viewId}
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<span
				class="col-resize"
				use:tooltip={$i18n('Drag to resize')}
				onpointerdown={(e) => startResize(e, key)}
			></span>
		{/if}
	{/snippet}

	{#snippet groupRows(rows: Task[])}
		{#each rows as t (t.id)}
			{@const subs = subsOf(t.id)}
			{@const doneSubs = subs.filter((s) => isDone(s)).length}
			{@const deps = depsOf(t.id)}
			<tr class="task-row" class:is-done={isDone(t)} class:selected={nav.selectedId === t.id}>
				<td class="col-select" onclick={(e) => e.stopPropagation()}>
					<input
						type="checkbox"
						aria-label={$i18n('Select task')}
						checked={selection.has(t.id)}
						onclick={(e) => {
							e.stopPropagation();
							if ((e as MouseEvent).shiftKey) selection.range(t.id, orderedIds);
							else selection.toggle(t.id);
						}}
					/>
				</td>
				<td class="col-status">
					<StatusSelect
						taskId={t.id}
						statusId={t.statusId}
						{statuses}
						canEdit={canEditTask(t)}
						display={statusDisplay}
					/>
				</td>
				<td>
					<div class="title-cell">
						{#if subs.length > 0}
							<button
								class="chev"
								onclick={() => (expanded[t.id] = !expanded[t.id])}
								aria-expanded={expanded[t.id] ?? false}
								aria-label={$i18n('Toggle sub-tasks')}
							>
								{#if expanded[t.id]}<Icon name="nav-arrow-down" size={12} />{:else}<Icon
										name="nav-arrow-right"
										size={12}
									/>{/if}
							</button>
						{:else}
							<span class="chev-spacer" aria-hidden="true"></span>
						{/if}
						<button
							class="task-title"
							class:selected={nav.selectedId === t.id}
							onclick={() => nav.openDetail(t)}
						>
							{#if t.coverFileId}<img
									class="row-cover"
									src={`/api/files/${t.coverFileId}`}
									alt=""
									loading="lazy"
								/>{/if}
							<span class="title-text">{t.title}</span>
						</button>
						{#if deps.length > 0}
							<span
								class="badge badge-sm"
								use:tooltip={$i18n('Blocked by {names}', {
									names: deps.map((d) => d!.title).join(', ')
								})}
							>
								⛓ {deps.length}
							</span>
						{/if}
						{#if subs.length > 0}
							<span class="badge badge-sm">{doneSubs}/{subs.length}</span>
						{/if}
					</div>
				</td>
				{#if show('priority')}
					<td><PriorityBadge priority={t.priority} /></td>
				{/if}
				{#if show('assignee')}
					<td>
						{#if userName(t.assigneeId)}
							<span class="badge badge-neutral badge-sm">{userName(t.assigneeId)}</span>
						{:else}<span class="u-muted">—</span>{/if}
					</td>
				{/if}
				{#if show('milestone')}
					<td>
						{#if milestoneName(t.milestoneId)}{milestoneName(t.milestoneId)}{:else}<span
								class="u-muted">—</span
							>{/if}
					</td>
				{/if}
				{#if show('due')}
					<td class="mono">{fmtDate(t.dueDate) ?? '—'}</td>
				{/if}
				{#if show('labels')}
					<td>
						<div class="cell-labels">
							{#each labelsOf(t.id) as l (l!.id)}
								<LabelChip label={l!} size={11} />
							{:else}
								<span class="u-muted">—</span>
							{/each}
						</div>
					</td>
				{/if}
				{#each cfCols as c (c.key)}
					{#if show(c.key)}
						<td>
							<CustomFieldValue
								field={c.field}
								options={cfOptions(c.field.id)}
								value={cfValue(t.id, c.field.id)}
								rollupText={rollupText(t.id, c.field)}
								mode="cell"
								{users}
								{locations}
								tasks={allTasks}
								files={filesByTask.get(t.id) ?? []}
							/>
						</td>
					{/if}
				{/each}
				<td class="col-actions"></td>
			</tr>

			{#each expanded[t.id] ? subs : [] as s (s.id)}
				<tr class="sub-row-tr" class:is-done={isDone(s)} class:selected={nav.selectedId === s.id}>
					<td class="col-select"></td>
					<td class="col-status">
						<StatusSelect
							taskId={s.id}
							statusId={s.statusId}
							{statuses}
							canEdit={canEditTask(s)}
							display={statusDisplay}
						/>
					</td>
					<td>
						<div class="title-cell">
							<span class="chev-spacer" aria-hidden="true"></span>
							<button
								class="task-title"
								class:selected={nav.selectedId === s.id}
								onclick={() => nav.openDetail(s)}
							>
								<span class="title-text">{s.title}</span>
							</button>
						</div>
					</td>
					{#if show('priority')}
						<td><PriorityBadge priority={s.priority} /></td>
					{/if}
					{#if show('assignee')}
						<td>
							{#if userName(s.assigneeId)}<span class="badge badge-neutral badge-sm"
									>{userName(s.assigneeId)}</span
								>{:else}<span class="u-muted">—</span>{/if}
						</td>
					{/if}
					{#if show('milestone')}
						<td
							>{#if milestoneName(s.milestoneId)}{milestoneName(s.milestoneId)}{:else}<span
									class="u-muted">—</span
								>{/if}</td
						>
					{/if}
					{#if show('due')}
						<td class="mono">{fmtDate(s.dueDate) ?? '—'}</td>
					{/if}
					{#if show('labels')}
						<td>
							<div class="cell-labels">
								{#each labelsOf(s.id) as l (l!.id)}<LabelChip label={l!} size={11} />{:else}<span
										class="u-muted">—</span
									>{/each}
							</div>
						</td>
					{/if}
					{#each cfCols as c (c.key)}
						{#if show(c.key)}
							<td>
								{#if fieldAppliesTo(c.field, true)}
									<CustomFieldValue
										field={c.field}
										options={cfOptions(c.field.id)}
										value={cfValue(s.id, c.field.id)}
										rollupText={rollupText(s.id, c.field)}
										mode="cell"
										{users}
										{locations}
										tasks={allTasks}
										files={filesByTask.get(s.id) ?? []}
									/>
								{:else}<span class="u-muted">—</span>{/if}
							</td>
						{/if}
					{/each}
					<td class="col-actions"></td>
				</tr>
			{/each}
		{/each}
	{/snippet}

	{#if nav.selected}
		<TaskPanel
			task={nav.selected}
			tasks={allTasks}
			{users}
			{statuses}
			{milestones}
			{locations}
			{labels}
			{taskLabels}
			{taskDeps}
			{customFields}
			{customFieldOptions}
			{taskCustomValues}
			{files}
			{canEditTask}
			{templates}
			{statusDisplay}
			back={nav.backTask}
			onBack={nav.navBack}
			onClose={() => {
				nav.selectedId = null;
				nav.backStack = [];
			}}
			onSelectTask={(id) => nav.navTask(id)}
		/>
	{/if}
</div>

<svelte:window onclick={() => (colMenuOpen = false)} />

<style>
	.table-view {
		max-width: 1200px;
	}

	.empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		text-align: center;
		border: var(--border-width) solid var(--color-border-subtle);
		padding: var(--sp-6) var(--sp-3);
	}

	.add-fab {
		width: 44px;
		height: 44px;
		border: var(--border-width) solid var(--color-border-subtle);
		background: var(--color-bg);
		color: var(--color-fg);
		font-size: 24px;
		line-height: 1;
		cursor: pointer;
		transition:
			background var(--dur) ease,
			color var(--dur) ease,
			border-color var(--dur) ease,
			transform var(--dur-fast) ease;
	}

	.add-fab:hover {
		background: var(--color-fg);
		color: var(--color-bg);
		border-color: var(--color-fg);
	}

	.add-fab:active {
		transform: translateY(1px);
	}

	.table-wrap {
		overflow: visible;
	}

	/* Each group's <tbody> is its own card (frame borders below). The empty spacer
	   rows between cards have NO cells, so the card's per-cell side borders break
	   there → clean gaps with no continuous full-height side line. */
	.table tbody + tbody::before {
		content: '';
		display: table-row;
		height: 20px;
	}
	/* small gap between the column header and the first card */
	.table thead + tbody::before {
		content: '';
		display: table-row;
		height: 8px;
	}

	.group-row td {
		padding: var(--sp-3) var(--sp-2) var(--sp-1) 0;
		/* no divider under the group header — it sits flush atop its first task row
		   (the card's top border comes from the tbody-first-row rule below) */
		border-bottom: none;
		background: none;
	}

	/* header text of the Title column aligns with the task titles, which are indented
	   past the sub-task chevron spacer (chev 16px + title-cell gap) */
	.col-title {
		text-indent: calc(16px + var(--sp-1));
	}

	/* the group toggle lives in the select column — left-align it so the chevron
	   lines up with the row checkboxes (which sit at the cell's content start) */
	.group-row td.col-select {
		text-align: left;
		vertical-align: middle;
		padding-left: var(--sp-3);
		padding-right: var(--sp-3);
	}

	.group-head {
		display: flex;
		align-items: center;
		gap: var(--sp-1);
	}

	.group-toggle {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border: none;
		background: none;
		color: var(--color-muted);
		cursor: pointer;
		padding: 2px 0;
		border-radius: var(--radius-field, 0.25rem);
		transition:
			color var(--dur-fast) ease,
			background var(--dur-fast) ease;
	}

	.group-toggle:hover {
		color: var(--color-fg);
		background: var(--color-surface-muted);
	}

	.group-title {
		font-size: 14px;
		font-weight: 600;
		color: var(--color-fg);
		overflow-wrap: anywhere;
	}

	.group-count {
		font-size: 12px;
		color: var(--color-muted);
		font-variant-numeric: tabular-nums;
	}

	.group-agg {
		font-size: 12px;
		color: var(--color-muted);
		font-variant-numeric: tabular-nums;
	}

	.group-add {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border: none;
		background: none;
		color: var(--color-muted);
		font-size: 16px;
		line-height: 1;
		cursor: pointer;
		padding: 2px 8px;
		border-radius: var(--radius-field, 0.25rem);
		opacity: 0;
		transition:
			opacity var(--dur-fast) ease,
			color var(--dur-fast) ease,
			background var(--dur-fast) ease;
	}

	.group-head:hover .group-add,
	.group-add:focus-visible {
		opacity: 1;
	}

	.group-add:hover {
		color: var(--color-fg);
		background: var(--color-surface-muted);
	}

	/* fill the container at min, but keep natural column widths and let the content
	   pane scroll horizontally when the side pane narrows it (Notion-style — no squish) */
	.table {
		width: 100%;
		/* separate (not Tailwind-preflight's collapse default) so each group renders
		   as its own bordered+rounded card and the empty spacer rows between groups
		   stay clean (no continuous full-height side border). spacing:0 keeps inner
		   cell lines tight. */
		border-collapse: separate;
		border-spacing: 0;
	}

	/* per-group card frame: borders on the edge cells (first/last column) + the
	   group's first/last row, with rounded corners. Structural selectors so they
	   hit group-row, task-row AND sub-row alike; :global because rows render in a
	   snippet. The between-group spacer rows have no cells → the frame breaks. */
	.table :global(tbody > tr > td:first-child) {
		border-left: var(--border-width) solid var(--color-base-300);
	}
	.table :global(tbody > tr > td:last-child) {
		border-right: var(--border-width) solid var(--color-base-300);
	}
	.table :global(tbody > tr:first-child > td) {
		border-top: var(--border-width) solid var(--color-base-300);
	}
	.table :global(tbody > tr:last-child > td) {
		border-bottom: var(--border-width) solid var(--color-base-300);
	}
	.table :global(tbody > tr:first-child > td:first-child) {
		border-top-left-radius: var(--radius-box, 0.5rem);
	}
	.table :global(tbody > tr:first-child > td:last-child) {
		border-top-right-radius: var(--radius-box, 0.5rem);
	}
	.table :global(tbody > tr:last-child > td:first-child) {
		border-bottom-left-radius: var(--radius-box, 0.5rem);
	}
	.table :global(tbody > tr:last-child > td:last-child) {
		border-bottom-right-radius: var(--radius-box, 0.5rem);
	}
	/* no underline beneath the column header — the first card carries its own top edge */
	.table :global(thead th) {
		border-bottom: none;
	}

	/* high contrast squares the group cards (drop the rounded corners; the frame
	   borders stay). Pills/badges/etc. keep their radius — only the cards flatten. */
	:global([data-contrast='high']) .table :global(tbody > tr:first-child > td:first-child),
	:global([data-contrast='high']) .table :global(tbody > tr:first-child > td:last-child),
	:global([data-contrast='high']) .table :global(tbody > tr:last-child > td:first-child),
	:global([data-contrast='high']) .table :global(tbody > tr:last-child > td:last-child) {
		border-radius: 0;
	}

	.table :global(th),
	.table :global(td) {
		white-space: nowrap;
	}

	.table :global(th) {
		font-size: 12px;
		font-weight: 600;
		color: var(--color-muted);
		position: relative;
	}

	/* due-date cells + count badges show dynamic numbers — keep digits monospaced */
	.table :global(td.mono),
	.table :global(.badge) {
		font-variant-numeric: tabular-nums;
	}

	/* once columns have explicit widths the layout is fixed (widths authoritative,
	   content clips); table grows past the container and the content pane scrolls */
	.table.cols-fixed {
		table-layout: fixed;
		/* the inline width is the sum of column widths; when that's narrower than the
		   wrap, stretch to fill it (extra space distributes across columns) */
		min-width: 100%;
	}

	.table.cols-fixed :global(th),
	.table.cols-fixed :global(td) {
		overflow: hidden;
		text-overflow: ellipsis;
	}

	/* cells hosting popovers/controls (status pill, "…" menu, select checkbox) must
	   not clip — and must not render an ellipsis for their (empty) text content */
	.table.cols-fixed :global(th.col-actions),
	.table.cols-fixed :global(td.col-actions),
	.table.cols-fixed :global(th.col-status),
	.table.cols-fixed :global(td.col-status),
	.table.cols-fixed :global(th.col-select),
	.table.cols-fixed :global(td.col-select) {
		overflow: visible;
		text-overflow: clip;
	}

	.col-resize {
		position: absolute;
		top: 0;
		right: -3px;
		width: 7px;
		height: 100%;
		cursor: col-resize;
		z-index: 2;
		touch-action: none;
	}

	.col-resize:hover {
		background: color-mix(in oklab, var(--color-fg) 25%, transparent);
	}

	.col-select {
		/* width = checkbox + a small left gutter: shrink to content + drop DaisyUI's
		   1rem cell padding-inline (which otherwise made this column 3-4× the checkbox) */
		width: 1%;
		/* left padding matches the group chevron's (--sp-3) so the checkbox left edge
		   lines up with the chevron; right padding dropped to keep the column tight */
		padding-left: var(--sp-3);
		padding-right: var(--sp-3);
		margin-right: var(--sp-3);
		white-space: nowrap;
		text-align: left;
		vertical-align: middle;
	}

	.col-select input {
		display: block;
		margin: 0;
		padding-right: 0;
	}

	/* row checkbox shows on hover or when checked; header select-all always shows */
	.task-row .col-select input {
		opacity: 0;
		transition: opacity var(--dur-fast) ease;
	}
	.task-row:hover .col-select input,
	.task-row .col-select input:checked {
		opacity: 1;
	}

	.row-cover {
		width: 20px;
		height: 20px;
		object-fit: cover;
		border-radius: 3px;
		margin-right: 6px;
		vertical-align: middle;
		flex: 0 0 auto;
		outline: 1px solid rgba(0, 0, 0, 0.1);
		outline-offset: -1px;
	}

	:global([data-theme='dark']) .row-cover {
		outline-color: rgba(255, 255, 255, 0.1);
	}

	.col-status {
		width: 1%;
		white-space: nowrap;
		padding-left: 0;
	}

	/* Align the status pill's text/icon with the "Status" header text by pulling the
	   pill left over its own border (1px) + padding. Text/text-icon pad 10px (→ -11px);
	   the bare icon-only pill pads 2px (→ -3px). */
	.col-status :global(.status-pill) {
		margin-left: -11px;
	}

	.col-status :global(.status-pill.bare) {
		margin-left: -3px;
	}

	.col-actions {
		width: 1%;
		text-align: right;
	}

	.title-cell {
		display: flex;
		align-items: center;
		gap: var(--sp-1);
		flex-wrap: nowrap;
	}

	.chev {
		border: none;
		background: none;
		color: var(--color-muted);
		font-size: 11px;
		line-height: 1;
		cursor: pointer;
		padding: 2px;
		flex: 0 0 auto;
	}

	.chev:hover {
		color: var(--color-fg);
	}

	.task-title {
		border: none;
		background: none;
		font-family: var(--font-body);
		font-size: 15px;
		font-weight: 500;
		color: var(--color-fg);
		text-align: left;
		cursor: pointer;
		padding: 0;
	}

	.task-title:hover .title-text,
	.task-title.selected .title-text {
		text-decoration: underline;
		text-underline-offset: 3px;
	}

	.sub-row-tr {
		background: var(--color-surface-muted);
	}

	/* same box as .chev so a sub-task's title left-aligns with the parent's title */
	.chev-spacer {
		width: 16px;
		flex: 0 0 auto;
	}

	.cell-labels {
		display: flex;
		align-items: center;
		gap: var(--sp-1);
		flex-wrap: nowrap;
	}

	.col-menu-wrap {
		position: relative;
		display: inline-flex;
	}

	.col-menu-btn {
		border: none;
		background: none;
		color: var(--color-muted);
		font-size: 16px;
		line-height: 1;
		letter-spacing: 1px;
		cursor: pointer;
		padding: 2px 6px;
		border-radius: var(--radius-field, 0.25rem);
	}

	.col-menu-btn:hover {
		color: var(--color-fg);
		background: var(--color-surface-muted);
	}

	.col-menu {
		position: absolute;
		top: calc(100% + 4px);
		right: 0;
		z-index: 30;
		min-width: 160px;
		background: var(--color-base-100);
		border: 1px solid var(--color-base-300);
		border-radius: var(--radius-box, 0.5rem);
		box-shadow: var(--shadow);
		padding: 4px;
		transform-origin: top right;
	}

	.col-menu-rule {
		border-top: 1px solid var(--color-border-subtle);
		margin: 4px 0;
	}

	.col-menu-item {
		display: flex;
		align-items: center;
		gap: 6px;
		width: 100%;
		border: none;
		background: none;
		color: var(--color-fg);
		font-size: 13px;
		font-weight: 400;
		text-align: left;
		padding: 6px 8px;
		border-radius: var(--radius-field, 0.25rem);
		cursor: pointer;
		transition: background var(--dur-fast) ease;
	}

	.col-menu-item:hover {
		background: var(--color-surface-muted);
	}

	.col-check {
		display: inline-block;
		width: 12px;
		font-size: 11px;
		color: var(--color-muted);
	}
</style>
