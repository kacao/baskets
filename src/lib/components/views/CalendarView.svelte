<script lang="ts">
	import { page } from '$app/state';
	import PriorityIcon from '$lib/components/PriorityIcon.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import TaskPanel from '$lib/components/TaskPanel.svelte';
	import { t } from '$lib/i18n';

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
		dueDate: Date | string | null;
	};
	type Status = { id: string; name: string; category: string };
	type Location = { id: string; title: string; address: string | null; latitude: number | null; longitude: number | null };
	type CustomFieldDef = { id: string; name: string; type: string; config: Record<string, unknown>; position?: number };
	type CustomFieldOption = { id: string; fieldId: string; title: string; color: string | null; icon: string | null };
	type FileRef = { id: string; taskId: string | null; fieldId: string | null; filename: string; mimeType: string; size: number };

	let {
		tasks,
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
		viewId,
		viewName = '',
		canEditView = false,
		onNewTask
	}: {
		tasks: Task[];
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
		viewId?: string;
		viewName?: string;
		canEditView?: boolean;
		onNewTask?: (prefill?: Record<string, string>) => void;
	} = $props();

	// split pane: ?task= deep-links a task open
	let selectedId = $state<string | null>(page.url.searchParams.get('task'));
	const selected = $derived(tasks.find((t) => t.id === selectedId) ?? null);

	function openDetail(t: Task) {
		selectedId = selectedId === t.id ? null : t.id;
	}

	const today = new Date();
	const todayKey = ymd(today);

	// month being viewed — anchored to the 1st
	let cursor = $state(new Date(today.getFullYear(), today.getMonth(), 1));

	function ymd(d: Date): string {
		const y = d.getFullYear();
		const m = String(d.getMonth() + 1).padStart(2, '0');
		const day = String(d.getDate()).padStart(2, '0');
		return `${y}-${m}-${day}`;
	}

	// local-date key for a task's dueDate (avoids UTC slicing shifting the day)
	function dueKey(d: Date | string | null): string | null {
		if (!d) return null;
		const dt = new Date(d);
		if (Number.isNaN(dt.getTime())) return null;
		return ymd(dt);
	}

	const monthLabel = $derived(
		cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
	);

	const weekdayNames = $derived.by(() => {
		const base = new Date(2024, 0, 7); // a Sunday
		return Array.from({ length: 7 }, (_, i) =>
			new Date(base.getFullYear(), base.getMonth(), base.getDate() + i).toLocaleDateString(
				undefined,
				{ weekday: 'short' }
			)
		);
	});

	type Cell = { date: Date; key: string; inMonth: boolean };
	const weeks = $derived.by((): Cell[][] => {
		const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
		const start = new Date(first);
		start.setDate(first.getDate() - first.getDay()); // back to Sunday
		const cells: Cell[] = [];
		for (let i = 0; i < 42; i++) {
			const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
			cells.push({ date: d, key: ymd(d), inMonth: d.getMonth() === cursor.getMonth() });
		}
		const rows: Cell[][] = [];
		for (let w = 0; w < 6; w++) rows.push(cells.slice(w * 7, w * 7 + 7));
		// trim a trailing all-out-of-month week (months that fit in 5 rows)
		if (rows[5].every((c) => !c.inMonth)) rows.pop();
		return rows;
	});

	// top-level tasks bucketed by due-date key
	const tasksByDay = $derived.by(() => {
		const map = new Map<string, Task[]>();
		for (const t of tasks) {
			if (t.parentId) continue;
			const k = dueKey(t.dueDate);
			if (!k) continue;
			const arr = map.get(k);
			if (arr) arr.push(t);
			else map.set(k, [t]);
		}
		for (const arr of map.values()) arr.sort((a, b) => a.position - b.position);
		return map;
	});

	const MAX_CHIPS = 3;
	const tasksOn = (key: string) => tasksByDay.get(key) ?? [];

	const statusCat = (id: string) => statuses.find((s) => s.id === id)?.category ?? 'backlog';

	function gotoPrev() {
		cursor = new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1);
	}
	function gotoNext() {
		cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
	}
	function gotoToday() {
		cursor = new Date(today.getFullYear(), today.getMonth(), 1);
	}

	function addOn(key: string) {
		onNewTask?.({ dueDate: key });
	}
</script>

