<script lang="ts">
	import {
		SvelteFlow,
		Background,
		Controls,
		MiniMap,
		MarkerType,
		type Node,
		type Edge
	} from '@xyflow/svelte';
	import '@xyflow/svelte/dist/style.css';
	import FlowNode from './FlowNode.svelte';

	type Task = {
		id: string;
		title: string;
		statusId: string;
		milestoneId: string | null;
		parentId: string | null;
	};
	type Status = { id: string; name: string; category: string; color?: string | null };

	let {
		tasks,
		allTasks = [],
		milestones,
		statuses,
		taskDeps,
		milestoneDeps,
		focusMode = false,
		showMilestones = true,
		onSelect,
		onMilestoneOpen
	}: {
		tasks: Task[]; // top-level tasks to chart
		allTasks?: Task[]; // full list incl sub-tasks (for focus-mode expansion)
		milestones: { id: string; name: string }[];
		statuses: Status[];
		taskDeps: { taskId: string; dependsOnId: string }[];
		milestoneDeps: { milestoneId: string; dependsOnId: string }[];
		focusMode?: boolean;
		showMilestones?: boolean;
		onSelect?: (id: string) => void;
		onMilestoneOpen?: (id: string) => void;
	} = $props();

	const nodeTypes = { task: FlowNode, milestone: FlowNode };

	// fallback color per status category when a status has no explicit color
	const CAT_COLOR: Record<string, string> = {
		backlog: '#9ca3af',
		planned: '#6366f1',
		'in-progress': '#f59e0b',
		completed: '#22c55e',
		canceled: '#ef4444'
	};
	function statusColor(id: string): string {
		const s = statuses.find((x) => x.id === id);
		return s?.color || CAT_COLOR[s?.category ?? 'backlog'] || '#9ca3af';
	}

	// focus-mode: parent task ids whose sub-tasks are revealed (default collapsed)
	let expanded = $state.raw<Set<string>>(new Set());
	function toggleExpand(id: string) {
		const next = new Set(expanded);
		next.has(id) ? next.delete(id) : next.add(id);
		expanded = next;
	}
	const subtasksOf = (pid: string) => allTasks.filter((t) => t.parentId === pid);

	function taskData(t: Task, sub = false) {
		const subs = focusMode && !sub ? subtasksOf(t.id) : [];
		return {
			kind: 'task' as const,
			label: t.title,
			color: statusColor(t.statusId),
			sub,
			hasSubs: subs.length > 0,
			expanded: expanded.has(t.id),
			onSelect: () => onSelect?.(t.id),
			onToggle: () => toggleExpand(t.id)
		};
	}

	function build(): { nodes: Node[]; edges: Edge[] } {
		const taskSet = new Set(tasks.map((t) => t.id));
		const nodes: Node[] = [];
		const byId = new Map<string, Node>();
		const add = (n: Node) => {
			nodes.push(n);
			byId.set(n.id, n);
		};
		for (const t of tasks)
			add({ id: `t:${t.id}`, type: 'task', position: { x: 0, y: 0 }, data: taskData(t) });

		const arrow = { type: MarkerType.ArrowClosed, width: 14, height: 14 };
		const edges: Edge[] = [];
		// task → task dependency (prerequisite → dependent) among the charted tasks
		for (const d of taskDeps) {
			if (taskSet.has(d.taskId) && taskSet.has(d.dependsOnId))
				edges.push({
					id: `td:${d.dependsOnId}:${d.taskId}`,
					source: `t:${d.dependsOnId}`,
					target: `t:${d.taskId}`,
					type: 'smoothstep',
					markerEnd: arrow
				});
		}

		// focus-mode: reveal sub-tasks of expanded parents (hierarchy edge parent → sub)
		if (focusMode) {
			for (const t of tasks) {
				if (!expanded.has(t.id)) continue;
				for (const s of subtasksOf(t.id)) {
					add({ id: `t:${s.id}`, type: 'task', position: { x: 0, y: 0 }, data: taskData(s, true) });
					edges.push({
						id: `sub:${t.id}:${s.id}`,
						source: `t:${t.id}`,
						target: `t:${s.id}`,
						type: 'smoothstep',
						style: 'stroke-dasharray:4 4;opacity:0.5'
					});
				}
			}
		}

		// Layout: tasks flow left→right by longest-path dependency depth (NOT bucketed into
		// milestone columns) so a task is free to sit wherever its dependencies place it.
		const incoming = new Map<string, string[]>();
		for (const t of tasks) incoming.set(t.id, []);
		for (const d of taskDeps)
			if (incoming.has(d.taskId) && taskSet.has(d.dependsOnId))
				incoming.get(d.taskId)!.push(d.dependsOnId);
		const memo = new Map<string, number>();
		const visiting = new Set<string>();
		const depth = (id: string): number => {
			const c = memo.get(id);
			if (c !== undefined) return c;
			if (visiting.has(id)) return 0;
			visiting.add(id);
			const preds = incoming.get(id) ?? [];
			const l = preds.length ? 1 + Math.max(...preds.map(depth)) : 0;
			visiting.delete(id);
			memo.set(id, l);
			return l;
		};
		const HGAP = 300;
		const VGAP = 70;
		const SUB_INDENT = 26;
		const SUB_VGAP = 54;
		const cols = new Map<number, Task[]>();
		for (const t of tasks) {
			const d = depth(t.id);
			(cols.get(d) ?? cols.set(d, []).get(d)!).push(t);
		}
		for (const [d, ts] of cols) {
			let y = 0;
			for (const t of ts) {
				const n = byId.get(`t:${t.id}`);
				if (n) n.position = { x: d * HGAP, y };
				y += VGAP;
				if (focusMode && expanded.has(t.id)) {
					for (const s of subtasksOf(t.id)) {
						const sn = byId.get(`t:${s.id}`);
						if (sn) sn.position = { x: d * HGAP + SUB_INDENT, y };
						y += SUB_VGAP;
					}
					y += 12;
				}
			}
		}

		// Milestone overlay (full flow only, toggleable): each milestone is a node in a left
		// lane, linked to its tasks by a dashed membership edge — grouping without confining.
		if (!focusMode && showMilestones) {
			const msIds = new Set(milestones.map((m) => m.id));
			milestones.forEach((m, i) => {
				add({
					id: `m:${m.id}`,
					type: 'milestone',
					position: { x: -HGAP, y: i * VGAP },
					data: { kind: 'milestone', label: m.name, onOpen: () => onMilestoneOpen?.(m.id) }
				});
			});
			for (const d of milestoneDeps) {
				if (msIds.has(d.milestoneId) && msIds.has(d.dependsOnId))
					edges.push({
						id: `md:${d.dependsOnId}:${d.milestoneId}`,
						source: `m:${d.dependsOnId}`,
						target: `m:${d.milestoneId}`,
						type: 'smoothstep',
						markerEnd: arrow,
						style: 'stroke-width:2'
					});
			}
			for (const t of tasks) {
				if (t.milestoneId && msIds.has(t.milestoneId))
					edges.push({
						id: `tm:${t.milestoneId}:${t.id}`,
						source: `m:${t.milestoneId}`,
						target: `t:${t.id}`,
						type: 'smoothstep',
						style: 'stroke-dasharray:4 4;opacity:0.35'
					});
			}
		}

		return { nodes, edges };
	}

	const initial = build();
	let nodes = $state.raw<Node[]>(initial.nodes);
	let edges = $state.raw<Edge[]>(initial.edges);

	// rebuild when inputs OR the expand/milestone toggles change (resets manual drags)
	$effect(() => {
		void tasks;
		void allTasks;
		void milestones;
		void statuses;
		void taskDeps;
		void milestoneDeps;
		void focusMode;
		void showMilestones;
		void expanded;
		const g = build();
		nodes = g.nodes;
		edges = g.edges;
	});

	const colorMode: 'light' | 'dark' =
		typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark'
			? 'dark'
			: 'light';

	const empty = $derived(
		tasks.length === 0 && (focusMode || !showMilestones || milestones.length === 0)
	);

	// Hide the MiniMap on phones — it wastes scarce space (kept for wider screens).
	let vw = $state(typeof window !== 'undefined' ? window.innerWidth : 1200);
	$effect(() => {
		if (typeof window === 'undefined') return;
		const onResize = () => (vw = window.innerWidth);
		window.addEventListener('resize', onResize);
		return () => window.removeEventListener('resize', onResize);
	});
	const narrow = $derived(vw <= 720);
</script>

{#if empty}
	<div class="flow-empty">No tasks to chart here yet.</div>
{:else}
	<div class="flow-canvas">
		<SvelteFlow
			bind:nodes
			bind:edges
			{nodeTypes}
			{colorMode}
			fitView
			nodesConnectable={false}
			minZoom={0.2}
		>
			<Background />
			<Controls />
			{#if !narrow}
				<MiniMap pannable zoomable height={96} />
			{/if}
		</SvelteFlow>
	</div>
{/if}

<style>
	.flow-canvas {
		width: 100%;
		height: 100%;
		min-height: 0;
	}

	.flow-empty {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 100%;
		color: var(--color-muted);
		font-size: 14px;
	}

	@media (max-width: 720px) {
		/* MiniMap is not rendered on phones; also hide it defensively + enlarge Controls
		   (Svelte Flow renders global DOM) */
		:global(.svelte-flow__minimap) {
			display: none;
		}

		:global(.svelte-flow__controls-button) {
			width: 40px;
			height: 40px;
		}

		.flow-canvas {
			max-height: calc(100dvh - 100px);
		}
	}
</style>
