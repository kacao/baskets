<script lang="ts">
	import { t as i18n } from '$lib/i18n';
	import Icon from '$lib/components/Icon.svelte';
	import Popover from '$lib/components/Popover.svelte';
	import { confirmDialog } from '$lib/confirm.svelte';

	type Status = { id: string; name: string; color?: string | null };
	type Named = { id: string; name: string };

	let {
		count,
		statuses = [],
		users = [],
		milestones = [],
		canEdit = true,
		onSetStatus,
		onSetAssignee,
		onSetMilestone,
		onSetPriority,
		onDelete,
		onClear
	}: {
		count: number;
		statuses?: Status[];
		users?: Named[];
		milestones?: Named[];
		canEdit?: boolean;
		onSetStatus: (statusId: string) => void | Promise<void>;
		onSetAssignee: (assigneeId: string | null) => void | Promise<void>;
		onSetMilestone: (milestoneId: string | null) => void | Promise<void>;
		onSetPriority: (priority: string) => void | Promise<void>;
		onDelete: () => void | Promise<void>;
		onClear: () => void;
	} = $props();

	const PRIORITIES = ['urgent', 'high', 'medium', 'low', 'none'] as const;

	let busy = $state(false);

	async function run(fn: () => void | Promise<void>, close?: () => void) {
		if (busy) return;
		busy = true;
		try {
			await fn();
		} finally {
			busy = false;
			close?.();
		}
	}

	async function confirmDelete() {
		if (busy) return;
		const ok = await confirmDialog(
			$i18n('Delete {n} tasks? This cannot be undone.').replace('{n}', String(count)),
			{ confirmLabel: $i18n('Delete'), cancelLabel: $i18n('Cancel'), danger: true }
		);
		if (ok) await run(onDelete);
	}
</script>

