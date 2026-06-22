<script lang="ts">
	import { onMount } from 'svelte';
	import { enhance } from '$app/forms';
	import SidePane from '$lib/components/SidePane.svelte';
	import CustomFieldValue from '$lib/components/CustomFieldValue.svelte';
	import { fieldAppliesTo } from '$lib/customFields';
	import { toast } from '$lib/toast.svelte';
	import { t } from '$lib/i18n';

	type Status = { id: string; name: string; category: string };
	type Prefill = {
		statusId?: string;
		milestoneId?: string;
		assigneeId?: string;
		dueDate?: string;
	};

	let {
		statuses,
		users,
		milestones,
		locations = [],
		tasks = [],
		customFields = [],
		customFieldOptions = [],
		taskSearch = () => '',
		prefill = {},
		onClose
	}: {
		statuses: Status[];
		users: { id: string; name: string }[];
		milestones: { id: string; name: string }[];
		locations?: { id: string; title: string }[];
		tasks?: { id: string; title: string; parentId: string | null }[];
		customFields?: { id: string; name: string; type: string; config: Record<string, unknown>; appliesTo?: string }[];
		customFieldOptions?: { id: string; fieldId: string; title: string; color: string | null; icon: string | null }[];
		taskSearch?: (taskId: string) => string;
		prefill?: Prefill;
		onClose: () => void;
	} = $props();

	const cfOptions = (fieldId: string) => customFieldOptions.filter((o) => o.fieldId === fieldId);
	// the new-task pane creates top-level tasks, so only show fields that apply to them
	const visibleCustomFields = $derived(customFields.filter((f) => fieldAppliesTo(f, false)));

	// This pane remounts fresh on every open, so capturing prefill/statuses once
	// at init is intentional (no reactive re-sync wanted).
	// svelte-ignore state_referenced_locally
	const defaultStatus =
		prefill.statusId ??
		statuses.find((s) => s.category === 'backlog')?.id ??
		statuses[0]?.id ??
		'';

	// Controlled fields so "Create more" can keep the carried-over values while
	// resetting title/priority for the next task.
	let title = $state('');
	let statusId = $state(defaultStatus);
	let priority = $state('none');
	// svelte-ignore state_referenced_locally
	let assigneeId = $state(prefill.assigneeId ?? '');
	// svelte-ignore state_referenced_locally
	let milestoneId = $state(prefill.milestoneId ?? '');
	// svelte-ignore state_referenced_locally
	let dueDate = $state(prefill.dueDate ?? '');
	let createMore = $state(false);
	let titleEl = $state<HTMLInputElement | null>(null);

	const PRIORITIES: [string, string][] = [
		['none', '— priority'],
		['low', 'Low'],
		['medium', 'Medium'],
		['high', 'High'],
		['urgent', 'Urgent']
	];

	// autofocus is ignored once SidePane portals this node (use:portal), so focus
	// Title explicitly after the portal move + slide-in's first frame.
	onMount(() => requestAnimationFrame(() => titleEl?.focus()));
</script>

<SidePane title={$t('New task')} onClose={onClose} ariaLabel={$t('New task')}>
	<form
		method="POST"
		action="?/createTask"
		use:enhance={() =>
			async ({ result, update }) => {
				if (result.type === 'success') {
					toast($t('New task added'));
					await update({ reset: false });
					if (createMore) {
						title = '';
						priority = 'none';
						titleEl?.focus();
					} else {
						onClose();
					}
				} else {
					await update();
				}
			}}
	>
		<div class="field">
			<label class="label" for="nt-title">{$t('Title')}</label>
			<!-- svelte-ignore a11y_autofocus -->
			<input
				bind:this={titleEl}
				id="nt-title"
				name="title"
				class="input"
				bind:value={title}
				placeholder={$t('Task title…')}
				required
				maxlength="240"
				autocomplete="off"
				autofocus
			/>
		</div>

		<div class="field">
			<label class="label" for="nt-status">{$t('Status')}</label>
			<select id="nt-status" name="statusId" class="select" bind:value={statusId}>
				{#each statuses as s (s.id)}
					<option value={s.id}>{s.name}</option>
				{/each}
			</select>
		</div>

		<div class="field">
			<label class="label" for="nt-priority">{$t('Priority')}</label>
			<select id="nt-priority" name="priority" class="select" bind:value={priority}>
				{#each PRIORITIES as [val, lbl] (val)}
					<option value={val}>{$t(lbl)}</option>
				{/each}
			</select>
		</div>

		<div class="field">
			<label class="label" for="nt-assignee">{$t('Assignee')}</label>
			<select id="nt-assignee" name="assigneeId" class="select" bind:value={assigneeId}>
				<option value="">{$t('Unassigned')}</option>
				{#each users as u (u.id)}
					<option value={u.id}>{u.name}</option>
				{/each}
			</select>
		</div>

		<div class="field">
			<label class="label" for="nt-milestone">{$t('Milestone')}</label>
			<select id="nt-milestone" name="milestoneId" class="select" bind:value={milestoneId}>
				<option value="">{$t('No milestone')}</option>
				{#each milestones as m (m.id)}
					<option value={m.id}>{m.name}</option>
				{/each}
			</select>
		</div>

		<div class="field">
			<label class="label" for="nt-due">{$t('Due date')}</label>
			<input id="nt-due" name="dueDate" type="date" class="input" bind:value={dueDate} />
		</div>

		{#each visibleCustomFields as f (f.id)}
			<div class="field">
				<CustomFieldValue
					field={f}
					options={cfOptions(f.id)}
					mode="input"
					{users}
					{locations}
					{tasks}
					{taskSearch}
				/>
			</div>
		{/each}

		<label class="more">
			<input type="checkbox" bind:checked={createMore} />
			{$t('Create more')}
		</label>

		<div class="u-flex" style="margin-top: var(--sp-3);">
			<button class="btn btn-primary" type="submit">{$t('Create')}</button>
			<button class="btn" type="button" onclick={onClose}>{$t('Cancel')}</button>
		</div>
	</form>
</SidePane>

<style>
	.field {
		margin-bottom: var(--sp-3);
	}

	.field .input,
	.field .select {
		width: 100%;
	}

	.more {
		display: flex;
		align-items: center;
		gap: var(--sp-1);
		font-size: 13px;
		color: var(--color-fg);
		cursor: pointer;
		user-select: none;
	}

	.btn-primary {
		transition: transform var(--dur-fast);
	}

	.btn-primary:active {
		transform: scale(0.96);
	}
</style>
