<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto, invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import { tick } from 'svelte';
	import PriorityIcon from '$lib/components/PriorityIcon.svelte';

	type Task = {
		id: string;
		parentId: string | null;
		title: string;
		statusId: string;
		priority: string;
		assigneeId: string | null;
		position: number;
		dueDate: Date | string | null;
	};
	type Status = { id: string; name: string; category: string };

	let {
		tasks,
		statuses,
		users,
		labels,
		taskLabels,
		canEditTask,
		tableViewId = null
	}: {
		tasks: Task[];
		statuses: Status[];
		users: { id: string; name: string }[];
		labels: { id: string; name: string }[];
		taskLabels: { taskId: string; labelId: string }[];
		canEditTask: (t: Task) => boolean;
		tableViewId?: string | null;
	} = $props();

	let dragId = $state<string | null>(null);
	let over = $state<{ statusId: string; index: number } | null>(null);
	let addingTo = $state<string | null>(null);
	let addInput = $state<HTMLInputElement | null>(null);
	let justDragged = $state(false);

	const glyph: Record<string, string> = { todo: '○', active: '◐', done: '●', canceled: '⊘' };

	const topTasks = $derived(
		tasks
			.filter((t) => !t.parentId)
			.slice()
			.sort((a, b) => a.position - b.position)
	);
	const inColumn = (statusId: string) => topTasks.filter((t) => t.statusId === statusId);
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

	function onCardDragOver(e: DragEvent, statusId: string, index: number) {
		if (!dragId) return;
		e.preventDefault();
		e.stopPropagation();
		const el = e.currentTarget as HTMLElement;
		const before = e.offsetY < el.offsetHeight / 2;
		over = { statusId, index: before ? index : index + 1 };
	}

	function onColumnDragOver(e: DragEvent, statusId: string) {
		if (!dragId) return;
		e.preventDefault();
		over = { statusId, index: inColumn(statusId).length };
	}

	async function onDrop() {
		if (!dragId || !over || !dragged) return;
		const col = inColumn(over.statusId);
		const without = col.filter((t) => t.id !== dragId);
		// translate visual index (includes dragged card) to index in `without`
		let idx = over.index;
		const dragIdx = col.findIndex((t) => t.id === dragId);
		if (dragIdx !== -1 && dragIdx < idx) idx -= 1;
		const before = without[idx]?.id ?? '';

		// no-op move
		if (over.statusId === dragged.statusId && without[idx - 1]?.id !== dragId) {
			const cur = col.findIndex((t) => t.id === dragId);
			if (cur === idx || (before === '' && cur === col.length - 1)) {
				reset();
				return;
			}
		}

		const fd = new FormData();
		fd.set('id', dragId);
		fd.set('statusId', over.statusId);
		fd.set('beforeId', before);
		reset();
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

	async function openAdd(statusId: string) {
		addingTo = statusId;
		await tick();
		addInput?.focus();
	}

	function openDetail(t: Task) {
		if (!tableViewId) return;
		goto(`${page.url.pathname}?view=${tableViewId}&task=${t.id}`);
	}
</script>

<div class="board">
	{#each statuses as s (s.id)}
		{@const col = inColumn(s.id)}
		<div
			class="column"
			class:drop-target={over?.statusId === s.id}
			role="list"
			aria-label="{s.name} column"
			ondragover={(e) => onColumnDragOver(e, s.id)}
			ondrop={onDrop}
		>
			<div class="col-head">
				<span class="col-glyph" class:done={s.category === 'done'}>{glyph[s.category]}</span>
				<span class="col-name">{s.name}</span>
				<span class="col-count">{col.length}</span>
				<span class="col-spacer"></span>
				<button class="col-add" aria-label="Add task to {s.name}" onclick={() => openAdd(s.id)}>
					+
				</button>
			</div>

			<div class="col-body">
				{#each col as t, i (t.id)}
					{@const editable = canEditTask(t)}
					{#if over?.statusId === s.id && over.index === i && dragId !== t.id}
						<div class="drop-line"></div>
					{/if}
					<!-- Whole card is draggable AND clickable; an inner button would block
					     Chrome from initiating drag, so the card itself is the control. -->
					<div
						class="bcard"
						class:dragging={dragId === t.id}
						class:clickable={Boolean(tableViewId)}
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
						ondragover={(e) => onCardDragOver(e, s.id, i)}
						ondrop={onDrop}
						onclick={() => !justDragged && openDetail(t)}
						onkeydown={(e) => e.key === 'Enter' && openDetail(t)}
					>
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
									<span class="avatar" title={userName(t.assigneeId)}>
										{initials(userName(t.assigneeId)!)}
									</span>
								{/if}
							</div>
						{/if}
					</div>
				{/each}
				{#if over?.statusId === s.id && over.index >= col.length}
					<div class="drop-line"></div>
				{/if}

				{#if addingTo === s.id}
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
						<input
							bind:this={addInput}
							name="title"
							class="input"
							placeholder="Task title…"
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

<style>
	.board {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
		gap: var(--sp-2);
		align-items: start;
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

	.bcard {
		border: 1px solid var(--color-border-subtle);
		background: var(--color-bg);
		padding: var(--sp-2);
		transition:
			border-color 0.15s ease,
			opacity 0.15s ease;
	}

	.bcard[draggable='true'] {
		cursor: grab;
	}

	.bcard.clickable:hover {
		border-color: var(--color-fg);
	}

	.bcard.dragging {
		opacity: 0.4;
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
		height: 2px;
		background: var(--color-fg);
		margin: -1px 0;
	}

	.col-add-form .input {
		padding: 6px 8px;
		font-size: 13px;
	}
</style>