<div class="cal-wrap">
	<div class="cal-toolbar">
		<div class="cal-nav">
			<button class="nav-btn" type="button" aria-label={$t('Previous month')} onclick={gotoPrev}>
				<Icon name="nav-arrow-left" size={16} />
			</button>
			<button class="today-btn" type="button" onclick={gotoToday}>{$t('Today')}</button>
			<button class="nav-btn" type="button" aria-label={$t('Next month')} onclick={gotoNext}>
				<Icon name="nav-arrow-right" size={16} />
			</button>
		</div>
		<span class="cal-month">{monthLabel}</span>
	</div>

	<div class="cal-grid">
		<div class="cal-weekdays">
			{#each weekdayNames as wd (wd)}
				<div class="weekday">{wd}</div>
			{/each}
		</div>
		{#each weeks as week, wi (wi)}
			<div class="cal-week">
				{#each week as cell (cell.key)}
					{@const dayTasks = tasksOn(cell.key)}
					<div class="cal-day" class:out={!cell.inMonth} class:today={cell.key === todayKey}>
						<div class="day-head">
							<span class="day-num">{cell.date.getDate()}</span>
							{#if onNewTask && canEditTask({ id: '', parentId: null })}
								<button
									class="day-add"
									type="button"
									aria-label={$t('Add task on {date}', { date: cell.key })}
									onclick={() => addOn(cell.key)}
								>
									+
								</button>
							{/if}
						</div>
						<div class="day-body">
							{#each dayTasks.slice(0, MAX_CHIPS) as t (t.id)}
								<button
									class="chip cat-{statusCat(t.statusId)}"
									class:selected={selectedId === t.id}
									type="button"
									title={t.title}
									onclick={() => openDetail(t)}
								>
									<PriorityIcon priority={t.priority} />
									<span class="chip-title">{t.title}</span>
								</button>
							{/each}
							{#if dayTasks.length > MAX_CHIPS}
								<button class="chip more" type="button" onclick={() => openDetail(dayTasks[MAX_CHIPS])}>
									{$t('+{n} more', { n: dayTasks.length - MAX_CHIPS })}
								</button>
							{/if}
						</div>
					</div>
				{/each}
			</div>
		{/each}
	</div>

	{#if selected}
		<TaskPanel
			task={selected}
			{tasks}
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
			{statusDisplay}
			onClose={() => (selectedId = null)}
			onSelectTask={(id) => (selectedId = id)}
		/>
	{/if}
</div>

<style>
	.cal-wrap {
		display: flex;
		flex-direction: column;
		gap: var(--sp-2);
	}

	.cal-toolbar {
		display: flex;
		align-items: center;
		gap: var(--sp-3);
	}

	.cal-nav {
		display: flex;
		align-items: center;
		gap: var(--sp-1);
	}

	.nav-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border: 1px solid var(--color-border-subtle);
		background: var(--color-bg);
		color: var(--color-fg);
		cursor: pointer;
		padding: 4px;
		border-radius: var(--radius-field, 0.25rem);
		transition: border-color 0.15s ease;
	}

	.nav-btn:hover {
		border-color: var(--color-fg);
	}

	.today-btn {
		border: 1px solid var(--color-border-subtle);
		background: var(--color-bg);
		color: var(--color-fg);
		font-size: 13px;
		padding: 4px 10px;
		cursor: pointer;
		border-radius: var(--radius-field, 0.25rem);
		transition: border-color 0.15s ease;
	}

	.today-btn:hover {
		border-color: var(--color-fg);
	}

	.cal-month {
		font-size: 15px;
		font-weight: 600;
	}

	.cal-grid {
		border: 1px solid var(--color-border-subtle);
		border-bottom: none;
	}

	.cal-weekdays,
	.cal-week {
		display: grid;
		grid-template-columns: repeat(7, 1fr);
	}

	.weekday {
		font-size: 11px;
		font-weight: 600;
		color: var(--color-muted);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		padding: var(--sp-1);
		text-align: right;
		border-bottom: 1px solid var(--color-border-subtle);
		border-left: 1px solid var(--color-border-subtle);
	}

	.weekday:first-child {
		border-left: none;
	}

	.cal-day {
		min-height: 96px;
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 2px;
		border-bottom: 1px solid var(--color-border-subtle);
		border-left: 1px solid var(--color-border-subtle);
		background: var(--color-bg);
	}

	.cal-day:first-child {
		border-left: none;
	}

	.cal-day.out {
		background: var(--color-surface-muted);
	}

	.cal-day.out .day-num {
		color: var(--color-muted);
	}

	.cal-day.today .day-num {
		background: var(--color-fg);
		color: var(--color-bg);
		border-radius: 999px;
	}

	.day-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.day-num {
		font-size: 12px;
		font-variant-numeric: tabular-nums;
		min-width: 18px;
		height: 18px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0 4px;
	}

	.day-add {
		border: none;
		background: none;
		color: var(--color-muted);
		font-size: 15px;
		line-height: 1;
		cursor: pointer;
		padding: 0 4px;
		opacity: 0;
		transition: opacity 0.15s ease, color 0.15s ease;
	}

	.cal-day:hover .day-add {
		opacity: 1;
	}

	.day-add:hover {
		color: var(--color-fg);
	}

	.day-body {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.chip {
		display: flex;
		align-items: center;
		gap: 4px;
		width: 100%;
		text-align: left;
		border: 1px solid var(--color-border-subtle);
		border-left-width: 2px;
		background: var(--color-bg);
		color: var(--color-fg);
		font-size: 11px;
		line-height: 1.3;
		padding: 1px 4px;
		cursor: pointer;
		border-radius: var(--radius-field, 0.25rem);
		transition: border-color 0.15s ease;
	}

	.chip:hover,
	.chip.selected {
		border-color: var(--color-fg);
	}

	.chip-title {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.chip.cat-completed {
		border-left-color: var(--color-success, var(--color-fg));
	}

	.chip.cat-in-progress {
		border-left-color: var(--color-warning, var(--color-fg));
	}

	.chip.cat-canceled {
		border-left-color: var(--color-muted);
	}

	.chip.more {
		justify-content: center;
		border-style: dashed;
		border-left-width: 1px;
		color: var(--color-muted);
		font-size: 10px;
	}
</style>
