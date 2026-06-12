<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { authClient } from '$lib/auth-client';

	let { data, children } = $props();
	let menuOpen = $state(false);

	const nav = [
		{ href: '/projects', label: 'Projects' },
		{ href: '/settings', label: 'Settings' }
	];

	async function signOut() {
		await authClient.signOut();
		await goto('/login');
	}

	function isActive(href: string) {
		return page.url.pathname === href || page.url.pathname.startsWith(href + '/');
	}
</script>

<div class="shell">
	<header class="topbar">
		<div class="u-flex">
			<button
				class="hamburger"
				aria-label="Toggle menu"
				aria-expanded={menuOpen}
				onclick={() => (menuOpen = !menuOpen)}
			>
				{menuOpen ? '×' : '≡'}
			</button>
			<a href="/projects" class="wordmark">BASKETS</a>
		</div>
		<div class="u-flex">
			{#if data.user?.role === 'admin'}
				<span class="badge badge--inverted">admin</span>
			{/if}
			<span class="u-small u-muted topbar-user">{data.user?.name}</span>
			<button class="btn btn--sm" onclick={signOut}>Sign out</button>
		</div>
	</header>

	<div class="body">
		<nav class="sidebar" class:open={menuOpen}>
			{#each nav as item (item.href)}
				<a
					href={item.href}
					class="nav-link"
					class:active={isActive(item.href)}
					onclick={() => (menuOpen = false)}
				>
					{item.label}
				</a>
			{/each}
			{#if data.user?.role === 'admin'}
				<a
					href="/admin"
					class="nav-link"
					class:active={isActive('/admin')}
					onclick={() => (menuOpen = false)}
				>
					Users
				</a>
			{/if}
		</nav>

		<main class="content">
			{@render children()}
		</main>
	</div>
</div>

<style>
	.shell {
		min-height: 100vh;
		display: flex;
		flex-direction: column;
	}

	.topbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--sp-2);
		padding: var(--sp-2) var(--sp-3);
		border-bottom: var(--border-width-heavy) solid var(--color-fg);
		background: var(--color-bg);
		position: sticky;
		top: 0;
		z-index: 10;
	}

	.wordmark {
		font-family: var(--font-headline);
		font-size: 20px;
		color: var(--color-fg);
		text-decoration: none;
		background: var(--color-fg);
		color: var(--color-bg);
		padding: 2px 10px;
	}

	.hamburger {
		display: none;
		border: var(--border-width) solid var(--color-fg);
		background: var(--color-bg);
		font-size: 20px;
		line-height: 1;
		width: 38px;
		height: 38px;
		cursor: pointer;
	}

	.body {
		flex: 1;
		display: flex;
		align-items: stretch;
	}

	.sidebar {
		width: 200px;
		border-right: var(--border-width) solid var(--color-fg);
		padding: var(--sp-4) 0;
		display: flex;
		flex-direction: column;
	}

	.nav-link {
		font-family: var(--font-body);
		font-weight: 600;
		font-size: 14px;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--color-fg);
		text-decoration: none;
		padding: var(--sp-2) var(--sp-3);
		border-bottom: 2px solid var(--color-fg);
		transition:
			background 0.1s steps(2, end),
			color 0.1s steps(2, end);
	}

	.nav-link:first-child {
		border-top: 2px solid var(--color-fg);
	}

	.nav-link:hover,
	.nav-link.active {
		background: var(--color-fg);
		color: var(--color-bg);
	}

	.content {
		flex: 1;
		padding: var(--sp-4) var(--sp-4) var(--sp-7);
		max-width: 1100px;
		min-width: 0;
	}

	@media (max-width: 720px) {
		.hamburger {
			display: block;
		}

		.topbar-user {
			display: none;
		}

		.sidebar {
			position: fixed;
			top: 59px;
			left: 0;
			bottom: 0;
			background: var(--color-bg);
			border-right: var(--border-width-heavy) solid var(--color-fg);
			transform: translateX(-105%);
			transition: transform 0.18s ease-out;
			z-index: 9;
			width: 240px;
		}

		.sidebar.open {
			transform: translateX(0);
		}

		.content {
			padding: var(--sp-3) var(--sp-3) var(--sp-6);
		}
	}
</style>
