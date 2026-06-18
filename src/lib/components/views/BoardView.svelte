<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import { tick } from 'svelte';
	import { flip } from 'svelte/animate';
	import PriorityIcon from '$lib/components/PriorityIcon.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import TaskPanel from '$lib/components/TaskPanel.svelte';
	import { t } from '$lib/i18n';
	import { tooltip } from '$lib/tooltip';
	import { fieldAggregations } from '$lib/customFields';

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
		coverFileId?: string | null;
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
		templates = [],
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
		templates?: { id: string; name: string }[];
		statusDisplay?: 'text' | 'icon' | 'text-icon';
		viewId?: string;
		viewName?: string;
		canEditView?: boolean;
		onNewTask?: (prefill?: Record<string, string>) => void;
	} = $props();

	// Columns are ALWAYS statuses. "Group by" milestone/assignee instead splits the
	// board into horizontal swimlanes (rows) — one per value (+ a `_none` lane) —
	// each containing the full status-column board.
	const groupBy = $derived(
		config.groupBy === 'milestone' || config.groupBy === 'assignee' || config.groupBy === 'label'
			? (config.groupBy as 'milestone' | 'assignee' | 'label')
			: 'status'
	);

	type Lane = { key: string; name: string };
	const lanes = $derived.by((): Lane[] => {
		if (groupBy === 'milestone')
			return [
				...milestones.map((m) => ({ key: m.id, name: m.name })),
				{ key: '_none', name: $t('No milestone') }
			];
		if (groupBy === 'assignee')
			return [
				...users.map((u) => ({ key: u.id, name: u.name })),
				{ key: '_none', name: $t('Unassigned') }
			];
		if (groupBy === 'label')
			return [
				...labels.map((l) => ({ key: l.id, name: l.name })),
				{ key: '_none', name: $t('No label') }
			];
		return [{ key: '', name: '' }]; // a single implicit lane for status boards
	});

	const laneField = (t: Task) =>
		groupBy === 'milestone' ? t.milestoneId : groupBy === 'assignee' ? t.assigneeId : null;
	const taskHasLabel = (t: Task, labelId: string) =>
		taskLabels.some((tl) => tl.taskId === t.id && tl.labelId === labelId);
	const inLane = (t: Task, laneKey: string) =>
		groupBy === 'status'
			? true
			: groupBy === 'label'
				? laneKey === '_none'
					? labelsOf(t.id).length === 0
					: taskHasLabel(t, laneKey)
				: laneKey === '_none'
					? !laneField(t)
					: laneField(t) === laneKey;

	let dragId = $state<string | null>(null);
	let over = $state<{ lane: string; statusId: string; index: number } | null>(null);
	let addingTo = $state<string | null>(null);
	let collapsedLanes = $state<Record<string, boolean>>({}); // lane.key → collapsed
	let addInput = $state<HTMLInputElement | null>(null);
	let justDragged = $state(false);
	// split pane: ?task= deep-links a task open
	let selectedId = $state<string | null>(page.url.searchParams.get('task'));
	// keep the pane in sync with browser back/forward to a ?task= link, without
	// fighting user clicks (effect tracks the URL only, never selectedId)
	let lastTaskParam = $state(page.url.searchParams.get('task'));
	$effect(() => {
		const fromUrl = page.url.searchParams.get('task');
		if (fromUrl !== lastTaskParam) {
			lastTaskParam = fromUrl;
			selectedId = fromUrl;
		}
	});
	const selected = $derived(tasks.find((t) => t.id === selectedId) ?? null);

	const glyph: Record<string, string> = {
		backlog: '○',
		planned: '◔',
		'in-progress': '◐',
		completed: '●',
		canceled: '⊘'
	};

	const topTasks = $derived(
		tasks
			.filter((t) => !t.parentId)
			.slice()
			.sort((a, b) => a.position - b.position)
	);
	const cellTasks = (laneKey: string, statusId: string) =>
		topTasks.filter((t) => t.statusId === statusId && inLane(t, laneKey));
	const laneTasks = (laneKey: string) => topTasks.filter((t) => inLane(t, laneKey));
	const laneCount = (laneKey: string) => laneTasks(laneKey).length;
	// Aggregations (config.aggregations): number field ids summed per group, shown as "(x)".
	const aggFieldIds = $derived(Array.isArray(config.aggregations) ? (config.aggregations as string[]) : []);

	// Status columns shown (config.statusIds): absent = all, in project order.
	const shownStatusIds = $derived(
		Array.isArray(config.statusIds) ? (config.statusIds as string[]) : null
	);
	const visibleStatuses = $derived(
		shownStatusIds ? statuses.filter((s) => shownStatusIds.includes(s.id)) : statuses
	);

	// Right-click column header → [Create task… | Hide]. Hide removes the status from config.statusIds.
	let colMenu = $state<{ statusId: string; lane: string; x: number; y: number } | null>(null);
	function openColMenu(e: MouseEvent, lane: string, statusId: string) {
		if (!canEditView) return;
		e.preventDefault();
		colMenu = { statusId, lane, x: e.clientX, y: e.clientY };
	}
	function lanePrefill(lane: string): Record<string, string> {
		if (groupBy === 'status' || lane === '_none') return {};
		if (groupBy === 'milestone') return { milestoneId: lane };
		if (groupBy === 'assignee') return { assigneeId: lane };
		if (groupBy === 'label') return { labelId: lane };
		return {};
	}
	async function saveConfig(next: Record<string, unknown>) {
		if (!canEditView || !viewId) return;
		const fd = new FormData();
		fd.set('id', viewId);
		fd.set('name', viewName);
		fd.set('config', JSON.stringify(next));
		await fetch(`${page.url.pathname}?/updateView`, { method: 'POST', body: fd });
		await invalidateAll();
	}
	function hideStatus(statusId: string) {
		const ids = (shownStatusIds ?? statuses.map((s) => s.id)).filter((id) => id !== statusId);
		colMenu = null;
		// keep undefined when all are shown so the config stays clean
		void saveConfig({ ...config, statusIds: ids.length === statuses.length ? undefined : ids });
	}
	const userName = (id: string | null) => users.find((u) => u.id === id)?.name ?? null;
	const initials = (name: string) =>
		name
			.split(/\s+/)
			.map((w) => w[0])
			.slice(0, 2)
			.join('')
			.toUpperCase();
	const labelsOf = (taskId: string) =>
		taskLabels
			.filter((l) => l.taskId === taskId)
			.map((l) => labels.find((x) => x.id === l.labelId))
			.filter(Boolean);

	function fmtDate(d: Date | string | null) {
		if (!d) return null;
		return new Date(d).toISOString().slice(5, 10); // MM-DD, Linear-compact
	}

	const dragged = $derived(topTasks.find((t) => t.id === dragId) ?? null);

	function onCardDragOver(e: DragEvent, lane: string, statusId: string, index: number) {
		if (!dragId) return;
		e.preventDefault();
		e.stopPropagation();
		const el = e.currentTarget as HTMLElement;
		const before = e.offsetY < el.offsetHeight / 2;
		over = { lane, statusId, index: before ? index : index + 1 };
	}

	function onColumnDragOver(e: DragEvent, lane: string, statusId: string) {
		if (!dragId) return;
		e.preventDefault();
		over = { lane, statusId, index: cellTasks(lane, statusId).length };
	}

	async function onDrop() {
		if (!dragId || !over || !dragged) return;
		const id = dragId;
		const laneChanged = groupBy !== 'status' && !inLane(dragged, over.lane);
		const statusChanged = dragged.statusId !== over.statusId;

		// position within the target cell (lane × status)
		const cell = cellTasks(over.lane, over.statusId);
		const without = cell.filter((t) => t.id !== id);
		let idx = over.index;
		const dragIdx = cell.findIndex((t) => t.id === id);
		if (dragIdx !== -1 && dragIdx < idx) idx -= 1;
		const before = without[idx]?.id ?? '';

		// no-op: same lane + same status + same slot
		if (!laneChanged && !statusChanged) {
			const cur = cell.findIndex((t) => t.id === id);
			if (cur === idx || (before === '' && cur === cell.length - 1)) {
				reset();
				return;
			}
		}

		reset();
		// reassign the swimlane field first (milestone/assignee), then move/reorder.
		// label lanes are multi-value — dragging across them changes status/position
		// only (labels are toggled in the task pane), so skip the field patch.
		if (laneChanged && (groupBy === 'milestone' || groupBy === 'assignee')) {
			const field = groupBy === 'milestone' ? 'milestoneId' : 'assigneeId';
			const fd = new FormData();
			fd.set('id', id);
			fd.set(field, over.lane === '_none' ? '' : over.lane);
			await fetch(`${page.url.pathname}?/patchTask`, { method: 'POST', body: fd });
		}
		const fd = new FormData();
		fd.set('id', id);
		fd.set('statusId', over.statusId);
		fd.set('beforeId', before);
		await fetch(`${page.url.pathname}?/moveTask`, { method: 'POST', body: fd });
		await invalidateAll();
	}

	function reset() {
		if (dragId) {
			// swallow the click that some browsers fire right after a drop
			justDragged = true;
			setTimeout(() => (justDragged = false), 100);
		}
		dragId = null;
		over = null;
	}

	async function openAdd(lane: string, statusId: string) {
		addingTo = `${lane}|${statusId}`;
		await tick();
		addInput?.focus();
	}

	function openDetail(t: Task) {
		selectedId = selectedId === t.id ? null : t.id;
	}
