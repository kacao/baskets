<script lang="ts">
	import { enhance } from '$app/forms';

	type Status = { id: string; name: string; category: string };

	let {
		taskId,
		statusId,
		statuses,
		canEdit = true
	}: { taskId: string; statusId: string; statuses: Status[]; canEdit?: boolean } = $props();

	const current = $derived(statuses.find((s) => s.id === statusId));

	const glyph: Record<string, string> = {
		todo: '○',
		active: '◐',
		done: '●',
		canceled: '⊘'
	};
</script>

{#if canEdit}
	<form method="POST" action="?/setStatus" use:enhance class="status-form">
		<input type="hidden" name="id" value={taskId} />
		<span class="glyph" class:done={current?.category === 'done'} aria-hidden="true">
			{glyph[current?.category ?? 'todo']}
		</span>
		<select
			class="status-select"
			name="statusId"
			value={statusId}
			aria-label="Status"
			onchange={(e) => e.currentTarget.form?.requestSubmit()}
		>
			{#each statuses as s (s.id)}
				<option value={s.id}>{s.name}</option>
			{/each}
		</select>
	</form>
{:else}
	<span class="status-readonly">
		<span class="glyph" aria-hidden="true">{glyph[current?.category ?? 'todo']}</span>
		{current?.name ?? '—'}
	</span>
{/if}

<style>
	.status-form {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		flex: 0 0 auto;
	}

	.glyph {
		font-size: 12px;
		line-height: 1;
		color: var(--color-muted);
	}

	.glyph.done {
		color: var(--color-fg);
	}

	.status-select {
		border: 1px solid var(--color-border-subtle);
		background: var(--color-bg);
		color: var(--color-fg);
		font-family: var(--font-body);
		font-size: 12px;
		font-weight: 400;
		padding: 2px 4px;
		cursor: pointer;
		transition: border-color 0.15s ease;
	}

	.status-select:hover,
	.status-select:focus {
		border-color: var(--color-fg);
		outline: none;
	}

	.status-readonly {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-size: 12px;
		color: var(--color-muted);
		white-space: nowrap;
	}
</style>
