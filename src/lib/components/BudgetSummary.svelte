<script lang="ts">
	import { t } from '$lib/i18n';
	import Icon from '$lib/components/Icon.svelte';
	import {
		computeBudget,
		formatVariancePct,
		type BudgetField,
		type BudgetMilestone,
		type BudgetTask,
		type BudgetValue
	} from '$lib/budget';

	let {
		tasks,
		taskCustomValues,
		customFields,
		milestones,
		estimatedCostFieldId,
		actualCostFieldId
	}: {
		tasks: BudgetTask[];
		taskCustomValues: BudgetValue[];
		customFields: BudgetField[];
		milestones: BudgetMilestone[];
		estimatedCostFieldId: string | null | undefined;
		actualCostFieldId: string | null | undefined;
	} = $props();

	const budget = $derived(
		computeBudget(
			tasks,
			taskCustomValues,
			customFields,
			estimatedCostFieldId,
			actualCostFieldId,
			milestones
		)
	);
</script>

{#if budget.configured}
	<div class="budget">
		<div class="budget-head">
			<Icon name="dollar" size={14} />
			<span class="budget-title">{$t('Budget')}</span>
		</div>
		<table class="budget-table">
			<thead>
				<tr>
					<th class="b-name">{$t('Milestone')}</th>
					<th class="b-num">{$t('Estimated')}</th>
					<th class="b-num">{$t('Actual')}</th>
					<th class="b-num">{$t('Variance')}</th>
				</tr>
			</thead>
			<tbody>
				{#each budget.rows as r (r.id ?? 'none')}
					<tr>
						<td class="b-name" class:b-muted={r.id === null}>{r.id === null ? $t('No milestone') : r.name}</td>
						<td class="b-num mono">{r.estimatedText}</td>
						<td class="b-num mono">{r.actualText}</td>
						<td class="b-num mono" class:b-over={r.variance > 0} class:b-under={r.variance < 0}>
							{r.varianceText}
							<span class="b-pct">{formatVariancePct(r.pct)}</span>
						</td>
					</tr>
				{:else}
					<tr><td colspan="4" class="b-empty">{$t('No milestones yet.')}</td></tr>
				{/each}
			</tbody>
			<tfoot>
				<tr class="b-total">
					<td class="b-name">{$t('Total')}</td>
					<td class="b-num mono">{budget.total.estimatedText}</td>
					<td class="b-num mono">{budget.total.actualText}</td>
					<td
						class="b-num mono"
						class:b-over={budget.total.variance > 0}
						class:b-under={budget.total.variance < 0}
					>
						{budget.total.varianceText}
						<span class="b-pct">{formatVariancePct(budget.total.pct)}</span>
					</td>
				</tr>
			</tfoot>
		</table>
	</div>
{/if}

<style>
	.budget {
		margin-top: var(--sp-4);
		border-top: 1px solid var(--color-border-subtle);
		padding-top: var(--sp-3);
	}

	.budget-head {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-bottom: var(--sp-2);
		color: var(--color-muted);
	}

	.budget-title {
		font-size: 12px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.budget-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 12px;
	}

	.budget-table th,
	.budget-table td {
		padding: 4px 6px;
		text-align: left;
		border-bottom: 1px solid var(--color-border-subtle);
	}

	.b-num {
		text-align: right;
		white-space: nowrap;
	}

	thead th {
		font-size: 11px;
		font-weight: 600;
		color: var(--color-muted);
	}

	.b-name {
		max-width: 140px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.b-muted {
		color: var(--color-muted);
	}

	.b-empty {
		text-align: center;
		color: var(--color-muted);
		padding: var(--sp-2);
	}

	.b-over {
		color: var(--color-error);
	}

	.b-under {
		color: var(--color-success, #16a34a);
	}

	.b-pct {
		display: inline-block;
		margin-left: 4px;
		font-size: 11px;
		opacity: 0.85;
	}

	.b-total td {
		font-weight: 600;
		border-bottom: none;
		border-top: 2px solid var(--color-border-subtle);
	}
</style>
