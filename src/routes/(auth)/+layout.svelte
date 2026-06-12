<script lang="ts">
	let { children } = $props();
</script>

<div class="auth-shell">
	<div class="auth-box">
		<div class="auth-logo">
			<span class="auth-logo-mark">BASKETS</span>
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
		background:
			repeating-linear-gradient(
				45deg,
				transparent,
				transparent 24px,
				#f2f2f2 24px,
				#f2f2f2 26px
			);
	}

	.auth-box {
		width: 100%;
		max-width: 420px;
		border: var(--border-width-heavy) solid var(--color-fg);
		background: var(--color-bg);
		padding: var(--sp-5) var(--sp-4);
		animation: drop-in 0.25s ease-out;
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
		font-size: 28px;
		background: var(--color-fg);
		color: var(--color-bg);
		padding: 4px 12px;
		display: inline-block;
	}
</style>
