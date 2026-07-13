<script lang="ts">
	import { t } from '$lib/i18n';
	import { fmtDate } from '$lib/date';

	type Task = {
		id: string;
		parentId: string | null;
		statusId: string;
		milestoneId: string | null;
		dueDate: Date | string | null;
	};
	type Status = { id: string; name: string; category: string };
	type Milestone = { id: string; name: string; targetDate: Date | string | null };

	let {
		tasks,
		statuses,
		milestones
	}: { tasks: Task[]; statuses: Status[]; milestones: Milestone[] } = $props();

	const top = $derived(tasks.filter((t) => !t.parentId));
	const cat = (id: string) => statuses.find((s) => s.id === id)?.category ?? 'backlog';
	const doneCount = $derived(top.filter((t) => cat(t.statusId) === 'completed').length);
	const pct = $derived(top.length > 0 ? Math.round((doneCount / top.length) * 100) : 0);
	const overdue = $derived(
		top.filter(
			(t) =>
				t.dueDate && new Date(t.dueDate).getTime() < Date.now() && cat(t.statusId) !== 'completed'
		).length
	);

	const byStatus = $derived(
		statuses.map((s) => ({ status: s, count: top.filter((t) => t.statusId === s.id).length }))
	);

	const byMilestone = $derived(
		milestones.map((m) => {
			const mt = tasks.filter((t) => t.milestoneId === m.id);
			const done = mt.filter((t) => cat(t.statusId) === 'completed').length;
			return { milestone: m, total: mt.length, done };
		})
	);
</script>

<div class="stats">
	<div class="stat">
		<span class="stat-num">{top.length}</span>
		<span class="stat-label">{$t('tasks')}</span>
	</div>
	<div class="stat">
		<span class="stat-num">{pct}%</span>
		<span class="stat-label">{$t('complete')}</span>
	</div>
	<div class="stat">
		<span class="stat-num">{overdue}</span>
		<span class="stat-label">{$t('overdue')}</span>
	</div>
</div>

<div class="panel">
	<h4 style="margin-bottom: var(--sp-2);">{$t('By status')}</h4>
	{#each byStatus as row (row.status.id)}
		<div class="bar-row">
			<span class="bar-label">{row.status.name}</span>
			<div class="bar">
				<div
					class="bar-fill"
					style="width: {top.length > 0 ? (row.count / top.length) * 100 : 0}%"
				></div>
			</div>
			<span class="bar-count mono">{row.count}</span>
		</div>
	{/each}
</div>

<div class="panel">
	<h4 style="margin-bottom: var(--sp-2);">{$t('Milestones')}</h4>
	{#each byMilestone as row (row.milestone.id)}
		<div class="bar-row">
			<span class="bar-label">
				{row.milestone.name}
				{#if row.milestone.targetDate}
					<span class="u-tiny u-muted mono">{fmtDate(row.milestone.targetDate)}</span>
				{/if}
			</span>
			<div class="bar">
				<div
					class="bar-fill"
					style="width: {row.total > 0 ? (row.done / row.total) * 100 : 0}%"
				></div>
			</div>
			<span class="bar-count mono">{row.done}/{row.total}</span>
		</div>
	{:else}
		<p class="u-small u-muted">{$t('No milestones yet.')}</p>
	{/each}
</div>

<style>
	.stats {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
		gap: var(--sp-2);
		margin-bottom: var(--sp-3);
	}

	.stat {
		border: 1px solid var(--color-border-subtle);
		padding: var(--sp-3);
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.stat-num {
		font-size: 32px;
		font-weight: 700;
		letter-spacing: var(--heading-tracking);
		line-height: 1;
		font-variant-numeric: tabular-nums;
	}

	.stat-label {
		font-size: 12px;
		color: var(--color-muted);
	}

	.panel {
		border: 1px solid var(--color-border-subtle);
		padding: var(--sp-3);
		margin-bottom: var(--sp-3);
	}

	.bar-row {
		display: flex;
		align-items: center;
		gap: var(--sp-2);
		margin-bottom: var(--sp-1);
	}

	.bar-label {
		flex: 0 0 180px;
		font-size: 14px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.bar {
		flex: 1;
		height: 4px;
		background: var(--color-surface-muted);
	}

	.bar-fill {
		height: 100%;
		background: var(--color-fg);
		transition: width 0.2s ease;
	}

	.bar-count {
		flex: 0 0 48px;
		text-align: right;
		font-size: 12px;
		color: var(--color-muted);
		font-variant-numeric: tabular-nums;
	}

	@media (max-width: 720px) {
		/* 140px min-width can force awkward wrapping on a phone — pin to 2 cols. */
		.stats {
			grid-template-columns: repeat(2, 1fr);
		}

		.stat-num {
			font-size: 28px;
		}
	}

	@media (max-width: 600px) {
		.bar-label {
			flex-basis: 110px;
		}
	}

	@media (max-width: 375px) {
		.stats {
			grid-template-columns: 1fr;
		}
	}
</style>
