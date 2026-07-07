<script lang="ts">
	let { children } = $props();
</script>

<div class="auth-shell">
	<div class="auth-box">
		<div class="auth-logo">
			<span class="auth-logo-mark">Baskets</span>
		</div>
		{@render children()}
	</div>
</div>

<style>
	.auth-shell {
		min-height: 100vh;
		min-height: 100dvh;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: max(var(--sp-4), env(safe-area-inset-top)) max(var(--sp-3), env(safe-area-inset-right))
			max(var(--sp-4), env(safe-area-inset-bottom)) max(var(--sp-3), env(safe-area-inset-left));
		background: var(--color-bg);
	}

	.auth-box {
		width: 100%;
		max-width: 420px;
		border: 1px solid var(--color-border-subtle);
		background: var(--color-bg);
		padding: var(--sp-5) var(--sp-4);
		box-shadow:
			0 1px 2px color-mix(in srgb, var(--color-base-content) 6%, transparent),
			0 8px 24px color-mix(in srgb, var(--color-base-content) 8%, transparent);
		animation: drop-in 0.18s ease-out;
	}

	@keyframes drop-in {
		from {
			transform: translateY(-12px);
			opacity: 0;
		}
		to {
			transform: translateY(0);
			opacity: 1;
		}
	}

	.auth-logo {
		margin-bottom: var(--sp-4);
	}

	.auth-logo-mark {
		font-family: var(--font-headline);
		font-size: 24px;
		font-weight: 700;
		letter-spacing: var(--heading-tracking);
		color: var(--color-fg);
		display: inline-block;
	}

	@media (max-width: 720px) {
		.auth-box {
			padding: var(--sp-4) var(--sp-3);
		}

		.auth-box :global(input),
		.auth-box :global(.input),
		.auth-box :global(.select),
		.auth-box :global(.btn) {
			width: 100%;
		}
	}

	@media (max-width: 375px) {
		.auth-box {
			padding: var(--sp-3) var(--sp-2);
		}

		.auth-logo-mark {
			font-size: 20px;
		}
	}
</style>
