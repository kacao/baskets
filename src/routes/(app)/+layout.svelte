<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { authClient } from '$lib/auth-client';

	let { data, children } = $props();
	let menuOpen = $state(false);

	const nav = [
		{ href: '/projects', label: 'Projects' },
		{ href: '/integrations', label: 'Integrations' },
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
			<a href="/projects" class="wordmark">Baskets</a>
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
				{#if item.href === '/projects' && data.projects.length > 0}
					<div class="nav-sub">
						{#each data.projects as p (p.id)}
							<a
								href="/projects/{p.id}"
								class="nav-sublink"
								class:active={page.url.pathname === `/projects/${p.id}`}
								onclick={() => (menuOpen = false)}
							>
								{p.name}
							</a>
						{/each}
					</div>
				{/if}
				{#if item.href === '/settings' && data.user?.role === 'admin'}
					<div class="nav-sub">
						<a
							href="/settings/statuses"
							class="nav-sublink"
							class:active={page.url.pathname === '/settings/statuses'}
							onclick={() => (menuOpen = false)}
						>
							Statuses
						</a>
						<a
							href="/settings/labels"
							class="nav-sublink"
							class:active={page.url.pathname === '/settings/labels'}
							onclick={() => (menuOpen = false)}
						>
							Labels
						</a>
					</div>
				{/if}
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
		border-bottom: 1px solid var(--color-border-subtle);
		background: var(--color-bg);
		position: sticky;
		top: 0;
		z-index: 10;
	}

	.wordmark {
		font-family: var(--font-headline);
		font-size: 18px;
		font-weight: 700;
		letter-spacing: var(--heading-tracking);
		color: var(--color-fg);
		text-decoration: none;
		padding: 2px 0;
	}

	.hamburger {
		display: none;
		border: 1px solid var(--color-border-subtle);
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
		border-right: 1px solid var(--color-border-subtle);
		padding: var(--sp-4) 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.nav-link {
		font-family: var(--font-body);
		font-weight: 400;
		font-size: 14px;
		color: var(--color-muted);
		text-decoration: none;
		padding: var(--sp-1) var(--sp-3);
		transition:
			background 0.15s ease,
			color 0.15s ease;
	}

	.nav-link:hover {
		color: var(--color-fg);
		background: var(--color-surface-muted);
	}

	.nav-link.active {
		color: var(--color-fg);
		font-weight: 600;
	}

	.nav-sub {
		display: flex;
		flex-direction: column;
		gap: 2px;
		margin-bottom: var(--sp-1);
	}

	.nav-sublink {
		font-family: var(--font-body);
		font-weight: 400;
		font-size: 13px;
		color: var(--color-muted);
		text-decoration: none;
		padding: 2px var(--sp-3) 2px var(--sp-4);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		transition:
			background 0.15s ease,
			color 0.15s ease;
	}

	.nav-sublink:hover {
		color: var(--color-fg);
		background: var(--color-surface-muted);
	}

	.nav-sublink.active {
		color: var(--color-fg);
		font-weight: 600;
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
			border-right: 1px solid var(--color-border-subtle);
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