</script>

<div class="board-wrap">
{#each lanes as lane (lane.key)}
	{#if groupBy !== 'status'}
		<div class="lane-head">
			<button
				class="lane-toggle"
				type="button"
				aria-expanded={!collapsedLanes[lane.key]}
				aria-label={$t('Toggle group')}
				onclick={() => (collapsedLanes[lane.key] = !collapsedLanes[lane.key])}
			>
				<Icon name={collapsedLanes[lane.key] ? 'nav-arrow-right' : 'nav-arrow-down'} size={14} />
			</button>
			<span class="lane-name">{lane.name}</span>
			<span class="lane-count">{laneCount(lane.key)}</span>
			{#each fieldAggregations(aggFieldIds, customFields, laneTasks(lane.key), taskCustomValues, tasks) as a (a.id)}
				<span class="lane-agg" use:tooltip={a.name}>({a.text})</span>
			{/each}
		</div>
	{/if}
	{#if !collapsedLanes[lane.key]}
	<div class="board">
		{#each visibleStatuses as s (s.id)}
			{@const col = cellTasks(lane.key, s.id)}
			<div
				class="column"
				class:drop-target={over?.lane === lane.key && over?.statusId === s.id}
				role="list"
				aria-label={$t('{name} column', { name: s.name })}
				ondragover={(e) => onColumnDragOver(e, lane.key, s.id)}
				ondrop={onDrop}
			>
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div class="col-head" oncontextmenu={(e) => openColMenu(e, lane.key, s.id)}>
					<span class="col-glyph" class:done={s.category === 'completed'}>{glyph[s.category]}</span>
					<span class="col-name">{s.name}</span>
					<span class="col-count">{col.length}</span>
					{#each fieldAggregations(aggFieldIds, customFields, col, taskCustomValues, tasks) as a (a.id)}
						<span class="col-agg" use:tooltip={a.name}>({a.text})</span>
					{/each}
					<span class="col-spacer"></span>
					<button class="col-add" aria-label={$t('Add task to {name}', { name: s.name })} onclick={() => openAdd(lane.key, s.id)}>
						+
					</button>
				</div>

				<div class="col-body">
					{#each col as t, i (t.id)}
						{@const editable = canEditTask(t)}
						<div class="bcard-slot" animate:flip={{ duration: 220 }}>
						{#if over?.lane === lane.key && over?.statusId === s.id && over.index === i && dragId !== t.id}
							<div class="drop-line"></div>
						{/if}
						<!-- Whole card is draggable AND clickable; an inner button would block
						     Chrome from initiating drag, so the card itself is the control. -->
						<div
							class="bcard"
							class:dragging={dragId === t.id}
							class:clickable={true}
							class:selected={selectedId === t.id}
							role="button"
							tabindex="0"
							aria-label={t.title}
							draggable={editable}
							ondragstart={(e) => {
								dragId = t.id;
								e.dataTransfer?.setData('text/plain', t.id);
								if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
							}}
							ondragend={reset}
							ondragover={(e) => onCardDragOver(e, lane.key, s.id, i)}
							ondrop={onDrop}
							onclick={() => !justDragged && openDetail(t)}
							onkeydown={(e) => e.key === 'Enter' && openDetail(t)}
						>
							{#if t.coverFileId}
								<img class="bcard-cover" src={`/api/files/${t.coverFileId}`} alt="" loading="lazy" />
							{/if}
							<div class="bcard-top">
								<PriorityIcon priority={t.priority} />
								<span class="bcard-title">{t.title}</span>
							</div>
							{#if labelsOf(t.id).length > 0 || t.dueDate || t.assigneeId}
								<div class="bcard-meta">
									{#each labelsOf(t.id) as l (l!.id)}
										<span class="bchip">{l!.name}</span>
									{/each}
									{#if t.dueDate}
										<span class="bchip mono">{fmtDate(t.dueDate)}</span>
									{/if}
									<span class="bcard-spacer"></span>
									{#if userName(t.assigneeId)}
										<span class="avatar" use:tooltip={userName(t.assigneeId)}>
											{initials(userName(t.assigneeId)!)}
										</span>
									{/if}
								</div>
							{/if}
						</div>
						</div>
					{/each}
					{#if over?.lane === lane.key && over?.statusId === s.id && over.index >= col.length}
						<div class="drop-line"></div>
					{/if}

					{#if addingTo === `${lane.key}|${s.id}`}
						<form
							method="POST"
							action="?/createTask"
							use:enhance={() =>
								({ update }) => {
									addingTo = null;
									update();
								}}
							class="col-add-form"
						>
							<input type="hidden" name="statusId" value={s.id} />
							{#if groupBy !== 'status' && lane.key !== '_none'}
								<input
									type="hidden"
									name={groupBy === 'milestone' ? 'milestoneId' : groupBy === 'assignee' ? 'assigneeId' : 'labelId'}
									value={lane.key}
								/>
							{/if}
							<input
								bind:this={addInput}
								name="title"
								class="input"
								placeholder={$t('Task title…')}
								required
								maxlength="240"
								autocomplete="off"
								onkeydown={(e) => e.key === 'Escape' && (addingTo = null)}
							/>
						</form>
					{/if}
				</div>
			</div>
		{/each}
	</div>
	{/if}
{/each}

{#if colMenu}
	{@const cm = colMenu}
	<!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
	<div class="ctx-backdrop" onclick={() => (colMenu = null)} oncontextmenu={(e) => (e.preventDefault(), (colMenu = null))}></div>
	<div class="ctx-menu" style={`left:${cm.x}px; top:${cm.y}px`}>
		{#if onNewTask}
			<button
				class="ctx-item"
				type="button"
				onclick={() => {
					const sId = cm.statusId;
					colMenu = null;
					onNewTask?.({ statusId: sId, ...lanePrefill(cm.lane) });
				}}
			>
				{$t('Create task…')}
			</button>
		{/if}
		<button class="ctx-item" type="button" onclick={() => hideStatus(cm.statusId)}>{$t('Hide')}</button>
	</div>
{/if}

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
		{templates}
		{statusDisplay}
		onClose={() => (selectedId = null)}
		onSelectTask={(id) => (selectedId = id)}
	/>
{/if}
</div>

<style>
	.ctx-backdrop {
		position: fixed;
		inset: 0;
		z-index: 40;
	}

	.ctx-menu {
		position: fixed;
		z-index: 41;
		min-width: 150px;
		background: var(--color-base-100);
		border: 1px solid var(--color-base-300);
		border-radius: var(--radius-box, 0.5rem);
		box-shadow: var(--shadow);
		padding: 4px;
	}

	.ctx-item {
		display: block;
		width: 100%;
		text-align: left;
		border: none;
		background: none;
		color: var(--color-fg);
		font-size: 13px;
		padding: 6px 10px;
		border-radius: var(--radius-field, 0.25rem);
		cursor: pointer;
	}

	.ctx-item:hover {
		background: var(--color-surface-muted);
	}

	.board {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
		gap: var(--sp-2);
		align-items: start;
	}

	/* swimlanes (group by milestone/assignee): a labelled row per group */
	.lane-head {
		display: flex;
		align-items: center;
		gap: var(--sp-1);
		margin: var(--sp-4) 0 var(--sp-1);
	}

	.lane-head:first-child {
		margin-top: 0;
	}

	.lane-toggle {
		display: inline-flex;
		align-items: center;
		border: none;
		background: none;
		color: var(--color-muted);
		cursor: pointer;
		padding: 2px;
		margin-left: -2px;
		border-radius: var(--radius-field, 0.25rem);
		transition: color var(--dur-fast) ease, background var(--dur-fast) ease;
	}

	.lane-toggle:hover {
		color: var(--color-fg);
		background: var(--color-surface-muted);
	}

	.lane-name {
		font-size: 14px;
		font-weight: 600;
		overflow-wrap: anywhere;
	}

	.lane-count {
		font-size: 12px;
		color: var(--color-muted);
	}

	.lane-agg,
	.col-agg {
		font-size: 12px;
		color: var(--color-muted);
		font-variant-numeric: tabular-nums;
	}

	.column {
		background: var(--color-surface-muted);
		padding: var(--sp-1);
	}

	.column.drop-target {
		outline: 1px solid var(--color-border-subtle);
	}

	.col-head {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: var(--sp-1) var(--sp-1) var(--sp-2);
	}

	.col-glyph {
		font-size: 12px;
		color: var(--color-muted);
	}

	.col-glyph.done {
		color: var(--color-fg);
	}

	.col-name {
		font-size: 13px;
		font-weight: 600;
	}

	.col-count {
		font-size: 12px;
		color: var(--color-muted);
	}

	.col-spacer,
	.bcard-spacer {
		flex: 1;
	}

	.col-add {
		border: none;
		background: none;
		font-size: 16px;
		line-height: 1;
		color: var(--color-muted);
		cursor: pointer;
		padding: 0 4px;
		transition: color 0.15s ease;
	}

	.col-add:hover {
		color: var(--color-fg);
	}

	.col-body {
		display: flex;
		flex-direction: column;
		gap: var(--sp-1);
		min-height: 8px;
	}

	.bcard-slot {
		display: flex;
		flex-direction: column;
		gap: var(--sp-1);
	}

	.bcard {
		border: 1px solid var(--color-border-subtle);
		background: var(--color-bg);
		padding: var(--sp-2);
		transition:
			border-color 0.15s ease,
			box-shadow 0.15s ease,
			opacity 0.15s ease,
			transform 0.15s ease;
	}

	.bcard[draggable='true'] {
		cursor: grab;
	}

	.bcard[draggable='true']:active {
		cursor: grabbing;
	}

	.bcard.clickable:hover {
		border-color: var(--color-fg);
	}

	.bcard.selected {
		border-color: var(--color-fg);
	}

	.bcard.dragging {
		opacity: 0.4;
		transform: scale(0.97) rotate(-1deg);
		box-shadow: 0 6px 16px rgb(0 0 0 / 0.12);
		cursor: grabbing;
	}

	.bcard-cover {
		width: 100%;
		height: 96px;
		object-fit: cover;
		border-radius: var(--radius-field, 0.25rem);
		margin-bottom: 6px;
		display: block;
	}

	.bcard-top {
		display: flex;
		align-items: flex-start;
		gap: var(--sp-1);
	}

	.bcard-top :global(.pri) {
		margin-top: 4px;
	}

	.bcard-title {
		font-size: 13px;
		font-weight: 500;
		line-height: 1.4;
		overflow-wrap: anywhere;
	}

	.bcard-meta {
		display: flex;
		align-items: center;
		gap: var(--sp-1);
		flex-wrap: wrap;
		margin-top: var(--sp-1);
	}

	.bchip {
		border: 1px solid var(--color-border-subtle);
		color: var(--color-muted);
		font-family: var(--font-mono);
		font-size: 10px;
		padding: 0 6px;
		white-space: nowrap;
	}

	.avatar {
		width: 18px;
		height: 18px;
		flex: 0 0 18px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: var(--color-fg);
		color: var(--color-bg);
		font-size: 9px;
		font-weight: 600;
		letter-spacing: 0.02em;
	}

	.drop-line {
		height: 3px;
		background: var(--color-primary, var(--color-fg));
		border-radius: 999px;
		margin: -1px 0;
		box-shadow: 0 0 0 1px color-mix(in oklab, var(--color-primary, var(--color-fg)) 30%, transparent);
	}

	.col-add-form .input {
		padding: 6px 8px;
		font-size: 13px;
	}
</style>
