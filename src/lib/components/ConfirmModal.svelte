<script lang="ts">
	import { fade, scale } from 'svelte/transition';
	import { confirmState, answerConfirm } from '$lib/confirm.svelte';
	import { t } from '$lib/i18n';

	const req = $derived(confirmState.current);

	// Handle Escape/Enter in the CAPTURE phase and stop propagation so the keystroke
	// can't leak to ancestor window handlers (e.g. SidePane's Escape-closes-pane) or
	// to a focused background field. Escape always cancels; Enter confirms ONLY when
	// focus is inside the dialog, so an Enter typed in a background input (e.g. a
	// milestone name field) can't silently trigger a danger delete.
	$effect(() => {
		if (!req) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				answerConfirm(false);
				e.stopPropagation();
				e.preventDefault();
			} else if (e.key === 'Enter') {
				const t = e.target as HTMLElement | null;
				if (t?.closest?.('.cm-card') || e.target === document.body) {
					answerConfirm(true);
					e.stopPropagation();
					e.preventDefault();
				}
			}
		};
		window.addEventListener('keydown', onKey, true);
		return () => window.removeEventListener('keydown', onKey, true);
	});
</script>

{#if req}
	{#key req.id}
		<!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
		<div class="cm-backdrop" transition:fade={{ duration: 120 }} onclick={() => answerConfirm(false)}>
			<div
				class="cm-card"
				role="dialog"
				aria-modal="true"
				tabindex="-1"
				transition:scale={{ duration: 120, start: 0.96 }}
				onclick={(e) => e.stopPropagation()}
			>
				<p class="cm-msg">{req.message}</p>
				<div class="cm-actions">
					<button class="btn btn-sm" type="button" onclick={() => answerConfirm(false)}>
						{req.cancelLabel}
					</button>
					<!-- svelte-ignore a11y_autofocus -->
					<button
						class="btn btn-sm cm-confirm"
						class:btn-error={req.danger}
						class:btn-primary={!req.danger}
						type="button"
						autofocus
						onclick={() => answerConfirm(true)}
					>
						{req.confirmLabel}
					</button>
				</div>
			</div>
		</div>
	{/key}
{/if}

<style>
	.cm-backdrop {
		position: fixed;
		inset: 0;
		z-index: 100;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: var(--sp-4);
		background: color-mix(in oklab, black 45%, transparent);
	}

	.cm-card {
		width: min(92vw, 380px);
		background: var(--color-base-100);
		border-radius: var(--radius-box, 0.5rem);
		box-shadow:
			0 1px 2px color-mix(in oklab, black 8%, transparent),
			0 8px 24px color-mix(in oklab, black 18%, transparent);
		padding: var(--sp-4);
	}

	.cm-msg {
		font-size: 14px;
		color: var(--color-fg);
		margin-bottom: var(--sp-4);
		overflow-wrap: anywhere;
	}

	.cm-actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--sp-2);
	}

	.cm-confirm {
		transition: transform var(--dur-fast);
	}

	.cm-confirm:active {
		transform: scale(0.96);
	}
</style>
