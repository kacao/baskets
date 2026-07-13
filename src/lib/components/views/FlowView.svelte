<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { page } from '$app/state';
	import { setPaneUrl, readPaneParam } from '$lib/paneUrl';
	import TaskPanel from '$lib/components/TaskPanel.svelte';
	import Icon from '$lib/components/Icon.svelte';
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
		dueDate: Date | string | null;
		coverFileId?: string | null;
	};
	type Status = { id: string; name: string; category: string; color?: string | null };
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
		statusIds,
		showMilestones = true,
		users,
		statuses,
		milestones,
		locations,
		labels,
		taskLabels,
		taskDeps,
		milestoneDeps,
		customFields = [],
		customFieldOptions = [],
		taskCustomValues = [],
		files = [],
		canEditTask,
		statusDisplay = 'text',
		templates = []
	}: {
		tasks: Task[];
		allTasks?: Task[];
		statusIds?: string[];
		showMilestones?: boolean;
		users: { id: string; name: string }[];
		statuses: Status[];
		milestones: { id: string; name: string }[];
		locations: Location[];
		labels: { id: string; name: string; color?: string | null; icon?: string | null }[];
		taskLabels: { taskId: string; labelId: string }[];
		taskDeps: { taskId: string; dependsOnId: string }[];
		milestoneDeps: { milestoneId: string; dependsOnId: string }[];
		customFields?: CustomFieldDef[];
		customFieldOptions?: CustomFieldOption[];
		taskCustomValues?: { taskId: string; fieldId: string; value: string }[];
		files?: FileRef[];
		canEditTask: (t: { id: string; parentId: string | null }) => boolean;
		statusDisplay?: 'text' | 'icon' | 'text-icon';
		templates?: { id: string; name: string }[];
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
		backStack.length
			? (allTasks.find((t) => t.id === backStack[backStack.length - 1]) ?? null)
			: null
	);
	// "Statuses shown" (Customize) — graph nodes limited to these statuses; absent = all
	const graphTasks = $derived(
		statusIds ? tasks.filter((t) => statusIds.includes(t.statusId)) : tasks
	);
	// main flow charts only top-level tasks; sub-tasks appear via focus-mode expansion
	const topTasks = $derived(graphTasks.filter((t) => !t.parentId));

	// double-click a milestone node → drill into a focused flow of only its tasks
	let focusedMilestone = $state<string | null>(null);
	const focusedMs = $derived(milestones.find((m) => m.id === focusedMilestone) ?? null);
	const focusTasks = $derived(
		focusedMs ? topTasks.filter((t) => t.milestoneId === focusedMs.id) : []
	);

	// Svelte Flow touches the DOM at import (ResizeObserver etc.), so load the canvas
	// only in the browser — same client-only convention as MapView/Leaflet.
	let Canvas = $state<typeof import('./FlowCanvas.svelte').default | null>(null);
	onMount(async () => {
		Canvas = (await import('./FlowCanvas.svelte')).default;
	});
</script>

<div class="flow-view">
	{#if focusedMs}
		<div class="flow-focus-bar">
			<button class="flow-back" type="button" onclick={() => (focusedMilestone = null)}>
				<Icon name="arrow-left" size={14} />
				{$t('Flow')}
			</button>
			<span class="flow-focus-title">{focusedMs.name}</span>
			<span class="flow-focus-count">{focusTasks.length}</span>
		</div>
	{/if}
	<div class="flow-body">
		{#if Canvas}
			{#if focusedMs}
				<Canvas
					tasks={focusTasks}
					{allTasks}
					milestones={[]}
					{statuses}
					{taskDeps}
					milestoneDeps={[]}
					focusMode
					onSelect={(id) => {
						selectedId = id;
						backStack = [];
					}}
				/>
			{:else}
				<Canvas
					tasks={topTasks}
					{allTasks}
					{milestones}
					{statuses}
					{taskDeps}
					{milestoneDeps}
					{showMilestones}
					onSelect={(id) => {
						selectedId = id;
						backStack = [];
					}}
					onMilestoneOpen={(id) => (focusedMilestone = id)}
				/>
			{/if}
		{:else}
			<div class="flow-loading">{$t('Loading…')}</div>
		{/if}
	</div>
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
	.flow-view {
		width: 100%;
		height: calc(100dvh - 220px);
		min-height: 460px;
		display: flex;
		flex-direction: column;
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-box, 0.5rem);
		overflow: hidden;
	}

	.flow-body {
		flex: 1;
		min-height: 0;
	}

	.flow-focus-bar {
		display: flex;
		align-items: center;
		gap: var(--sp-2);
		flex: 0 0 auto;
		padding: var(--sp-1) var(--sp-2);
		border-bottom: 1px solid var(--color-border-subtle);
		background: var(--color-base-100);
	}

	.flow-back {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-field, 0.25rem);
		background: var(--color-bg);
		color: var(--color-fg);
		font-size: 13px;
		padding: 3px 8px;
		cursor: pointer;
		transition:
			background var(--dur-fast) ease,
			border-color var(--dur-fast) ease;
	}

	.flow-back:hover {
		background: var(--color-surface-muted);
		border-color: var(--color-fg);
	}

	.flow-focus-title {
		font-size: 14px;
		font-weight: 600;
		color: var(--color-fg);
	}

	.flow-focus-count {
		font-size: 12px;
		color: var(--color-muted);
		font-variant-numeric: tabular-nums;
	}

	.flow-loading {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 100%;
		color: var(--color-muted);
		font-size: 14px;
	}
</style>
