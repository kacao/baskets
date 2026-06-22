<script lang="ts">
	import { fly } from 'svelte/transition';
	import { flip } from 'svelte/animate';
	import { toasts, dismiss } from '$lib/toast.svelte';
</script>

<div class="toaster" aria-live="polite" aria-atomic="false">
	{#each toasts as t (t.id)}
		<button
			class="toast"
			type="button"
			animate:flip={{ duration: 150 }}
			in:fly={{ y: 12, duration: 150 }}
			out:fly={{ y: 12, duration: 150 }}
			onclick={() => dismiss(t.id)}
		>
			{t.message}
		</button>
	{/each}
</div>

<style>
	.toaster {
		position: fixed;
		bottom: var(--sp-4);
		left: 50%;
		transform: translateX(-50%);
		z-index: 60;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--sp-1);
		pointer-events: none;
	}

	.toast {
		pointer-events: auto;
		border: 1px solid transparent;
		background: var(--color-fg);
		color: var(--color-bg);
		font-family: var(--font-body);
		font-size: 13px;
		line-height: 1.3;
		padding: var(--sp-2) var(--sp-3);
		border-radius: var(--radius-field, 0.25rem);
		box-shadow:
			0 1px 2px rgba(0, 0, 0, 0.08),
			0 8px 24px rgba(0, 0, 0, 0.16);
		cursor: pointer;
		max-width: min(90vw, 360px);
		text-align: left;
		transition: transform var(--dur-fast);
	}

	.toast:active {
		transform: scale(0.96);
	}
</style>
