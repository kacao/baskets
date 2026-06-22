<script lang="ts">
	import { tick } from 'svelte';
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { invalidateAll } from '$app/navigation';
	import SidePane from '$lib/components/SidePane.svelte';
	import StatusSelect from '$lib/components/StatusSelect.svelte';
	import PriorityBadge from '$lib/components/PriorityBadge.svelte';
	import PriorityIcon from '$lib/components/PriorityIcon.svelte';
	import Popover from '$lib/components/Popover.svelte';
	import CustomFieldValue from '$lib/components/CustomFieldValue.svelte';
	import TaskComments from '$lib/components/TaskComments.svelte';
	import TaskAttachments from '$lib/components/TaskAttachments.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import LabelChip from '$lib/components/LabelChip.svelte';
	import { tooltip } from '$lib/tooltip';
	import { fieldAppliesTo, computeTaskRollup, formatNumber, buildTaskCfSearch, decodeValue, encodeIds, type RollupConfig } from '$lib/customFields';
	import { describeRecurrence } from '$lib/recurrence';
	import { confirmDialog } from '$lib/confirm.svelte';
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
		startDate?: Date | string | null;
		dueDate: Date | string | null;
		recurrence?: string | null;
		coverFileId?: string | null;
	};
	type Status = { id: string; name: string; category: string };
	type Location = { id: string; title: string; address: string | null; latitude: number | null; longitude: number | null };

	let {
		task,
		tasks,
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
		canEditTask,
		onClose,
		onSelectTask,
		statusDisplay = 'text',
		templates = []
	}: {
		task: Task;
		tasks: Task[];
		users: { id: string; name: string }[];
		statuses: Status[];
		milestones: { id: string; name: string }[];
		locations: Location[];
		labels: { id: string; name: string; color?: string | null; icon?: string | null }[];
		taskLabels: { taskId: string; labelId: string }[];
		taskDeps: { taskId: string; dependsOnId: string }[];
		customFields?: { id: string; name: string; type: string; config: Record<string, unknown>; appliesTo?: string }[];
		customFieldOptions?: { id: string; fieldId: string; title: string; color: string | null; icon: string | null }[];
		taskCustomValues?: { taskId: string; fieldId: string; value: string }[];
		files?: { id: string; taskId: string | null; fieldId: string | null; filename: string; mimeType: string; size: number }[];
		canEditTask: (t: { id: string; parentId: string | null }) => boolean;
		onClose: () => void;
		onSelectTask?: (id: string) => void;
		statusDisplay?: 'text' | 'icon' | 'text-icon';
		templates?: { id: string; name: string }[];
	} = $props();

	const parent = $derived(task.parentId ? (tasks.find((t) => t.id === task.parentId) ?? null) : null);

	const PRIORITIES = ['none', 'low', 'medium', 'high', 'urgent'] as const;

	const editable = $derived(canEditTask(task));
	const subs = $derived(tasks.filter((t) => t.parentId === task.id));

	// Save-as-template footer control: a button that morphs into a search field.
	// Typing filters the project's templates; clicking a result overwrites that
	// template with this task; the check creates a new template named by the query.
	let savingTpl = $state(false);
	let tplQuery = $state('');
	let tplTargetId = $state(''); // '' = create new; else overwrite this template id
	let tplForm = $state<HTMLFormElement | null>(null);
	const matchTemplates = $derived(
		templates.filter((t) => t.name.toLowerCase().includes(tplQuery.trim().toLowerCase()))
	);
	function openSaveTpl() {
		tplQuery = task.title;
		tplTargetId = '';
		savingTpl = true;
	}
	async function submitTpl(templateId: string) {
		// nothing to create when the query is blank and we're not targeting a template
		if (!templateId && !tplQuery.trim()) return;
		tplTargetId = templateId;
		await tick();
		tplForm?.requestSubmit();
	}
	const cat = (id: string) => statuses.find((s) => s.id === id)?.category ?? 'backlog';
	const labelsOf = (taskId: string) =>
		taskLabels
			.filter((l) => l.taskId === taskId)
			.map((l) => labels.find((x) => x.id === l.labelId))
			.filter(Boolean);
	const deps = $derived(
		taskDeps
			.filter((d) => d.taskId === task.id)
			.map((d) => tasks.find((t) => t.id === d.dependsOnId))
			.filter(Boolean)
	);
	// reverse direction: tasks that list THIS task as a blocker (this task is blocking them)
	const blocking = $derived(
		taskDeps
			.filter((d) => d.dependsOnId === task.id)
			.map((d) => tasks.find((t) => t.id === d.taskId))
			.filter(Boolean)
	);
	const userName = (id: string | null) => users.find((u) => u.id === id)?.name ?? null;
	const milestoneName = (id: string | null) => milestones.find((m) => m.id === id)?.name ?? null;
	const locationTitle = (id: string | null) => locations.find((l) => l.id === id)?.title ?? null;

	// only fields that apply to this task's level (top-level vs sub-task)
	const visibleCustomFields = $derived(customFields.filter((f) => fieldAppliesTo(f, !!task.parentId)));
	const cfValue = (fieldId: string) =>
		taskCustomValues.find((v) => v.taskId === task.id && v.fieldId === fieldId)?.value ?? null;
	const cfOptions = (fieldId: string) => customFieldOptions.filter((o) => o.fieldId === fieldId);

	// per-task cf search text so the `task`-cf link picker searches by cf values too
	const cfSearchByTask = $derived(
		buildTaskCfSearch(customFields, taskCustomValues, {
			option: (id) => customFieldOptions.find((o) => o.id === id)?.title ?? '',
			user: (id) => users.find((u) => u.id === id)?.name ?? '',
			location: (id) => locations.find((l) => l.id === id)?.title ?? '',
			task: (id) => tasks.find((t) => t.id === id)?.title ?? '',
			file: (id) => files.find((f) => f.id === id)?.filename ?? ''
		})
	);
	const taskCfSearch = (id: string) => cfSearchByTask.get(id) ?? '';

	// A `task`-type custom field renders as a collapsible sub-task-style list of its
	// linked tasks (same block UI + editable pills). Membership edits post the cf
	// value (cf_<id>) to patchTask, like CustomFieldValue does.
	let cfCollapsed = $state<Record<string, boolean>>({});
	let cfAddQuery = $state('');
	const cfIds = (field: { id: string; type: string }): string[] => {
		const d = decodeValue(field, cfValue(field.id));
		return Array.isArray(d) ? (d as string[]) : [];
	};
	const cfLinked = (field: { id: string; type: string }): Task[] =>
		cfIds(field)
			.map((id) => tasks.find((t) => t.id === id))
			.filter((t): t is Task => !!t);
	const cfRemoveVal = (ids: string[], id: string) => {
		const next = ids.filter((x) => x !== id);
		return next.length ? encodeIds(next) : '';
	};
	const cfAddVal = (ids: string[], id: string, multi: boolean) =>
		encodeIds(multi ? [...ids, id] : [id]);
	const cfAddCandidates = (ids: string[]): Task[] => {
		const q = cfAddQuery.trim().toLowerCase();
		return tasks.filter(
			(t) => t.id !== task.id && !ids.includes(t.id) && (!q || t.title.toLowerCase().includes(q))
		);
	};

	// Rollup fields are computed (aggregate a target field over related tasks).
	function rollupText(field: { type: string; config: Record<string, unknown> }): string | null {
		if (field.type !== 'rollup') return null;
		const cfg = field.config as unknown as RollupConfig;
		const valueOf = (tid: string, fid: string) => {
			const raw = taskCustomValues.find((x) => x.taskId === tid && x.fieldId === fid)?.value;
			const n = raw == null ? null : Number(raw);
			return n != null && Number.isFinite(n) ? n : null;
		};
		const n = computeTaskRollup(cfg, task.id, { tasks, taskDeps, valueOf });
		const target = customFields.find((f) => f.id === cfg.targetFieldId);
		return target && cfg.formula !== 'count' ? formatNumber(n, target.config) : String(n);
	}
	const taskFiles = $derived(files.filter((f) => f.taskId === task.id));

	function fmtDate(d: Date | string | null) {
		if (!d) return null;
		return new Date(d).toISOString().slice(0, 10);
	}

	// search queries for the milestone / location / blocker popovers
	let mQuery = $state('');
	let locQuery = $state('');
	let depQuery = $state('');
	const matches = (hay: string, q: string) => hay.toLowerCase().includes(q.trim().toLowerCase());
	const mFiltered = $derived(milestones.filter((m) => matches(m.name, mQuery)));
	const locFiltered = $derived(
		locations.filter((l) => matches(`${l.title} ${l.address ?? ''}`, locQuery))
	);
	const depFiltered = $derived(
		tasks.filter(
			(x) =>
				!x.parentId &&
				x.id !== task.id &&
				!deps.some((d) => d!.id === x.id) &&
				matches(x.title, depQuery)
		)
	);
	// candidates that can BECOME a sub-task of this task: top-level, not self, and
	// childless (depth-1 — a task with its own sub-tasks can't be nested)
	let subQuery = $state('');
	const subCandidates = $derived(
		tasks.filter(
			(x) =>
				!x.parentId &&
				x.id !== task.id &&
				!tasks.some((c) => c.parentId === x.id) &&
				matches(x.title, subQuery)
		)
	);

	// move THIS sub-task to a different parent: top-level tasks except self + current parent
	let parentQuery = $state('');
	const parentChoices = $derived(
		tasks.filter(
			(x) => !x.parentId && x.id !== task.id && x.id !== task.parentId && matches(x.title, parentQuery)
		)
	);

	// --- sub-task multi-select + bulk edit ---
	let subSel = $state<string[]>([]);
	$effect(() => {
		task.id; // reset selection + parent search when the open task changes
		subSel = [];
		parentQuery = '';
	});
	const subChecked = (id: string) => subSel.includes(id);
	function toggleSub(id: string) {
		subSel = subSel.includes(id) ? subSel.filter((x) => x !== id) : [...subSel, id];
	}
	let subBusy = $state(false);
	let moveQuery = $state('');
	// move targets: any top-level task except this one (selected subs re-parent under it)
	const moveTargets = $derived(
		tasks.filter((x) => !x.parentId && x.id !== task.id && matches(x.title, moveQuery))
	);
	async function bulkSub(fields: Record<string, string>, close?: () => void) {
		if (!subSel.length) return;
		subBusy = true;
		const fd = new FormData();
		for (const id of subSel) fd.append('ids', id);
		for (const [k, v] of Object.entries(fields)) fd.set(k, v);
		await fetch(`${page.url.pathname}?/bulkPatchTasks`, { method: 'POST', body: fd });
		await invalidateAll();
		subBusy = false;
		close?.();
		subSel = [];
	}
	async function bulkSubMoveNew(title: string, close?: () => void) {
		if (!subSel.length || !title.trim()) return;
		subBusy = true;
		const fd = new FormData();
		for (const id of subSel) fd.append('ids', id);
		fd.set('title', title.trim());
		await fetch(`${page.url.pathname}?/bulkReparentToNew`, { method: 'POST', body: fd });
		await invalidateAll();
		subBusy = false;
		moveQuery = '';
		close?.();
		subSel = [];
	}
	async function bulkSubDelete() {
		if (!subSel.length) return;
		if (!(await confirmDialog($t('Delete the selected sub-tasks?'), { confirmLabel: $t('Delete'), danger: true })))
			return;
		subBusy = true;
		const fd = new FormData();
		for (const id of subSel) fd.append('ids', id);
		await fetch(`${page.url.pathname}?/bulkDeleteTasks`, { method: 'POST', body: fd });
		await invalidateAll();
		subBusy = false;
		subSel = [];
	}

	// order stepper: − / + mutate the live input (clamped ≥ 0)
	let orderInput = $state<HTMLInputElement | null>(null);
	function bumpOrder(d: number) {
		if (!orderInput) return;
		orderInput.value = String(Math.max(0, (Number(orderInput.value) || 0) + d));
	}

	// close the popover immediately, then invalidate when the action returns
	const pick = (close: () => void) => () => {
		close();
		return async ({ update }: { update: () => Promise<void> }) => update();
	};
