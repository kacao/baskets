<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { fade } from 'svelte/transition';
	import { authClient } from '$lib/auth-client';
	import Toaster from '$lib/components/Toaster.svelte';
	import ConfirmModal from '$lib/components/ConfirmModal.svelte';
	import EntityIcon from '$lib/components/EntityIcon.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { t } from '$lib/i18n';

	let { data, children } = $props();
	let menuOpen = $state(false);
	let wsMenuOpen = $state(false);
	// svelte-ignore state_referenced_locally
	let theme = $state<'light' | 'dark'>(data.theme === 'dark' ? 'dark' : 'light');

	function toggleTheme() {
		theme = theme === 'dark' ? 'light' : 'dark';
		document.documentElement.dataset.theme = theme;
		document.cookie = `theme=${theme}; path=/; max-age=31536000; samesite=lax`;
	}


	const currentWorkspace = $derived(
		data.workspaces.find((w) => w.id === data.currentWorkspaceId) ?? data.workspaces[0]
	);
	const currentProjects = $derived(
		data.projects.filter((p) => p.workspaceId === currentWorkspace?.id)
	);

	function switchWorkspace(id: string) {
		document.cookie = `workspace=${encodeURIComponent(id)}; path=/; max-age=31536000; samesite=lax`;
		wsMenuOpen = false;
		// land on Projects (the current project may not belong to the new workspace)
		goto('/projects', { invalidateAll: true });
	}

	async function signOut() {
		await authClient.signOut();
		await goto('/login');
	}

	function isActive(href: string) {
		return page.url.pathname === href || page.url.pathname.startsWith(href + '/');
	}
</script>

<svelte:window onclick={() => (wsMenuOpen = false)} />

