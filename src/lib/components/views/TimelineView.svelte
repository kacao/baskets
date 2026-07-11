<script lang="ts">
	import { browser } from '$app/environment';
	import { invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import { setPaneUrl, readPaneParam } from '$lib/paneUrl';
	import { untrack } from 'svelte';
	import Icon from '$lib/components/Icon.svelte';
	import PriorityIcon from '$lib/components/PriorityIcon.svelte';
	import TaskPanel from '$lib/components/TaskPanel.svelte';
	import { t } from '$lib/i18n';
	import { tooltip } from '$lib/tooltip';

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
		position: number;
		startDate: Date | string | null;
		dueDate: Date | string | null;
	};
	type Status = { id: string; name: string; category: string };
	type Location = { id: string; title: string; address: string | null; latitude: number | null; longitude: number | null };
	type CustomFieldDef = { id: string; name: string; type: string; config: Record<string, unknown>; position?: number };
	type CustomFieldOption = { id: string; fieldId: string; title: string; color: string | null; icon: string | null };
	type FileRef = { id: string; taskId: string | null; fieldId: string | null; filename: string; mimeType: string; size: number };

	let {
		tasks,
		allTasks = tasks,
		statuses,
		users,
		labels,
		taskLabels,
		taskDeps,
		milestones,
		locations,
		customFields = [],
		customFieldOptions = [],
		taskCustomValues = [],
		files = [],
		config = {},
		canEditTask,
		statusDisplay = 'text',
		templates = [],
		viewId,
		viewName = '',
		canEditView = false,
		onNewTask
	}: {
		tasks: Task[];
		allTasks?: Task[];
		statuses: Status[];
		users: { id: string; name: string }[];
		labels: { id: string; name: string }[];
		taskLabels: { taskId: string; labelId: string }[];
		taskDeps: { taskId: string; dependsOnId: string }[];
		milestones: { id: string; name: string }[];
		locations: Location[];
		customFields?: CustomFieldDef[];
		customFieldOptions?: CustomFieldOption[];
		taskCustomValues?: { taskId: string; fieldId: string; value: string }[];
		files?: FileRef[];
		config?: Record<string, unknown>;
		canEditTask: (t: { id: string; parentId: string | null }) => boolean;
		statusDisplay?: 'text' | 'icon' | 'text-icon';
		templates?: { id: string; name: string }[];
		viewId?: string;
		viewName?: string;
		canEditView?: boolean;
		onNewTask?: (prefill?: Record<string, string>) => void;
	} = $props();

	// split pane: ?task= deep-links a task open (matches Board/Table views)
	let selectedId = $state<string | null>(page.url.searchParams.get('task'));
	// nav history for in-pane task→task navigation (sub-task/cf link/dep/mention);
	// the top is the "← back" target, reset on any fresh open from outside the pane
	let backStack = $state<string[]>([]);
	// keep the pane in sync with browser back/forward to a ?task= link, without
	// fighting user clicks (effect tracks the URL only, never selectedId)
	let lastTaskParam = $state(page.url.searchParams.get('task'));
	$effect(() => {
		const fromUrl = readPaneParam('task');
		if (fromUrl !== untrack(() => lastTaskParam)) {
			lastTaskParam = fromUrl;
			selectedId = fromUrl;
			backStack = [];
		}
	});
	// mirror the open task back into the URL so the pane is linkable / restorable in
	// another window (shallow routing — load() doesn't re-run). lastTaskParam is a
	// plain sentinel read via untrack() in BOTH effects, so changing it in one never
	// re-runs the other with a stale page.url (which would clobber the selection).
	$effect(() => {
		const id = selectedId;
		if (id !== untrack(() => lastTaskParam)) {
			lastTaskParam = id;
			setPaneUrl({ task: id });
		}
	});
	const selected = $derived(allTasks.find((t) => t.id === selectedId) ?? null);
	function openDetail(t: Task) {
		selectedId = selectedId === t.id ? null : t.id;
		backStack = [];
	}
	function navTask(id: string) {
		if (id === selectedId) return;
		if (selectedId) backStack = [...backStack, selectedId];
		selectedId = id;
	}
	function navBack() {
		selectedId = backStack[backStack.length - 1] ?? null;
		backStack = backStack.slice(0, -1);
	}
	const backTask = $derived(
		backStack.length ? (allTasks.find((t) => t.id === backStack[backStack.length - 1]) ?? null) : null
	);

	const DAY = 86400000;
	function dayStart(d: Date | string): number {
		const x = new Date(d);
		x.setHours(0, 0, 0, 0);
		return x.getTime();
	}

	// Zoom (config.zoom): 'week' or 'month'. Local override so in-view toggle is
	// instant; persisted to view.config when the user has edit rights.
	let zoomOverride = $state<'week' | 'month' | null>(null);
	const zoom = $derived<'week' | 'month'>(
		zoomOverride ?? (config.zoom === 'month' ? 'month' : 'week')
	);
	// column width in px per day; week is denser, month is compact
	const colW = $derived(zoom === 'month' ? 6 : 28);

	async function setZoom(z: 'week' | 'month') {
		zoomOverride = z;
		if (!canEditView || !viewId) return;
		const fd = new FormData();
		fd.set('id', viewId);
		fd.set('name', viewName);
		fd.set('config', JSON.stringify({ ...config, zoom: z }));
		await fetch(`${page.url.pathname}?/updateView`, { method: 'POST', body: fd });
		await invalidateAll();
	}

	const topTasks = $derived(
		tasks
			.filter((t) => !t.parentId)
			.slice()
			.sort((a, b) => a.position - b.position)
	);

	// task → [start, end] in day-aligned epoch ms, or null when it has no dates.
	// dueDate-only tasks render as a single day; startDate-only tasks span start→start.
	function span(t: Task): { start: number; end: number } | null {
		const s = t.startDate ? dayStart(t.startDate) : null;
		const e = t.dueDate ? dayStart(t.dueDate) : null;
		if (s === null && e === null) return null;
		const start = s ?? (e as number);
		let end = e ?? (s as number);
		if (end < start) end = start;
		return { start, end };
	}

	const dated = $derived(topTasks.filter((t) => span(t) !== null));
	const undated = $derived(topTasks.filter((t) => span(t) === null));

	const today = $derived(dayStart(new Date()));

	// Date axis: min start → max end across dated tasks, padded a few days each side
	// and always including today so the marker is on-screen.
	const range = $derived.by(() => {
		let min = today;
		let max = today;
		let first = true;
		for (const t of dated) {
			const sp = span(t)!;
			if (first) {
				min = sp.start;
				max = sp.end;
				first = false;
			} else {
				if (sp.start < min) min = sp.start;
				if (sp.end > max) max = sp.end;
			}
		}
		if (today < min) min = today;
		if (today > max) max = today;
		const pad = zoom === 'month' ? 7 : 2;
		min -= pad * DAY;
		max += pad * DAY;
		// snap min to a Monday so week gridlines align
		const d = new Date(min);
		const dow = (d.getDay() + 6) % 7; // 0 = Monday
		min -= dow * DAY;
		return { min, max };
	});

	const totalDays = $derived(Math.max(1, Math.round((range.max - range.min) / DAY) + 1));
	const chartWidth = $derived(totalDays * colW);
	const xOf = (ms: number) => Math.round(((ms - range.min) / DAY) * colW);
	const todayX = $derived(xOf(today) + colW / 2);

	// Axis ticks: week → one label per week (Mondays); month → one per month start.
	type Tick = { x: number; label: string };
	const ticks = $derived.by((): Tick[] => {
		const out: Tick[] = [];
		if (zoom === 'month') {
			const d = new Date(range.min);
			d.setDate(1);
			while (d.getTime() <= range.max) {
				out.push({
					x: xOf(dayStart(d)),
					label: d.toLocaleDateString(undefined, { month: 'short', year: '2-digit' })
				});
				d.setMonth(d.getMonth() + 1);
			}
		} else {
			let ms = range.min;
			while (ms <= range.max) {
				out.push({
					x: xOf(ms),
					label: new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
				});
				ms += 7 * DAY;
			}
		}
		return out;
	});

	// Group rows by milestone (+ a "No milestone" bucket), each lane only kept if it
	// has dated tasks. Undated tasks render in a separate "No dates" list below.
	type Lane = { key: string; name: string; tasks: Task[] };
	const lanes = $derived.by((): Lane[] => {
		const out: Lane[] = milestones.map((m) => ({
			key: m.id,
			name: m.name,
			tasks: dated.filter((t) => t.milestoneId === m.id)
		}));
		out.push({
			key: '_none',
			name: $t('No milestone'),
			tasks: dated.filter((t) => !t.milestoneId)
		});
		return out.filter((l) => l.tasks.length > 0);
	});

	let collapsed = $state<Record<string, boolean>>({});

	// Row height drives the SVG/layout math. Bump it on narrow/touch screens so bars
	// and lane toggles stay comfortably tappable.
	let vw = $state(browser ? window.innerWidth : 1200);
	$effect(() => {
		if (!browser) return;
		const onResize = () => (vw = window.innerWidth);
		window.addEventListener('resize', onResize);
		return () => window.removeEventListener('resize', onResize);
	});
	const ROW_H = $derived(vw <= 720 ? 40 : 30);
	const cat = (id: string) => statuses.find((s) => s.id === id)?.category ?? 'backlog';

	// Flatten rows so dependency lines can be drawn across lanes by row index.
	type Row = { task: Task; y: number; x1: number; x2: number };
	const rows = $derived.by((): Row[] => {
		const out: Row[] = [];
		let y = 0;
		for (const lane of lanes) {
			y += 1; // lane header row
			if (collapsed[lane.key]) continue;
			for (const t of lane.tasks) {
				const sp = span(t)!;
				out.push({
					task: t,
					y: y * ROW_H + ROW_H / 2,
					x1: xOf(sp.start),
					x2: xOf(sp.end) + colW
				});
				y += 1;
			}
		}
		return out;
	});
	const rowByTask = $derived(new Map(rows.map((r) => [r.task.id, r])));
	const chartHeight = $derived(rows.length > 0 ? (rows.length + lanes.length) * ROW_H + ROW_H : ROW_H);

	// Dependency lines: from each dependency's end to the dependent task's start,
	// only when both endpoints are visible rows.
	type Dep = { x1: number; y1: number; x2: number; y2: number };
	const depLines = $derived.by((): Dep[] => {
		const out: Dep[] = [];
		for (const d of taskDeps) {
			const to = rowByTask.get(d.taskId);
			const from = rowByTask.get(d.dependsOnId);
			if (!to || !from) continue;
			out.push({ x1: from.x2, y1: from.y, x2: to.x1, y2: to.y });
		}
		return out;
	});

	function fmtRange(t: Task): string {
		const sp = span(t)!;
		const f = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
		return sp.start === sp.end ? f(sp.start) : `${f(sp.start)} – ${f(sp.end)}`;
	}