</script>

<SidePane {onClose} title={$t('Task details')} ariaLabel={$t('Task details')}>
	{#if parent}
		<button class="parent-link" type="button" onclick={() => onSelectTask?.(parent.id)}>
			<Icon name="nav-arrow-left" size={12} /> {parent.title}
		</button>
	{/if}
	{#if editable}
		<!-- Title — full width, auto-save on blur -->
		<form method="POST" action="?/patchTask" use:enhance class="field">
			<input type="hidden" name="id" value={task.id} />
			<input
				name="title"
				class="input title-input"
				value={task.title}
				required
				maxlength="240"
				aria-label={$t('Title')}
				onblur={(e) => e.currentTarget.form?.requestSubmit()}
			/>
		</form>

		<!-- Pills -->
		<div class="pills-row">
			<!-- Status -->
			<StatusSelect taskId={task.id} statusId={task.statusId} {statuses} canEdit={editable} display={statusDisplay} />

			<!-- Parent (sub-tasks only): move to another task or make top-level -->
			{#if task.parentId}
				<Popover ariaLabel={$t('Parent')}>
					{#snippet trigger()}
						<span class="pill-val">{parent?.title ?? $t('Parent')}</span>
					{/snippet}
					{#snippet panel(close)}
						<!-- svelte-ignore a11y_autofocus -->
						<input class="pop-search" placeholder={$t('Move to task…')} bind:value={parentQuery} autofocus />
						<form method="POST" action="?/patchTask" use:enhance={pick(close)}>
							<input type="hidden" name="id" value={task.id} />
							<input type="hidden" name="parentId" value="" />
							<button class="opt" type="submit">{$t('No parent (make top-level)')}</button>
						</form>
						{#each parentChoices as p (p.id)}
							<form method="POST" action="?/patchTask" use:enhance={pick(close)}>
								<input type="hidden" name="id" value={task.id} />
								<input type="hidden" name="parentId" value={p.id} />
								<button class="opt" type="submit">{p.title}</button>
							</form>
						{/each}
					{/snippet}
				</Popover>
			{/if}

			<!-- Priority -->
			<Popover ariaLabel={$t('Priority')}>
				{#snippet trigger()}
					<PriorityBadge priority={task.priority} />
					{#if task.priority === 'none'}<span class="pill-ph">{$t('Priority')}</span>{/if}
				{/snippet}
				{#snippet panel(close)}
					{#each PRIORITIES as p (p)}
						<form method="POST" action="?/patchTask" use:enhance={pick(close)}>
							<input type="hidden" name="id" value={task.id} />
							<input type="hidden" name="priority" value={p} />
							<button class="opt" class:opt--on={task.priority === p} type="submit">
								<PriorityIcon priority={p} /> {$t(p)}
							</button>
						</form>
					{/each}
				{/snippet}
			</Popover>

			<!-- Assignee -->
			<Popover ariaLabel={$t('Assignee')}>
				{#snippet trigger()}
					<span class="pill-val" class:pill-ph={!task.assigneeId}
						>{userName(task.assigneeId) ?? $t('Assignee')}</span
					>
				{/snippet}
				{#snippet panel(close)}
					<form method="POST" action="?/patchTask" use:enhance={pick(close)}>
						<input type="hidden" name="id" value={task.id} />
						<input type="hidden" name="assigneeId" value="" />
						<button class="opt" class:opt--on={!task.assigneeId} type="submit">{$t('Unassigned')}</button>
					</form>
					{#each users as u (u.id)}
						<form method="POST" action="?/patchTask" use:enhance={pick(close)}>
							<input type="hidden" name="id" value={task.id} />
							<input type="hidden" name="assigneeId" value={u.id} />
							<button class="opt" class:opt--on={task.assigneeId === u.id} type="submit">{u.name}</button>
						</form>
					{/each}
				{/snippet}
			</Popover>

			<!-- Milestone (search + create) -->
			<Popover ariaLabel={$t('Milestone')}>
				{#snippet trigger()}
					<span class="pill-val" class:pill-ph={!task.milestoneId}
						>{milestoneName(task.milestoneId) ?? $t('Milestone')}</span
					>
				{/snippet}
				{#snippet panel(close)}
					<!-- svelte-ignore a11y_autofocus -->
					<input class="pop-search" placeholder={$t('Search or create…')} bind:value={mQuery} autofocus />
					<form method="POST" action="?/patchTask" use:enhance={pick(close)}>
						<input type="hidden" name="id" value={task.id} />
						<input type="hidden" name="milestoneId" value="" />
						<button class="opt" class:opt--on={!task.milestoneId} type="submit">{$t('No milestone')}</button>
					</form>
					{#each mFiltered as m (m.id)}
						<form method="POST" action="?/patchTask" use:enhance={pick(close)}>
							<input type="hidden" name="id" value={task.id} />
							<input type="hidden" name="milestoneId" value={m.id} />
							<button class="opt" class:opt--on={task.milestoneId === m.id} type="submit">{m.name}</button>
						</form>
					{/each}
					{#if mQuery.trim() && mFiltered.length === 0}
						<form
							method="POST"
							action="?/createMilestone"
							use:enhance={() => async ({ update }) => {
								close();
								mQuery = '';
								update();
							}}
						>
							<input type="hidden" name="taskId" value={task.id} />
							<input type="hidden" name="name" value={mQuery.trim()} />
							<button class="opt opt--create" type="submit">{$t('Create')} “{mQuery.trim()}”</button>
						</form>
					{/if}
				{/snippet}
			</Popover>

			<!-- Order -->
			<Popover ariaLabel={$t('Order')}>
				{#snippet trigger()}
					{#if task.order !== null}
						<span class="pill-val ord">#{task.order}</span>
					{:else}
						<span class="pill-val pill-ph">{$t('Order')}</span>
					{/if}
				{/snippet}
				{#snippet panel(close)}
					<form method="POST" action="?/patchTask" use:enhance={pick(close)} class="pop-order">
						<input type="hidden" name="id" value={task.id} />
						<span class="pop-label">{$t('Order')}</span>
						<div class="stepper">
							<button type="button" class="step-btn" aria-label={$t('Decrease')} onclick={() => bumpOrder(-1)}>−</button>
							<input
								bind:this={orderInput}
								name="order"
								type="number"
								step="1"
								min="0"
								class="step-input"
								placeholder="—"
								value={task.order ?? ''}
							/>
							<button type="button" class="step-btn" aria-label={$t('Increase')} onclick={() => bumpOrder(1)}>+</button>
						</div>
						<div class="pop-actions">
							<button type="submit" class="btn btn-sm btn-ghost" onclick={() => orderInput && (orderInput.value = '')}>
								{$t('Clear')}
							</button>
							<button class="btn btn-sm btn-primary" type="submit">{$t('Save')}</button>
						</div>
					</form>
				{/snippet}
			</Popover>

			<!-- Location (search + create) -->
			<Popover ariaLabel={$t('Location')}>
				{#snippet trigger()}
					<span class="pill-val" class:pill-ph={!task.locationId}
						>{locationTitle(task.locationId) ?? $t('Location')}</span
					>
				{/snippet}
				{#snippet panel(close)}
					<!-- svelte-ignore a11y_autofocus -->
					<input class="pop-search" placeholder={$t('Search or create…')} bind:value={locQuery} autofocus />
					<form method="POST" action="?/patchTask" use:enhance={pick(close)}>
						<input type="hidden" name="id" value={task.id} />
						<input type="hidden" name="locationId" value="" />
						<button class="opt" class:opt--on={!task.locationId} type="submit">{$t('No location')}</button>
					</form>
					{#each locFiltered as l (l.id)}
						<form method="POST" action="?/patchTask" use:enhance={pick(close)}>
							<input type="hidden" name="id" value={task.id} />
							<input type="hidden" name="locationId" value={l.id} />
							<button class="opt opt--stack" class:opt--on={task.locationId === l.id} type="submit">
								<span class="opt-title">{l.title}</span>
								{#if l.address}<span class="opt-sub">{l.address}</span>{/if}
							</button>
						</form>
					{/each}
					{#if locQuery.trim() && locFiltered.length === 0}
						<form
							method="POST"
							action="?/createLocation"
							use:enhance={() => async ({ update }) => {
								close();
								locQuery = '';
								update();
							}}
						>
							<input type="hidden" name="taskId" value={task.id} />
							<input type="hidden" name="title" value={locQuery.trim()} />
							<button class="opt opt--create" type="submit">{$t('Create')} “{locQuery.trim()}”</button>
						</form>
					{/if}
				{/snippet}
			</Popover>

			<!-- Blocked by (multi) -->
			<Popover ariaLabel={$t('Blocked by')}>
				{#snippet trigger()}
					<span class="pill-val" class:pill-ph={deps.length === 0}
						>{$t('Blocked by')}{#if deps.length > 0}&nbsp;· {deps.length}{/if}</span
					>
				{/snippet}
				{#snippet panel()}
					{#each deps as d (d!.id)}
						<form method="POST" action="?/removeTaskDep" use:enhance={() => async ({ update }) => update()}>
							<input type="hidden" name="taskId" value={task.id} />
							<input type="hidden" name="dependsOnId" value={d!.id} />
							<button class="opt opt--on" type="submit" use:tooltip={$t('Remove dependency')}>{d!.title} ×</button>
						</form>
					{:else}
						<span class="opt-empty">{$t('none')}</span>
					{/each}
					<!-- svelte-ignore a11y_autofocus -->
					<input class="pop-search" placeholder={$t('Add a blocker…')} bind:value={depQuery} autofocus />
					{#each depFiltered as opt (opt.id)}
						<form
							method="POST"
							action="?/addTaskDep"
							use:enhance={() => async ({ update }) => {
								depQuery = '';
								update();
							}}
						>
							<input type="hidden" name="taskId" value={task.id} />
							<input type="hidden" name="dependsOnId" value={opt.id} />
							<button class="opt" type="submit">{opt.title}</button>
						</form>
					{/each}
				{/snippet}
			</Popover>

			<!-- Start date -->
			<Popover ariaLabel={$t('Start date')} align="right">
				{#snippet trigger()}
					<span class="pill-val mono" class:pill-ph={!task.startDate}>{fmtDate(task.startDate ?? null) ?? $t('Start date')}</span>
				{/snippet}
				{#snippet panel(close)}
					<form method="POST" action="?/patchTask" use:enhance={pick(close)} class="pop-due">
						<input type="hidden" name="id" value={task.id} />
						<input
							name="startDate"
							type="date"
							class="input"
							value={fmtDate(task.startDate ?? null) ?? ''}
							onchange={(e) => e.currentTarget.form?.requestSubmit()}
						/>
						<button
							class="opt opt--create"
							type="submit"
							onclick={(e) => {
								const input = e.currentTarget.form?.elements.namedItem('startDate');
								if (input instanceof HTMLInputElement) input.value = '';
							}}>{$t('Clear')}</button
						>
					</form>
				{/snippet}
			</Popover>

			<!-- Due date -->
			<Popover ariaLabel={$t('Due date')} align="right">
				{#snippet trigger()}
					<span class="pill-val mono" class:pill-ph={!task.dueDate}>{fmtDate(task.dueDate) ?? $t('Due date')}</span>
				{/snippet}
				{#snippet panel(close)}
					<form method="POST" action="?/patchTask" use:enhance={pick(close)} class="pop-due">
						<input type="hidden" name="id" value={task.id} />
						<input
							name="dueDate"
							type="date"
							class="input"
							value={fmtDate(task.dueDate) ?? ''}
							onchange={(e) => e.currentTarget.form?.requestSubmit()}
						/>
						<button
							class="opt opt--create"
							type="submit"
							onclick={(e) => {
								const input = e.currentTarget.form?.elements.namedItem('dueDate');
								if (input instanceof HTMLInputElement) input.value = '';
							}}>{$t('Clear')}</button
						>
					</form>
				{/snippet}
			</Popover>

			<!-- Recurrence -->
			<Popover ariaLabel={$t('Recurrence')}>
				{#snippet trigger()}
					<span class="pill-val" class:pill-ph={!task.recurrence}>
						{describeRecurrence(task.recurrence) ?? $t('Repeat')}
					</span>
				{/snippet}
				{#snippet panel()}
					<form method="POST" action="?/patchTask" use:enhance class="pop-recur">
						<input type="hidden" name="id" value={task.id} />
						<select
							name="recurrence"
							class="input"
							value={task.recurrence ?? ''}
							onchange={(e) => e.currentTarget.form?.requestSubmit()}
						>
							<option value="">{$t('Does not repeat')}</option>
							<option value="daily:1">{$t('Every day')}</option>
							<option value="weekly:1">{$t('Every week')}</option>
							<option value="weekly:2">{$t('Every 2 weeks')}</option>
							<option value="monthly:1">{$t('Every month')}</option>
							<option value="yearly:1">{$t('Every year')}</option>
						</select>
					</form>
				{/snippet}
			</Popover>
		</div>

		<!-- Description — full width, auto-save on blur. reset:false: a <textarea>'s
		     value comes from child text, so the default form.reset() would revert it
		     to an empty defaultValue on a client-rendered pane (wiping the text). -->
		<form
			method="POST"
			action="?/patchTask"
			use:enhance={() => async ({ update }) => update({ reset: false })}
			class="field"
		>
			<input type="hidden" name="id" value={task.id} />
			<textarea
				name="description"
				class="textarea"
				rows="5"
				placeholder={$t('Add a description…')}
				aria-label={$t('Description')}
				onblur={(e) => e.currentTarget.form?.requestSubmit()}>{task.description ?? ''}</textarea
			>
		</form>

	{:else}
		<h3 style="margin-bottom: var(--sp-2); overflow-wrap: anywhere;">{task.title}</h3>
		{#if task.description}
			<p class="u-small" style="margin-bottom: var(--sp-3); white-space: pre-wrap;">
				{task.description}
			</p>
		{/if}
		<div class="chips-row">
			<StatusSelect taskId={task.id} statusId={task.statusId} {statuses} canEdit={false} display={statusDisplay} />
			<PriorityBadge priority={task.priority} />
			{#if userName(task.assigneeId)}
				<span class="badge badge-neutral">{userName(task.assigneeId)}</span>
			{/if}
			{#if milestoneName(task.milestoneId)}
				<span class="badge">{milestoneName(task.milestoneId)}</span>
			{/if}
			{#if locationTitle(task.locationId)}
				<span class="badge">{locationTitle(task.locationId)}</span>
			{/if}
			{#if task.dueDate}
				<span class="badge mono">{fmtDate(task.dueDate)}</span>
			{/if}
		</div>
		{#if deps.length > 0}
			<div class="section">
				<span class="label">{$t('Blocked by')}</span>
				<div class="chips-row">
					{#each deps as d (d!.id)}
						<span class="badge">{d!.title}</span>
					{/each}
				</div>
			</div>
		{/if}
		{#if blocking.length > 0}
			<div class="section">
				<span class="label">{$t('Blocking')}</span>
				<div class="chips-row">
					{#each blocking as d (d!.id)}
						<span class="badge">{d!.title}</span>
					{/each}
				</div>
			</div>
		{/if}
	{/if}

	{#if visibleCustomFields.length > 0}
		<div class="section" style="display: flex; flex-direction: column; gap: 8px;">
			{#each visibleCustomFields as f (f.id)}
				{#if f.type === 'task'}
					{@render taskCfList(f)}
				{:else}
					<CustomFieldValue
						field={f}
						options={cfOptions(f.id)}
						value={cfValue(f.id)}
						rollupText={rollupText(f)}
						mode="pill"
						taskId={task.id}
						{users}
						{locations}
						{tasks}
						taskSearch={taskCfSearch}
						files={taskFiles}
						canEdit={editable}
					/>
				{/if}
			{/each}
		</div>
	{/if}

	<div class="section">
		<TaskAttachments taskId={task.id} {files} coverFileId={task.coverFileId ?? null} canEdit={editable} />
	</div>

	{#if editable && labels.length > 0}
		<div class="section">
			<span class="label">{$t('Labels')}</span>
			<div class="chips-row">
				{#each labels as l (l.id)}
					{@const active = labelsOf(task.id).some((x) => x!.id === l.id)}
					<form method="POST" action="?/toggleTaskLabel" use:enhance>
						<input type="hidden" name="taskId" value={task.id} />
						<input type="hidden" name="labelId" value={l.id} />
						<button class="chip" class:chip--on={active} type="submit">{l.name}</button>
					</form>
				{/each}
			</div>
		</div>
	{:else if labelsOf(task.id).length > 0}
		<div class="section">
			<span class="label">{$t('Labels')}</span>
			<div class="chips-row">
				{#each labelsOf(task.id) as l (l!.id)}
					<LabelChip label={l!} />
				{/each}
			</div>
		</div>
	{/if}

	{#if !task.parentId}
		<div class="section">
			<span class="label">{$t('Sub-tasks')}</span>
			{#if subSel.length > 0 && editable}
				<div class="sub-bulk">
					<span class="sub-bulk-count">{$t('{n} selected', { n: subSel.length })}</span>
					<!-- Move: re-parent under an existing task, or create one -->
					<Popover ariaLabel={$t('Move')}>
						{#snippet trigger()}
							<span class="pill-val"><Icon name="data-transfer-both" size={12} /> {$t('Move')}</span>
						{/snippet}
						{#snippet panel(close)}
							<!-- svelte-ignore a11y_autofocus -->
							<input class="pop-search" placeholder={$t('Search or create…')} bind:value={moveQuery} autofocus />
							<button class="opt opt--create" type="button" disabled={subBusy} onclick={() => bulkSub({ parentId: '' }, close)}>
								<Icon name="arrow-up-right-square" size={12} /> {$t('Make into tasks (no parent)')}
							</button>
							{#each moveTargets as m (m.id)}
								<button class="opt" type="button" disabled={subBusy} onclick={() => bulkSub({ parentId: m.id }, close)}>{m.title}</button>
							{/each}
							{#if moveQuery.trim()}
								<button class="opt opt--create" type="button" disabled={subBusy} onclick={() => bulkSubMoveNew(moveQuery, close)}>{$t('Create task')} “{moveQuery.trim()}”</button>
							{:else if moveTargets.length === 0}
								<span class="opt-empty">{$t('Type to search or create a task')}</span>
							{/if}
						{/snippet}
					</Popover>
					<!-- Status -->
					<Popover ariaLabel={$t('Set status')}>
						{#snippet trigger()}<span class="pill-val"><Icon name="circle" size={12} /> {$t('Status')}</span>{/snippet}
						{#snippet panel(close)}
							{#each statuses as s (s.id)}
								<button class="opt" type="button" disabled={subBusy} onclick={() => bulkSub({ statusId: s.id }, close)}>{s.name}</button>
							{/each}
						{/snippet}
					</Popover>
					<!-- Assignee -->
					<Popover ariaLabel={$t('Set assignee')}>
						{#snippet trigger()}<span class="pill-val"><Icon name="user" size={12} /> {$t('Assignee')}</span>{/snippet}
						{#snippet panel(close)}
							<button class="opt" type="button" disabled={subBusy} onclick={() => bulkSub({ assigneeId: '' }, close)}>{$t('Unassigned')}</button>
							{#each users as u (u.id)}
								<button class="opt" type="button" disabled={subBusy} onclick={() => bulkSub({ assigneeId: u.id }, close)}>{u.name}</button>
							{/each}
						{/snippet}
					</Popover>
					<!-- Milestone -->
					<Popover ariaLabel={$t('Set milestone')}>
						{#snippet trigger()}<span class="pill-val"><Icon name="bookmark" size={12} /> {$t('Milestone')}</span>{/snippet}
						{#snippet panel(close)}
							<button class="opt" type="button" disabled={subBusy} onclick={() => bulkSub({ milestoneId: '' }, close)}>{$t('No milestone')}</button>
							{#each milestones as m (m.id)}
								<button class="opt" type="button" disabled={subBusy} onclick={() => bulkSub({ milestoneId: m.id }, close)}>{m.name}</button>
							{/each}
						{/snippet}
					</Popover>
					<!-- Priority -->
					<Popover ariaLabel={$t('Set priority')}>
						{#snippet trigger()}<span class="pill-val"><Icon name="priority-high" size={12} /> {$t('Priority')}</span>{/snippet}
						{#snippet panel(close)}
							{#each PRIORITIES as p (p)}
								<button class="opt" type="button" disabled={subBusy} onclick={() => bulkSub({ priority: p }, close)}><PriorityIcon priority={p} /> {$t(p)}</button>
							{/each}
						{/snippet}
					</Popover>
					<button class="sub-bulk-del" type="button" disabled={subBusy} onclick={bulkSubDelete}><Icon name="trash" size={12} /> {$t('Delete')}</button>
					<button class="sub-bulk-clear" type="button" aria-label={$t('Clear selection')} onclick={() => (subSel = [])}><Icon name="xmark" size={12} /></button>
				</div>
			{/if}
			{#if subs.length > 0}
				<div class="sub-list">
					{#each subs as s (s.id)}
						{@const sEdit = canEditTask(s)}
						<div class="sub-item" class:is-done={cat(s.statusId) === 'completed'} class:sub-item--sel={subChecked(s.id)}>
							<div class="sub-head">
								{#if sEdit}
									<input
										class="sub-check"
										type="checkbox"
										aria-label={$t('Select sub-task')}
										checked={subChecked(s.id)}
										onclick={() => toggleSub(s.id)}
									/>
								{/if}
								<button class="sub-title-btn" type="button" onclick={() => onSelectTask?.(s.id)}>{s.title}</button>
								<span class="spacer"></span>
								{#if sEdit}
									<div class="sub-actions">
										<!-- promote: detach from this parent → becomes a top-level task -->
										<form method="POST" action="?/patchTask" use:enhance>
											<input type="hidden" name="id" value={s.id} />
											<input type="hidden" name="parentId" value="" />
											<button
												class="sub-act"
												type="submit"
												aria-label={$t('Make into task')}
												use:tooltip={$t('Make into task')}
											>
												<Icon name="arrow-up-right-square" size={14} />
											</button>
										</form>
										<!-- delete -->
										<form method="POST" action="?/deleteTask" use:enhance>
											<input type="hidden" name="id" value={s.id} />
											<button
												class="sub-act sub-act--del"
												type="button"
												aria-label={$t('Delete sub-task')}
												use:tooltip={$t('Delete sub-task')}
												onclick={async (e) => {
													const form = e.currentTarget.form;
													if (await confirmDialog($t('Delete this sub-task?'), { confirmLabel: $t('Delete'), danger: true }))
														form?.requestSubmit();
												}}
											>
												<Icon name="trash" size={14} />
											</button>
										</form>
									</div>
								{/if}
							</div>
							<div class="sub-pills">
								<StatusSelect taskId={s.id} statusId={s.statusId} {statuses} canEdit={sEdit} display={statusDisplay} />
								{@render subPriority(s, sEdit)}
								{@render subAssignee(s, sEdit)}
								{@render subMilestone(s, sEdit)}
								{@render subDue(s, sEdit)}
							</div>
						</div>
					{/each}
				</div>
			{:else}
				<p class="u-tiny u-muted" style="margin-bottom: var(--sp-2);">{$t('none')}</p>
			{/if}
			{#if editable}
				<div class="sub-add">
					<Popover ariaLabel={$t('Add sub-task')}>
						{#snippet trigger()}
							<span class="pill-val pill-ph"><Icon name="plus" size={12} /> {$t('Add sub-task')}</span>
						{/snippet}
						{#snippet panel(close)}
							<!-- svelte-ignore a11y_autofocus -->
							<input class="pop-search" placeholder={$t('Search or create…')} bind:value={subQuery} autofocus />
							{#each subCandidates as c (c.id)}
								<form method="POST" action="?/patchTask" use:enhance={pick(close)}>
									<input type="hidden" name="id" value={c.id} />
									<input type="hidden" name="parentId" value={task.id} />
									<button class="opt" type="submit">{c.title}</button>
								</form>
							{/each}
							{#if subQuery.trim() && subCandidates.length === 0}
								<form
									method="POST"
									action="?/createTask"
									use:enhance={() => async ({ update }) => {
										close();
										subQuery = '';
										update();
									}}
								>
									<input type="hidden" name="parentId" value={task.id} />
									<input type="hidden" name="title" value={subQuery.trim()} />
									<button class="opt opt--create" type="submit">{$t('Create task')} “{subQuery.trim()}”</button>
								</form>
							{:else if subCandidates.length === 0}
								<span class="opt-empty">{$t('Type to search or create a task')}</span>
							{/if}
						{/snippet}
					</Popover>
				</div>
			{/if}
		</div>
	{/if}

	<TaskComments taskId={task.id} />

	<div class="section pane-footer">
		{#if editable}
			<form
				method="POST"
				action="?/deleteTask"
				use:enhance={() => async ({ update }) => {
					onClose();
					await update();
				}}
			>
				<input type="hidden" name="id" value={task.id} />
				<button
					class="btn btn-sm btn-error"
					type="button"
					onclick={async (e) => {
						const form = e.currentTarget.form;
						const msg = subs.length > 0 ? $t('Delete this task and its sub-tasks?') : $t('Delete this task?');
						if (await confirmDialog(msg, { confirmLabel: $t('Delete'), danger: true })) form?.requestSubmit();
					}}>{$t('Delete task')}</button
				>
			</form>
		{/if}
		<button class="btn btn-sm" type="button" onclick={onClose}>{$t('Close')}</button>

		{#if editable}
			<div class="save-tpl-slot">
				{#if savingTpl}
					<div class="save-tpl-edit">
						<!-- svelte-ignore a11y_autofocus -->
						<input
							class="input save-tpl-search"
							bind:value={tplQuery}
							placeholder={$t('Save to template…')}
							maxlength="120"
							autocomplete="off"
							autofocus
							onkeydown={(e) => {
								if (e.key === 'Enter') {
									e.preventDefault();
									submitTpl('');
								} else if (e.key === 'Escape') savingTpl = false;
							}}
						/>
						<button
							class="icon-btn"
							type="button"
							aria-label={$t('Save as new template')}
							use:tooltip={$t('Save as new template')}
							onclick={() => submitTpl('')}
						>
							<Icon name="check" size={14} />
						</button>
						<button
							class="icon-btn"
							type="button"
							aria-label={$t('Cancel')}
							onclick={() => (savingTpl = false)}
						>
							<Icon name="xmark" size={14} />
						</button>
						{#if matchTemplates.length}
							<div class="save-tpl-results">
								{#each matchTemplates as tpl (tpl.id)}
									<button class="save-tpl-result" type="button" onclick={() => submitTpl(tpl.id)}>
										<Icon name="bookmark" size={13} />
										<span>{tpl.name}</span>
									</button>
								{/each}
							</div>
						{/if}
					</div>
				{:else}
					<button class="btn btn-sm save-tpl-open" type="button" onclick={openSaveTpl}>
						<Icon name="bookmark" size={14} />
						{$t('Save as template')}
					</button>
				{/if}
			</div>
			<form
				bind:this={tplForm}
				method="POST"
				action="?/saveTaskAsTemplate"
				class="hidden-form"
				use:enhance={() => async ({ update, result }) => {
					await update({ reset: false });
					if (result.type === 'success') {
						savingTpl = false;
						tplQuery = '';
						tplTargetId = '';
					}
				}}
			>
				<input type="hidden" name="taskId" value={task.id} />
				<input type="hidden" name="templateId" value={tplTargetId} />
				<input type="hidden" name="name" value={tplQuery} />
			</form>
		{/if}
	</div>
</SidePane>

<!-- A `task`-type custom field as a collapsible sub-task-style list of linked tasks -->
{#snippet taskCfList(field: { id: string; name: string; type: string; config: Record<string, unknown> })}
	{@const ids = cfIds(field)}
	{@const linked = cfLinked(field)}
	{@const fmulti = field.config?.multi === true}
	{@const open = !cfCollapsed[field.id]}
	<div class="cf-task">
		<button class="cf-task-head" type="button" onclick={() => (cfCollapsed[field.id] = open)}>
			<span class="label cf-task-name">{field.name}</span>
			<span class="cf-task-count">{linked.length}</span>
			<Icon name={open ? 'nav-arrow-down' : 'nav-arrow-right'} size={14} class="cf-task-chev" />
		</button>
		{#if open}
			{#if linked.length > 0}
				<div class="sub-list">
					{#each linked as lt (lt.id)}
						{@const ltEdit = canEditTask(lt)}
						<div class="sub-item" class:is-done={cat(lt.statusId) === 'completed'}>
							<div class="sub-head">
								<button class="sub-title-btn" type="button" onclick={() => onSelectTask?.(lt.id)}>{lt.title}</button>
								<span class="spacer"></span>
								{#if editable}
									<div class="sub-actions">
										<form method="POST" action="?/patchTask" use:enhance>
											<input type="hidden" name="id" value={task.id} />
											<input type="hidden" name={`cf_${field.id}`} value={cfRemoveVal(ids, lt.id)} />
											<button
												class="sub-act sub-act--del"
												type="submit"
												aria-label={$t('Remove')}
												use:tooltip={$t('Remove')}
											>
												<Icon name="xmark" size={14} />
											</button>
										</form>
									</div>
								{/if}
							</div>
							<div class="sub-pills">
								<StatusSelect taskId={lt.id} statusId={lt.statusId} {statuses} canEdit={ltEdit} display={statusDisplay} />
								{@render subPriority(lt, ltEdit)}
								{@render subAssignee(lt, ltEdit)}
								{@render subMilestone(lt, ltEdit)}
								{@render subDue(lt, ltEdit)}
							</div>
						</div>
					{/each}
				</div>
			{:else}
				<p class="u-tiny u-muted" style="margin-bottom: var(--sp-2);">{$t('none')}</p>
			{/if}
			{#if editable && (fmulti || linked.length === 0)}
				<div class="sub-add">
					<Popover ariaLabel={field.name}>
						{#snippet trigger()}
							<span class="pill-val pill-ph"><Icon name="plus" size={12} /> {$t('Add')}</span>
						{/snippet}
						{#snippet panel(close)}
							<!-- svelte-ignore a11y_autofocus -->
							<input class="pop-search" placeholder={$t('Search tasks…')} bind:value={cfAddQuery} autofocus />
							{#each cfAddCandidates(ids) as c (c.id)}
								<form method="POST" action="?/patchTask" use:enhance={pick(close)}>
									<input type="hidden" name="id" value={task.id} />
									<input type="hidden" name={`cf_${field.id}`} value={cfAddVal(ids, c.id, fmulti)} />
									<button class="opt" type="submit">{c.title}</button>
								</form>
							{:else}
								<span class="opt-empty">{$t('No tasks')}</span>
							{/each}
						{/snippet}
					</Popover>
				</div>
			{/if}
		{/if}
	</div>
{/snippet}

<!-- Editable property pills for a sub-task row (mirror the main task pills) -->
{#snippet subPriority(s: Task, canEdit: boolean)}
	{#if canEdit}
		<Popover ariaLabel={$t('Priority')} align="right">
			{#snippet trigger()}
				{#if s.priority !== 'none'}<PriorityBadge priority={s.priority} />{:else}<span class="pill-val pill-ph">{$t('Priority')}</span>{/if}
			{/snippet}
			{#snippet panel(close)}
				{#each PRIORITIES as p (p)}
					<form method="POST" action="?/patchTask" use:enhance={pick(close)}>
						<input type="hidden" name="id" value={s.id} />
						<input type="hidden" name="priority" value={p} />
						<button class="opt" class:opt--on={s.priority === p} type="submit"><PriorityIcon priority={p} /> {$t(p)}</button>
					</form>
				{/each}
			{/snippet}
		</Popover>
	{:else if s.priority !== 'none'}
		<PriorityBadge priority={s.priority} />
	{/if}
{/snippet}

{#snippet subAssignee(s: Task, canEdit: boolean)}
	{#if canEdit}
		<Popover ariaLabel={$t('Assignee')} align="right">
			{#snippet trigger()}
				<span class="pill-val" class:pill-ph={!s.assigneeId}>{userName(s.assigneeId) ?? $t('Assignee')}</span>
			{/snippet}
			{#snippet panel(close)}
				<form method="POST" action="?/patchTask" use:enhance={pick(close)}>
					<input type="hidden" name="id" value={s.id} />
					<input type="hidden" name="assigneeId" value="" />
					<button class="opt" class:opt--on={!s.assigneeId} type="submit">{$t('Unassigned')}</button>
				</form>
				{#each users as u (u.id)}
					<form method="POST" action="?/patchTask" use:enhance={pick(close)}>
						<input type="hidden" name="id" value={s.id} />
						<input type="hidden" name="assigneeId" value={u.id} />
						<button class="opt" class:opt--on={s.assigneeId === u.id} type="submit">{u.name}</button>
					</form>
				{/each}
			{/snippet}
		</Popover>
	{:else if userName(s.assigneeId)}
		<span class="pill-val">{userName(s.assigneeId)}</span>
	{/if}
{/snippet}

{#snippet subMilestone(s: Task, canEdit: boolean)}
	{#if canEdit}
		<Popover ariaLabel={$t('Milestone')} align="right">
			{#snippet trigger()}
				<span class="pill-val" class:pill-ph={!s.milestoneId}>{milestoneName(s.milestoneId) ?? $t('Milestone')}</span>
			{/snippet}
			{#snippet panel(close)}
				<!-- svelte-ignore a11y_autofocus -->
				<input class="pop-search" placeholder={$t('Search or create…')} bind:value={mQuery} autofocus />
				<form method="POST" action="?/patchTask" use:enhance={pick(close)}>
					<input type="hidden" name="id" value={s.id} />
					<input type="hidden" name="milestoneId" value="" />
					<button class="opt" class:opt--on={!s.milestoneId} type="submit">{$t('No milestone')}</button>
				</form>
				{#each mFiltered as m (m.id)}
					<form method="POST" action="?/patchTask" use:enhance={pick(close)}>
						<input type="hidden" name="id" value={s.id} />
						<input type="hidden" name="milestoneId" value={m.id} />
						<button class="opt" class:opt--on={s.milestoneId === m.id} type="submit">{m.name}</button>
					</form>
				{/each}
				{#if mQuery.trim() && mFiltered.length === 0}
					<form method="POST" action="?/createMilestone" use:enhance={() => async ({ update }) => { close(); mQuery = ''; update(); }}>
						<input type="hidden" name="taskId" value={s.id} />
						<input type="hidden" name="name" value={mQuery.trim()} />
						<button class="opt opt--create" type="submit">{$t('Create')} “{mQuery.trim()}”</button>
					</form>
				{/if}
			{/snippet}
		</Popover>
	{:else if milestoneName(s.milestoneId)}
		<span class="pill-val">{milestoneName(s.milestoneId)}</span>
	{/if}
{/snippet}

{#snippet subDue(s: Task, canEdit: boolean)}
	{#if canEdit}
		<Popover ariaLabel={$t('Due date')} align="right">
			{#snippet trigger()}
				<span class="pill-val mono" class:pill-ph={!s.dueDate}>{fmtDate(s.dueDate) ?? $t('Due')}</span>
			{/snippet}
			{#snippet panel(close)}
				<form method="POST" action="?/patchTask" use:enhance={pick(close)} class="pop-due">
					<input type="hidden" name="id" value={s.id} />
					<input name="dueDate" type="date" class="input" value={fmtDate(s.dueDate) ?? ''} onchange={(e) => e.currentTarget.form?.requestSubmit()} />
					<button
						class="opt opt--create"
						type="submit"
						onclick={(e) => {
							const input = e.currentTarget.form?.elements.namedItem('dueDate');
							if (input instanceof HTMLInputElement) input.value = '';
						}}>{$t('Clear')}</button
					>
				</form>
			{/snippet}
		</Popover>
	{:else if fmtDate(s.dueDate)}
		<span class="pill-val mono">{fmtDate(s.dueDate)}</span>
	{/if}
{/snippet}

<style>
	.title-input {
		font-size: 16px;
		font-weight: 600;
	}

	.textarea {
		width: 100%;
	}

	.pills-row {
		display: flex;
		flex-wrap: wrap;
		gap: var(--sp-1);
		margin-bottom: var(--sp-3);
	}

	.pill-ph {
		color: var(--color-muted);
	}

	.pill-val {
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 160px;
	}

	/* popover content */
	.opt {
		display: flex;
		align-items: center;
		gap: 8px;
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

	.opt--create {
		color: var(--color-link);
		border-top: 1px solid var(--color-border-subtle);
		margin-top: 4px;
		border-radius: 0;
	}

	.opt--stack {
		flex-direction: column;
		align-items: flex-start;
		gap: 0;
	}

	.opt-title {
		font-weight: inherit;
	}

	.opt-sub {
		font-size: 11px;
		color: var(--color-muted);
	}

	.opt-empty {
		display: block;
		font-size: 12px;
		color: var(--color-muted);
		padding: 4px 8px;
	}

	.pop-search {
		display: block;
		width: 100%;
		border: none;
		border-bottom: 1px solid var(--color-border-subtle);
		background: none;
		font-family: var(--font-body);
		font-size: 13px;
		padding: 6px 8px;
		margin-bottom: 4px;
		outline: none;
	}

	.pop-order {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 8px 6px 6px;
	}

	.pop-label {
		font-size: 11px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--color-muted);
	}

	.stepper {
		display: flex;
		align-items: stretch;
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-field, 0.25rem);
		overflow: hidden;
	}

	.step-btn {
		flex: 0 0 32px;
		border: none;
		background: var(--color-surface-muted);
		color: var(--color-fg);
		font-size: 16px;
		line-height: 1;
		cursor: pointer;
		transition: background var(--dur-fast) ease;
	}

	.step-btn:hover {
		background: var(--color-base-300);
	}

	.step-input {
		flex: 1;
		min-width: 0;
		border: none;
		border-left: 1px solid var(--color-border-subtle);
		border-right: 1px solid var(--color-border-subtle);
		background: var(--color-bg);
		color: var(--color-fg);
		font-family: var(--font-mono);
		font-size: 14px;
		text-align: center;
		padding: 6px 4px;
		outline: none;
		-moz-appearance: textfield;
		appearance: textfield;
	}

	.step-input::-webkit-outer-spin-button,
	.step-input::-webkit-inner-spin-button {
		-webkit-appearance: none;
		margin: 0;
	}

	.pop-actions {
		display: flex;
		justify-content: space-between;
		gap: 6px;
	}

	.ord {
		font-family: var(--font-mono);
	}

	.section {
		border-top: 1px solid var(--color-border-subtle);
		padding-top: var(--sp-2);
		margin-top: var(--sp-2);
	}

	.chips-row {
		display: flex;
		align-items: center;
		gap: var(--sp-1);
		flex-wrap: wrap;
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

	.chip--on {
		background: var(--color-fg);
		border-color: var(--color-fg);
		color: var(--color-bg);
	}

	.parent-link {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		border: none;
		background: none;
		color: var(--color-muted);
		font-family: inherit;
		font-size: 12px;
		cursor: pointer;
		padding: 0;
		margin-bottom: var(--sp-2);
	}

	.parent-link:hover {
		color: var(--color-fg);
	}

	.cf-task-head {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		border: none;
		background: none;
		color: var(--color-muted);
		cursor: pointer;
		padding: 0;
		text-align: left;
		margin-bottom: var(--sp-1);
	}

	.cf-task-head:hover {
		color: var(--color-fg);
	}

	.cf-task-name {
		margin-bottom: 0;
	}

	.cf-task-count {
		font-size: 12px;
		color: var(--color-muted);
	}

	.sub-list {
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-box, 0.5rem);
		margin-bottom: var(--sp-2);
		/* no overflow:hidden — it would clip the sub-tasks' property-pill popovers */
	}

	.sub-item {
		padding: var(--sp-2) 10px;
		border-top: 1px solid var(--color-border-subtle);
	}

	.sub-item:first-child {
		border-top: none;
	}

	.sub-head {
		display: flex;
		align-items: center;
		gap: var(--sp-2);
	}

	/* property pills (incl. status) sit UNDER the title */
	.sub-pills {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--sp-1);
		margin-top: 6px;
	}

	/* row checkbox: visible on row hover or when checked */
	.sub-check {
		flex: 0 0 auto;
		cursor: pointer;
		opacity: 0;
		transition: opacity var(--dur-fast) ease;
	}
	.sub-item:hover .sub-check,
	.sub-check:checked,
	.sub-item--sel .sub-check {
		opacity: 1;
	}
	.sub-item--sel {
		background: color-mix(in oklab, var(--color-fg) 6%, var(--color-bg));
	}

	.sub-bulk {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--sp-1);
		padding: var(--sp-1) var(--sp-2);
		margin-bottom: var(--sp-2);
		border: 1px solid var(--color-base-300);
		border-radius: var(--radius-box, 0.5rem);
		background: var(--color-base-100);
	}
	.sub-bulk-count {
		font-size: 12px;
		font-weight: 600;
		color: var(--color-fg);
		margin-right: var(--sp-1);
		white-space: nowrap;
	}
	.sub-bulk-del,
	.sub-bulk-clear {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		border: none;
		background: none;
		cursor: pointer;
		font-size: 12px;
		padding: 3px 8px;
		border-radius: 999px;
		color: var(--color-muted);
	}
	.sub-bulk-del:hover {
		color: var(--color-error);
		background: var(--color-surface-muted);
	}
	.sub-bulk-clear:hover {
		color: var(--color-fg);
		background: var(--color-surface-muted);
	}

	.sub-title-btn {
		border: none;
		background: none;
		color: var(--color-fg);
		font-family: inherit;
		font-size: 14px;
		font-weight: 500;
		text-align: left;
		cursor: pointer;
		padding: 0;
		overflow-wrap: anywhere;
	}

	.sub-title-btn:hover {
		text-decoration: underline;
		text-underline-offset: 3px;
	}

	.sub-item.is-done .sub-title-btn {
		color: var(--color-muted);
	}

	.pop-due {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 4px;
	}

	.sub-add {
		margin-top: var(--sp-1);
	}

	.pane-footer {
		display: flex;
		gap: var(--sp-2);
	}

	/* sub-task head actions (promote / delete): revealed on row hover */
	.sub-actions {
		display: inline-flex;
		align-items: center;
		gap: 2px;
		opacity: 0;
		transition: opacity var(--dur-fast) ease;
	}

	.sub-item:hover .sub-actions,
	.sub-actions:focus-within {
		opacity: 1;
	}

	.sub-act {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border: none;
		background: none;
		color: var(--color-muted);
		cursor: pointer;
		padding: 3px;
		border-radius: var(--radius-field, 0.25rem);
	}

	.sub-act:hover {
		background: var(--color-surface-muted);
		color: var(--color-fg);
	}

	.sub-act--del:hover {
		color: var(--color-error);
	}


	/* Save-as-template footer control (morphs button ↔ search field) */
	.save-tpl-slot {
		margin-left: auto;
		position: relative;
	}

	.save-tpl-edit {
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.save-tpl-search {
		width: 160px;
	}

	.icon-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border: 1px solid var(--color-border-subtle);
		background: var(--color-bg);
		color: var(--color-muted);
		cursor: pointer;
		padding: 4px;
		border-radius: var(--radius-field, 0.25rem);
		transition: color var(--dur-fast) ease, background var(--dur-fast) ease;
	}

	.icon-btn:hover {
		color: var(--color-fg);
		background: var(--color-surface-muted);
	}

	.save-tpl-results {
		position: absolute;
		bottom: calc(100% + 4px);
		right: 0;
		min-width: 200px;
		max-height: 220px;
		overflow-y: auto;
		background: var(--color-bg);
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-field, 0.25rem);
		padding: 4px;
		z-index: 30;
		box-shadow: 0 4px 16px rgb(0 0 0 / 0.12);
	}

	.save-tpl-result {
		display: flex;
		align-items: center;
		gap: 6px;
		width: 100%;
		border: none;
		background: none;
		color: var(--color-fg);
		font-size: 13px;
		text-align: left;
		padding: 5px 6px;
		border-radius: var(--radius-field, 0.25rem);
		cursor: pointer;
	}

	.save-tpl-result:hover {
		background: var(--color-surface-muted);
	}

	.hidden-form {
		display: none;
	}
</style>