{#if count > 0}
	<div class="bulk-bar" role="toolbar" aria-label={$i18n('Bulk actions')}>
		<span class="bulk-count">
			{$i18n('{n} selected').replace('{n}', String(count))}
		</span>

		{#if canEdit}
			<div class="bulk-actions">
				<Popover ariaLabel={$i18n('Set status')} up>
					{#snippet trigger()}
						<span class="bulk-trigger"><Icon name="circle" size={14} />{$i18n('Status')}</span>
					{/snippet}
					{#snippet panel(close)}
						<div class="bulk-menu">
							{#each statuses as s (s.id)}
								<button
									class="bulk-opt"
									disabled={busy}
									onclick={() => run(() => onSetStatus(s.id), close)}
								>
									<span class="dot" style="--c: {s.color || 'var(--color-muted)'}" aria-hidden="true"></span>
									{s.name}
								</button>
							{/each}
						</div>
					{/snippet}
				</Popover>

				<Popover ariaLabel={$i18n('Set assignee')} up>
					{#snippet trigger()}
						<span class="bulk-trigger"><Icon name="user" size={14} />{$i18n('Assignee')}</span>
					{/snippet}
					{#snippet panel(close)}
						<div class="bulk-menu">
							<button class="bulk-opt" disabled={busy} onclick={() => run(() => onSetAssignee(null), close)}>
								{$i18n('Unassigned')}
							</button>
							{#each users as u (u.id)}
								<button class="bulk-opt" disabled={busy} onclick={() => run(() => onSetAssignee(u.id), close)}>
									{u.name}
								</button>
							{/each}
						</div>
					{/snippet}
				</Popover>

				<Popover ariaLabel={$i18n('Set milestone')} up>
					{#snippet trigger()}
						<span class="bulk-trigger"><Icon name="triangle-flag" size={14} />{$i18n('Milestone')}</span>
					{/snippet}
					{#snippet panel(close)}
						<div class="bulk-menu">
							<button class="bulk-opt" disabled={busy} onclick={() => run(() => onSetMilestone(null), close)}>
								{$i18n('No milestone')}
							</button>
							{#each milestones as m (m.id)}
								<button class="bulk-opt" disabled={busy} onclick={() => run(() => onSetMilestone(m.id), close)}>
									{m.name}
								</button>
							{/each}
						</div>
					{/snippet}
				</Popover>

				<Popover ariaLabel={$i18n('Set priority')} up>
					{#snippet trigger()}
						<span class="bulk-trigger"><Icon name="priority-high" size={14} />{$i18n('Priority')}</span>
					{/snippet}
					{#snippet panel(close)}
						<div class="bulk-menu">
							{#each PRIORITIES as p (p)}
								<button class="bulk-opt" disabled={busy} onclick={() => run(() => onSetPriority(p), close)}>
									{$i18n(p)}
								</button>
							{/each}
						</div>
					{/snippet}
				</Popover>

				<button class="bulk-trigger bulk-danger" disabled={busy} onclick={confirmDelete}>
					<Icon name="trash" size={14} />{$i18n('Delete')}
				</button>
			</div>
		{/if}

		<button class="bulk-clear" aria-label={$i18n('Clear selection')} onclick={onClear} disabled={busy}>
			<Icon name="xmark" size={16} />
		</button>
	</div>
{/if}

<style>
	.bulk-bar {
		position: fixed;
		bottom: var(--sp-4);
		left: 50%;
		transform: translateX(-50%);
		z-index: 50;
		display: flex;
		align-items: center;
		gap: var(--sp-3);
		padding: var(--sp-2) var(--sp-3);
		background: var(--color-base-100);
		border: 1px solid var(--color-base-300);
		border-radius: var(--radius-lg, 10px);
		box-shadow:
			0 1px 2px rgb(0 0 0 / 0.08),
			0 8px 24px rgb(0 0 0 / 0.18);
		max-width: calc(100vw - 2 * var(--sp-4));
	}

	.bulk-count {
		font-size: 13px;
		font-weight: 600;
		color: var(--color-fg);
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
	}

	.bulk-actions {
		display: flex;
		align-items: center;
		gap: var(--sp-1);
		flex-wrap: wrap;
	}

	.bulk-trigger {
		display: inline-flex;
		align-items: center;
		gap: var(--sp-1);
		font-size: 13px;
		color: var(--color-fg);
		background: none;
		border: none;
		cursor: pointer;
		padding: 4px 6px;
		border-radius: var(--radius, 6px);
		white-space: nowrap;
		transition: background var(--dur-fast), color var(--dur-fast);
	}

	.bulk-trigger:hover {
		background: var(--color-surface-muted);
	}

	.bulk-danger {
		color: var(--color-danger, #dc2626);
	}

	.bulk-trigger:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.bulk-menu {
		display: flex;
		flex-direction: column;
		min-width: 160px;
		max-height: 280px;
		overflow-y: auto;
	}

	.bulk-opt {
		display: flex;
		align-items: center;
		gap: var(--sp-2);
		text-align: left;
		font-size: 13px;
		color: var(--color-fg);
		background: none;
		border: none;
		cursor: pointer;
		padding: 6px 10px;
		white-space: nowrap;
		transition: background var(--dur-fast);
	}

	.bulk-opt:hover {
		background: var(--color-surface-muted);
	}

	.bulk-opt:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.dot {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: var(--c);
		flex: 0 0 10px;
	}

	.bulk-clear {
		position: relative;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border: none;
		background: none;
		color: var(--color-muted);
		cursor: pointer;
		padding: 4px;
		border-radius: var(--radius, 6px);
		transition: background var(--dur-fast), color var(--dur-fast);
	}

	.bulk-clear::before {
		content: '';
		position: absolute;
		top: 50%;
		left: 50%;
		width: 40px;
		height: 40px;
		transform: translate(-50%, -50%);
	}

	.bulk-clear:hover {
		color: var(--color-fg);
		background: var(--color-surface-muted);
	}
</style>