</script>

<div class="tl-wrap">
	<div class="tl-toolbar">
		<div class="zoom">
			<button class="zbtn" class:active={zoom === 'week'} type="button" onclick={() => setZoom('week')}>
				{$t('Week')}
			</button>
			<button class="zbtn" class:active={zoom === 'month'} type="button" onclick={() => setZoom('month')}>
				{$t('Month')}
			</button>
		</div>
		{#if onNewTask}
			<button class="tl-add" type="button" aria-label={$t('New task')} use:tooltip={$t('New task')} onclick={() => onNewTask?.()}>+</button>
		{/if}
	</div>

	{#if dated.length === 0}
		<p class="u-muted tl-empty">{$t('No tasks with dates yet.')}</p>
	{:else}
		<div class="tl-scroll">
			<div class="tl-grid" style={`width:${chartWidth}px; --row-h:${ROW_H}px`}>
				<!-- axis header -->
				<div class="tl-axis" style={`height:${ROW_H}px`}>
					{#each ticks as tk (tk.x)}
						<span class="tl-tick" style={`left:${tk.x}px`}>{tk.label}</span>
					{/each}
				</div>

				<!-- chart body -->
				<div class="tl-body" style={`height:${chartHeight}px`}>
					<!-- vertical gridlines -->
					{#each ticks as tk (tk.x)}
						<div class="tl-gridline" style={`left:${tk.x}px`}></div>
					{/each}

					<!-- today marker -->
					<div class="tl-today" style={`left:${todayX}px`} use:tooltip={$t('Today')}></div>

					<!-- dependency lines -->
					{#if depLines.length > 0}
						<svg class="tl-deps" width={chartWidth} height={chartHeight} aria-hidden="true">
							{#each depLines as d (`${d.x1}-${d.y1}-${d.x2}-${d.y2}`)}
								<path
									d={`M ${d.x1} ${d.y1} C ${d.x1 + 16} ${d.y1}, ${d.x2 - 16} ${d.y2}, ${d.x2} ${d.y2}`}
									fill="none"
								/>
							{/each}
						</svg>
					{/if}

					<!-- lanes + bars -->
					{#each lanes as lane (lane.key)}
						<div class="tl-lane-head" style={`height:${ROW_H}px`}>
							<button
								class="tl-lane-toggle"
								type="button"
								aria-expanded={!collapsed[lane.key]}
								aria-label={$t('Toggle group')}
								onclick={() => (collapsed[lane.key] = !collapsed[lane.key])}
							>
								<Icon name={collapsed[lane.key] ? 'nav-arrow-right' : 'nav-arrow-down'} size={14} />
							</button>
							<span class="tl-lane-name">{lane.name}</span>
							<span class="tl-lane-count">{lane.tasks.length}</span>
						</div>
						{#if !collapsed[lane.key]}
							{#each lane.tasks as tk (tk.id)}
								{@const sp = span(tk)}
								<div class="tl-row" style={`height:${ROW_H}px`}>
									<button
										class="tl-bar cat-{cat(tk.statusId)}"
										class:selected={selectedId === tk.id}
										style={`left:${xOf(sp!.start)}px; width:${Math.max(colW, xOf(sp!.end) - xOf(sp!.start) + colW)}px`}
										type="button"
										use:tooltip={`${tk.title} · ${fmtRange(tk)}`}
										onclick={() => openDetail(tk)}
									>
										<PriorityIcon priority={tk.priority} />
										<span class="tl-bar-title">{tk.title}</span>
									</button>
								</div>
							{/each}
						{/if}
					{/each}
				</div>
			</div>
		</div>
	{/if}

	{#if undated.length > 0}
		<div class="tl-nodates">
			<div class="tl-nodates-head">{$t('No dates')} <span class="tl-lane-count">{undated.length}</span></div>
			<div class="tl-nodates-list">
				{#each undated as tk (tk.id)}
					<button
						class="tl-chip cat-{cat(tk.statusId)}"
						class:selected={selectedId === tk.id}
						type="button"
						onclick={() => openDetail(tk)}
					>
						<PriorityIcon priority={tk.priority} />
						<span class="tl-bar-title">{tk.title}</span>
					</button>
				{/each}
			</div>
		</div>
	{/if}
</div>

{#if selected}
	<TaskPanel
		task={selected}
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
		back={backTask}
		onBack={navBack}
		onClose={() => {
			selectedId = null;
			backStack = [];
		}}
		onSelectTask={(id) => navTask(id)}
	/>
{/if}

<style>
	.tl-wrap {
		display: flex;
		flex-direction: column;
		gap: var(--sp-2);
	}

	.tl-toolbar {
		display: flex;
		align-items: center;
		gap: var(--sp-2);
	}

	.zoom {
		display: inline-flex;
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-field, 0.25rem);
		overflow: hidden;
	}

	.zbtn {
		border: none;
		background: var(--color-bg);
		color: var(--color-muted);
		font-size: 12px;
		font-weight: 500;
		padding: 4px 10px;
		cursor: pointer;
		transition: background var(--dur-fast) ease, color var(--dur-fast) ease;
	}

	.zbtn:hover {
		color: var(--color-fg);
	}

	.zbtn.active {
		background: var(--color-fg);
		color: var(--color-bg);
	}

	.tl-add {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 28px;
		min-height: 28px;
		border: none;
		background: none;
		font-size: 18px;
		line-height: 1;
		color: var(--color-muted);
		cursor: pointer;
		padding: 0 6px;
		transition: color var(--dur-fast) ease, transform var(--dur-fast) ease;
	}

	.tl-add:hover {
		color: var(--color-fg);
	}

	.tl-add:active {
		transform: scale(0.96);
	}

	.tl-empty {
		padding: var(--sp-4);
	}

	.tl-scroll {
		overflow-x: auto;
		border: 1px solid var(--color-base-300);
		border-radius: var(--radius-box, 0.5rem);
	}

	.tl-grid {
		position: relative;
		min-width: 100%;
	}

	.tl-axis {
		position: relative;
		border-bottom: 1px solid var(--color-border-subtle);
	}

	.tl-tick {
		position: absolute;
		top: 0;
		transform: translateX(2px);
		font-size: 11px;
		line-height: 30px;
		color: var(--color-muted);
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
	}

	.tl-body {
		position: relative;
	}

	.tl-gridline {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 1px;
		background: var(--color-border-subtle);
		opacity: 0.5;
	}

	.tl-today {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 2px;
		background: var(--color-error, crimson);
		z-index: 2;
	}

	.tl-deps {
		position: absolute;
		top: 0;
		left: 0;
		pointer-events: none;
		z-index: 1;
	}

	.tl-deps :global(path) {
		stroke: var(--color-muted);
		stroke-width: 1.5;
		stroke-dasharray: 3 3;
		opacity: 0.7;
	}

	.tl-lane-head {
		position: relative;
		display: flex;
		align-items: center;
		gap: var(--sp-1);
		z-index: 3;
	}

	.tl-lane-toggle {
		position: relative;
		display: inline-flex;
		align-items: center;
		border: none;
		background: none;
		color: var(--color-muted);
		cursor: pointer;
		padding: 2px;
		border-radius: var(--radius-field, 0.25rem);
		transition: color var(--dur-fast) ease, background var(--dur-fast) ease;
	}

	.tl-lane-toggle::before {
		content: '';
		position: absolute;
		top: 50%;
		left: 50%;
		width: 32px;
		height: 32px;
		transform: translate(-50%, -50%);
	}

	.tl-lane-toggle:hover {
		color: var(--color-fg);
		background: var(--color-surface-muted);
	}

	.tl-lane-name {
		font-size: 13px;
		font-weight: 600;
	}

	.tl-lane-count {
		font-size: 12px;
		color: var(--color-muted);
		font-variant-numeric: tabular-nums;
	}

	.tl-row {
		position: relative;
	}

	.tl-bar {
		position: absolute;
		top: 4px;
		height: calc(var(--row-h, 30px) - 8px);
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 0 6px;
		border: 1px solid var(--color-border-subtle);
		background: var(--color-surface-muted);
		color: var(--color-fg);
		border-radius: var(--radius-field, 0.25rem);
		cursor: pointer;
		overflow: hidden;
		z-index: 2;
		transition: border-color var(--dur-fast) ease, box-shadow var(--dur-fast) ease;
	}

	.tl-bar:hover,
	.tl-bar.selected {
		border-color: var(--color-fg);
	}

	.tl-bar-title {
		font-size: 12px;
		font-weight: 500;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.cat-in-progress {
		background: color-mix(in oklab, var(--color-fg) 12%, var(--color-bg));
	}

	.cat-completed {
		opacity: 0.6;
	}

	.cat-canceled {
		opacity: 0.45;
	}

	.tl-nodates {
		border: 1px solid var(--color-base-300);
		border-radius: var(--radius-box, 0.5rem);
		padding: var(--sp-2);
	}

	.tl-nodates-head {
		font-size: 13px;
		font-weight: 600;
		margin-bottom: var(--sp-1);
	}

	.tl-nodates-list {
		display: flex;
		flex-wrap: wrap;
		gap: var(--sp-1);
	}

	.tl-chip {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		max-width: 220px;
		padding: 3px 8px;
		border: 1px solid var(--color-border-subtle);
		background: var(--color-bg);
		color: var(--color-fg);
		border-radius: var(--radius-field, 0.25rem);
		cursor: pointer;
		transition: border-color var(--dur-fast) ease;
	}

	.tl-chip:hover,
	.tl-chip.selected {
		border-color: var(--color-fg);
	}

	@media (max-width: 720px) {
		.tl-scroll {
			-webkit-overflow-scrolling: touch;
		}

		/* bar height already tracks --row-h (=40px here); make the lane toggle match */
		.tl-lane-toggle {
			min-width: 40px;
			min-height: 40px;
			justify-content: center;
		}

		.tl-lane-toggle::before {
			width: 40px;
			height: 40px;
		}
	}

	@media (max-width: 375px) {
		.tl-nodates-list {
			flex-direction: column;
			flex-wrap: nowrap;
		}

		.tl-chip {
			max-width: 100%;
			width: 100%;
		}
	}
</style>
