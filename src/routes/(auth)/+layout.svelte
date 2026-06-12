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
		display: flex;
		align-items: center;
		justify-content: center;
		padding: var(--sp-3);
		background: var(--color-bg);
	}

	.auth-box {
		width: 100%;
		max-width: 420px;
		border: 1px solid var(--color-border-subtle);
		background: var(--color-bg);
		padding: var(--sp-5) var(--sp-4);
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
</style>