<div class="shell">
	<nav class="sidebar" class:open={menuOpen}>
		<!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
		<div class="ws-switch" onclick={(e) => e.stopPropagation()}>
			<button
				class="ws-current"
				aria-expanded={wsMenuOpen}
				aria-label={$t('Switch workspace')}
				onclick={() => (wsMenuOpen = !wsMenuOpen)}
			>
				<span class="ws-name">{currentWorkspace?.name ?? 'Baskets'}</span>
				<span class="ws-chevron" class:open={wsMenuOpen} aria-hidden="true"><Icon name="nav-arrow-down" size={12} /></span>
			</button>
			{#if wsMenuOpen}
				<div class="ws-menu" transition:fade={{ duration: 100 }}>
					{#each data.workspaces as w (w.id)}
						<div class="ws-row" class:active={w.id === currentWorkspace?.id}>
							<button class="ws-item" onclick={() => switchWorkspace(w.id)}>
								{w.name}
							</button>
							<a
								class="ws-gear"
								href="/workspaces/{w.id}/settings"
								aria-label={$t('Workspace settings')}
								title={$t('Workspace settings')}
								onclick={() => {
									wsMenuOpen = false;
									menuOpen = false;
								}}
							>
								<Icon name="settings" size={14} />
							</a>
						</div>
					{/each}
					<a
						class="ws-item ws-manage"
						href="/workspaces"
						onclick={() => {
							wsMenuOpen = false;
							menuOpen = false;
						}}
					>
						{$t('Manage workspaces')}
					</a>
				</div>
			{/if}
		</div>
		<a
			href="/projects"
			class="nav-link"
			class:active={isActive('/projects')}
			onclick={() => (menuOpen = false)}
		>
			{$t('Projects')}
		</a>
		{#if currentProjects.length > 0}
			<div class="nav-sub">
				{#each currentProjects as p (p.id)}
					<a
						href="/projects/{p.id}"
						class="nav-sublink"
						class:active={page.url.pathname === `/projects/${p.id}`}
						onclick={() => (menuOpen = false)}
					>
						{#if p.icon}<span class="nav-icon"><EntityIcon value={p.icon} size={14} /></span>{:else if p.pinned}<span aria-hidden="true" style="margin-right: 4px;"><Icon name="star" size={12} /></span>{/if}{p.name}
					</a>
				{/each}
			</div>
		{/if}
		{#if data.user?.role === 'admin'}
			<a
				href="/admin"
				class="nav-link"
				class:active={isActive('/admin')}
				onclick={() => (menuOpen = false)}
			>
				{$t('Users')}
			</a>
		{/if}

		<div class="nav-bottom">
			<a
				href="/integrations"
				class="nav-link"
				class:active={isActive('/integrations')}
				onclick={() => (menuOpen = false)}
			>
				{$t('Integrations')}
			</a>
			<a
				href="/settings"
				class="nav-link"
				class:active={isActive('/settings')}
				onclick={() => (menuOpen = false)}
			>
				{$t('Settings')}
			</a>
			{#if data.user?.role === 'admin'}
				<div class="nav-sub">
					<a
						href="/settings/statuses"
						class="nav-sublink"
						class:active={page.url.pathname === '/settings/statuses'}
						onclick={() => (menuOpen = false)}
					>
						{$t('Statuses')}
					</a>
				</div>
			{/if}
		</div>
	</nav>

	<div class="main">
		<header class="topbar">
			<div class="u-flex">
				<button
					class="hamburger"
					aria-label={$t('Toggle menu')}
					aria-expanded={menuOpen}
					onclick={() => (menuOpen = !menuOpen)}
				>
					{#if menuOpen}<Icon name="xmark" size={20} />{:else}<Icon name="menu" size={20} />{/if}
				</button>
				<a href="/projects" class="wordmark topbar-brand">Baskets</a>
			</div>
			<div class="u-flex">
				{#if data.user?.role === 'admin'}
					<span class="badge badge-neutral">{$t('admin')}</span>
				{/if}
				<span class="u-small u-muted topbar-user">{data.user?.name}</span>
				<button
					class="btn btn-sm btn-ghost btn-circle"
					aria-label={$t('Toggle theme')}
					title={theme === 'dark' ? $t('Light mode') : $t('Dark mode')}
					onclick={toggleTheme}
				>
					{#if theme === 'dark'}<Icon name="sun-light" size={16} />{:else}<Icon name="half-moon" size={16} />{/if}
				</button>
				<button class="btn btn-sm" onclick={signOut}>{$t('Sign out')}</button>
			</div>
		</header>

		<div class="main-body" data-pane-host>
			{#key page.url.pathname}
				<main class="content" in:fade={{ duration: 150 }}>
					{@render children()}
				</main>
			{/key}
		</div>
	</div>
</div>

<Toaster />
<ConfirmModal />

<style>
	.shell {
		/* fixed-height shell so .content owns its scroll and the pane sits beside it */
		height: 100dvh;
		display: flex;
		align-items: stretch;
	}

	.sidebar {
		width: 200px;
		flex-shrink: 0;
		border-right: 1px solid var(--color-border-subtle);
		padding: var(--sp-3) 0 var(--sp-4);
		display: flex;
		flex-direction: column;
		gap: 2px;
		position: sticky;
		top: 0;
		height: 100vh;
		overflow-y: auto;
		background: var(--color-bg);
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

	.topbar-brand {
		display: none;
	}

	.ws-switch {
		padding: 0 var(--sp-2) var(--sp-2);
		position: relative;
	}

	.ws-current {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--sp-1);
		width: 100%;
		border: none;
		background: none;
		cursor: pointer;
		font-family: var(--font-headline);
		font-size: 16px;
		font-weight: 700;
		letter-spacing: var(--heading-tracking);
		color: var(--color-fg);
		padding: var(--sp-1) var(--sp-2);
		text-align: left;
		transition: background var(--dur-fast) ease;
	}

	.ws-current:hover {
		background: var(--color-surface-muted);
	}

	.ws-name {
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}

	.ws-chevron {
		font-size: 12px;
		color: var(--color-muted);
		transition: transform var(--dur-fast) ease;
	}

	.ws-chevron.open {
		transform: rotate(180deg);
	}

	.ws-menu {
		position: absolute;
		top: calc(100% - var(--sp-2) + 2px);
		left: var(--sp-2);
		right: var(--sp-2);
		z-index: 30;
		border: 1px solid var(--color-border-subtle);
		background: var(--color-bg);
		box-shadow: var(--shadow);
		display: flex;
		flex-direction: column;
	}

	.ws-item {
		display: block;
		width: 100%;
		border: none;
		background: none;
		font-family: var(--font-body);
		font-size: 13px;
		font-weight: 400;
		color: var(--color-muted);
		text-align: left;
		text-decoration: none;
		padding: var(--sp-1) var(--sp-2);
		cursor: pointer;
		transition:
			background var(--dur-fast) ease,
			color var(--dur-fast) ease;
	}

	.ws-item:hover {
		color: var(--color-fg);
		background: var(--color-surface-muted);
	}

	/* workspace row: switch button (flex) + a settings gear revealed on hover/active */
	.ws-row {
		display: flex;
		align-items: center;
	}

	.ws-row:hover {
		background: var(--color-surface-muted);
	}

	.ws-row .ws-item {
		flex: 1;
		width: auto;
		min-width: 0;
	}

	.ws-row:hover .ws-item {
		color: var(--color-fg);
	}

	.ws-row.active .ws-item {
		color: var(--color-fg);
		font-weight: 600;
	}

	.ws-gear {
		display: inline-flex;
		align-items: center;
		flex: 0 0 auto;
		color: var(--color-muted);
		padding: 4px 8px;
		opacity: 0;
		transition:
			opacity var(--dur-fast) ease,
			color var(--dur-fast) ease;
	}

	.ws-gear:hover {
		color: var(--color-fg);
	}

	.ws-row:hover .ws-gear,
	.ws-row.active .ws-gear,
	.ws-gear:focus-visible {
		opacity: 1;
	}

	.ws-manage {
		border-top: 1px solid var(--color-border-subtle);
		font-size: 12px;
	}

	.main {
		flex: 1;
		min-width: 0;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}

	/* portal host ([data-pane-host]) + horizontal row: .content (scrolls) | pane */
	.main-body {
		flex: 1;
		min-height: 0;
		display: flex;
		align-items: stretch;
		/* clip the SidePane's slide-in transform (fly starts at translateX(16px),
		   16px past the right edge) so it can't overflow the document and flash a
		   page-level horizontal scrollbar. -x: clip keeps vertical visible and
		   doesn't capture .content's own horizontal scroll. */
		overflow-x: clip;
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

	.nav-link {
		font-family: var(--font-body);
		font-weight: 400;
		font-size: 14px;
		color: var(--color-muted);
		text-decoration: none;
		padding: var(--sp-1) var(--sp-3);
		transition:
			background var(--dur-fast) ease,
			color var(--dur-fast) ease;
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

	.nav-bottom {
		margin-top: auto;
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding-top: var(--sp-2);
		border-top: 1px solid var(--color-border-subtle);
	}

	.nav-sublink {
		font-family: var(--font-body);
		font-weight: 400;
		font-size: 13px;
		color: var(--color-muted);
		text-decoration: none;
		padding: 2px var(--sp-3);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		transition:
			background var(--dur-fast) ease,
			color var(--dur-fast) ease;
	}

	.nav-sublink:hover {
		color: var(--color-fg);
		background: var(--color-surface-muted);
	}

	.nav-sublink.active {
		color: var(--color-fg);
		font-weight: 600;
	}

	.nav-icon {
		display: inline-flex;
		vertical-align: middle;
		margin-right: 4px;
	}

	.content {
		flex: 1;
		min-width: 0;
		overflow: scroll;
		padding: var(--sp-4) var(--sp-4) var(--sp-7);
	}

	/* When a SidePane is open it sets --pane-w on the host; keep the content's
	   children at their pre-open width so .content scrolls instead of reflowing
	   them (the pane resizes .content, not its children). */
	.content > :global(*) {
		min-width: calc(100% + var(--pane-w, 0px));
	}

	@media (max-width: 900px) {
		/* pane is a fixed full-width overlay here — don't reserve space for it */
		.content > :global(*) {
			min-width: 100%;
		}
	}

	@media (max-width: 720px) {
		.hamburger {
			display: block;
		}

		.topbar-brand {
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
			height: auto;
			background: var(--color-bg);
			border-right: 1px solid var(--color-border-subtle);
			transform: translateX(-105%);
			transition: transform var(--dur-slow) ease-out;
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
