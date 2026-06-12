<script lang="ts">
	import { enhance } from '$app/forms';

	let { taskId, status }: { taskId: string; status: string } = $props();

	const next: Record<string, string> = {
		todo: 'in_progress',
		in_progress: 'done',
		done: 'todo'
	};

	const glyph: Record<string, string> = {
		todo: '',
		in_progress: '◐',
		done: '✕'
	};

	const titles: Record<string, string> = {
		todo: 'To do — click to start',
		in_progress: 'In progress — click to complete',
		done: 'Done — click to reopen'
	};
</script>

<form method="POST" action="?/setStatus" use:enhance style="display: contents;">
	<input type="hidden" name="id" value={taskId} />
	<input type="hidden" name="status" value={next[status] ?? 'todo'} />
	<button
		type="submit"
		class="status-btn"
		class:done={status === 'done'}
		class:progress={status === 'in_progress'}
		title={titles[status] ?? ''}
		aria-label={titles[status] ?? 'Change status'}
	>
		{glyph[status] ?? ''}
	</button>
</form>

<style>
	.status-btn {
		width: 24px;
		height: 24px;
		flex: 0 0 24px;
		border: var(--border-width) solid var(--color-fg);
		background: var(--color-bg);
		color: var(--color-fg);
		font-size: 13px;
		line-height: 1;
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		transition: background 0.1s steps(2, end);
	}

	.status-btn:hover {
		background: #e0e0e0;
	}

	.status-btn.done {
		background: var(--color-fg);
		color: var(--color-bg);
	}

	.status-btn.progress {
		color: var(--color-fg);
	}
</style>
