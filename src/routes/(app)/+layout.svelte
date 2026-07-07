<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { fade, slide } from 'svelte/transition';
	import { authClient } from '$lib/auth-client';
	import Toaster from '$lib/components/Toaster.svelte';
	import ConfirmModal from '$lib/components/ConfirmModal.svelte';
	import EntityIcon from '$lib/components/EntityIcon.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import NotificationBell from '$lib/components/NotificationBell.svelte';
	import { t } from '$lib/i18n';
	import { tooltip } from '$lib/tooltip';

	let { data, children } = $props();
	let menuOpen = $state(false);
	let wsMenuOpen = $state(false);
	let apprMenuOpen = $state(false);
	// svelte-ignore state_referenced_locally
	let theme = $state<'light' | 'dark'>(data.theme === 'dark' ? 'dark' : 'light');
	// svelte-ignore state_referenced_locally
	let highContrast = $state(data.contrast === 'high');

	function toggleTheme() {
		theme = theme === 'dark' ? 'light' : 'dark';
		document.documentElement.dataset.theme = theme;
		document.cookie = `theme=${theme}; path=/; max-age=31536000; samesite=lax`;
	}

	function toggleContrast() {
		highContrast = !highContrast;
		document.documentElement.dataset.contrast = highContrast ? 'high' : '';
		document.cookie = highContrast
			? 'contrast=high; path=/; max-age=31536000; samesite=lax'
			: 'contrast=; path=/; max-age=0; samesite=lax';
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

	// Per-project collapsible menu → tasks view + project-settings sections.
	const projectNav = [
		{ label: 'Overview', icon: 'text-box', to: (id: string) => `/projects/${id}/overview` },
		{ label: 'Tasks', icon: 'task-list', to: (id: string) => `/projects/${id}` },
		{ label: 'Milestones', icon: 'triangle-flag', to: (id: string) => `/projects/${id}/milestones` },
		{ label: 'Statuses', icon: 'circle', to: (id: string) => `/projects/${id}/statuses` },
		{ label: 'Labels', icon: 'label', to: (id: string) => `/projects/${id}/labels` },
		{ label: 'Custom fields', icon: 'input-field', to: (id: string) => `/projects/${id}/custom-fields` },
		{ label: 'Locations', icon: 'map-pin', to: (id: string) => `/projects/${id}/locations` },
		{ label: 'Files', icon: 'multiple-pages', to: (id: string) => `/projects/${id}/files` },
		{ label: 'Settings', icon: 'settings', to: (id: string) => `/projects/${id}/settings` }
	];

	let expanded = $state<Record<string, boolean>>({});
	const activeProjectId = $derived(page.url.pathname.match(/^\/projects\/([^/]+)/)?.[1] ?? null);
	$effect(() => {
		if (activeProjectId) expanded[activeProjectId] = true;
	});

	function subActive(href: string) {
		const [path, hash] = href.split('#');
		if (page.url.pathname !== path) return false;
		return hash ? page.url.hash === `#${hash}` : page.url.hash === '';
	}
</script>

<svelte:window
	onclick={() => {
		wsMenuOpen = false;
		apprMenuOpen = false;
	}}
/>

<div class="shell">
	<!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
	<div class="drawer-backdrop" class:open={menuOpen} onclick={() => (menuOpen = false)}></div>
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
								use:tooltip={$t('Workspace settings')}
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
		<div class="nav-section-label">{$t('Projects')}</div>
		{#if currentProjects.length > 0}
			<div class="nav-projects">
				{#each currentProjects as p (p.id)}
					<div class="proj">
						<div class="proj-row" class:active={activeProjectId === p.id}>
							<button
								class="proj-toggle"
								aria-expanded={!!expanded[p.id]}
								aria-label={$t('Toggle project menu')}
								onclick={() => (expanded[p.id] = !expanded[p.id])}
							>
								<span class="proj-chevron" class:open={expanded[p.id]} aria-hidden="true"><Icon name="nav-arrow-right" size={12} /></span>
							</button>
							<a
								href="/projects/{p.id}"
								class="proj-name"
								onclick={() => (menuOpen = false)}
							>
								{#if p.icon}<span class="nav-icon"><EntityIcon value={p.icon} size={14} /></span>{:else if p.pinned}<span class="nav-icon" aria-hidden="true"><Icon name="star" size={12} /></span>{/if}{p.name}
							</a>
						</div>
						{#if expanded[p.id]}
							<div class="proj-sub" transition:slide={{ duration: 150 }}>
								{#each projectNav as item (item.label)}
									{@const href = item.to(p.id)}
									<a
										class="proj-subitem"
										class:active={subActive(href)}
										{href}
										onclick={() => (menuOpen = false)}
									>
										<span class="sub-ic" aria-hidden="true"><Icon name={item.icon} size={13} /></span>{$t(item.label)}
									</a>
								{/each}
							</div>
						{/if}
					</div>
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
			</div>
			<!-- per-page header host: pages portal their header here (e.g. the project
			     page lifts its title / "…" menu / pills / presence into this slot) -->
			<div class="topbar-page" data-page-header></div>
			<div class="u-flex">
				{#if data.user?.role === 'admin'}
					<span class="badge badge-neutral topbar-role">{$t('admin')}</span>
				{/if}
				<span class="u-small u-muted topbar-user">{data.user?.name}</span>
				<NotificationBell />
				<!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
				<div class="appr-wrap" onclick={(e) => e.stopPropagation()}>
					<button
						class="btn btn-sm btn-ghost btn-circle"
						aria-label={$t('Appearance')}
						aria-haspopup="menu"
						aria-expanded={apprMenuOpen}
						use:tooltip={$t('Appearance')}
						onclick={() => (apprMenuOpen = !apprMenuOpen)}
					>
						<Icon name="half-moon" size={16} />
					</button>
					{#if apprMenuOpen}
						<div class="appr-menu" role="menu" transition:slide={{ duration: 120 }}>
							<button class="appr-item" role="menuitemcheckbox" aria-checked={theme === 'dark'} onclick={toggleTheme}>
								<span class="appr-check">{#if theme === 'dark'}<Icon name="check" size={14} />{/if}</span>
								<Icon name={theme === 'dark' ? 'sun-light' : 'half-moon'} size={14} />
								<span class="appr-label">{$t('Dark mode')}</span>
							</button>
							<button class="appr-item" role="menuitemcheckbox" aria-checked={highContrast} onclick={toggleContrast}>
								<span class="appr-check">{#if highContrast}<Icon name="check" size={14} />{/if}</span>
								<Icon name="color-filter" size={14} />
								<span class="appr-label">{$t('High contrast')}</span>
							</button>
						</div>
					{/if}
				</div>
				<button class="btn btn-sm" onclick={signOut}>{$t('Sign out')}</button>
			</div>
		</header>

		<div class="main-body" data-pane-host>
			{#key page.url.pathname}
				<main class="content">
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
		scrollbar-gutter: stable;
		background: var(--color-bg);
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

	.appr-wrap {
		position: relative;
		display: inline-flex;
	}

	.appr-menu {
		position: absolute;
		top: calc(100% + 4px);
		right: 0;
		z-index: 30;
		min-width: 184px;
		border: 1px solid var(--color-border-subtle);
		background: var(--color-bg);
		box-shadow: var(--shadow);
		display: flex;
		flex-direction: column;
		padding: 4px;
	}

	.appr-item {
		display: flex;
		align-items: center;
		gap: var(--sp-1);
		width: 100%;
		border: none;
		background: none;
		font-family: var(--font-body);
		font-size: 13px;
		color: var(--color-fg);
		text-align: left;
		padding: 6px 8px;
		cursor: pointer;
		border-radius: var(--radius-field, 0.25rem);
		transition: background var(--dur-fast) ease;
	}

	.appr-item:hover {
		background: var(--color-surface-muted);
	}

	.appr-check {
		flex: 0 0 auto;
		width: 14px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		color: var(--color-fg);
	}

	.appr-label {
		flex: 1;
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
		justify-content: center;
		flex: 0 0 auto;
		color: var(--color-muted);
		min-width: 32px;
		padding: 8px;
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
		/* extend under the notch (viewport-fit=cover) but keep content clear of it */
		padding: max(var(--sp-2), env(safe-area-inset-top)) max(var(--sp-3), env(safe-area-inset-right))
			var(--sp-2) max(var(--sp-3), env(safe-area-inset-left));
		border-bottom: 1px solid var(--color-border-subtle);
		background: var(--color-bg);
		position: sticky;
		top: 0;
		z-index: 10;
	}

	/* center slot that pages portal their header into; empty (just flex space) on
	   pages that don't set one, so brand stays left + user controls stay right */
	.topbar-page {
		flex: 1 1 auto;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: var(--sp-2);
	}

	.topbar-page:empty {
		display: none;
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

	.nav-section-label {
		font-size: 11px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--color-muted);
		padding: var(--sp-2) var(--sp-3) var(--sp-1);
	}

	.nav-projects {
		display: flex;
		flex-direction: column;
		gap: 1px;
		margin-bottom: var(--sp-1);
	}

	.proj-row {
		display: flex;
		align-items: center;
		gap: 2px;
		padding-right: var(--sp-2);
		transition: background var(--dur-fast) ease;
	}

	.proj-row:hover {
		background: var(--color-surface-muted);
	}

	.proj-toggle {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex: 0 0 auto;
		width: 22px;
		height: 26px;
		border: none;
		background: none;
		color: var(--color-muted);
		cursor: pointer;
		padding: 0;
		transition: color var(--dur-fast) ease;
	}

	.proj-toggle:hover {
		color: var(--color-fg);
	}

	.proj-chevron {
		display: inline-flex;
		transition: transform var(--dur-fast) ease;
	}

	.proj-chevron.open {
		transform: rotate(90deg);
	}

	.proj-name {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		font-family: var(--font-body);
		font-size: 13px;
		font-weight: 400;
		color: var(--color-muted);
		text-decoration: none;
		padding: var(--sp-1) 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		transition: color var(--dur-fast) ease;
	}

	.proj-row:hover .proj-name {
		color: var(--color-fg);
	}

	.proj-row.active .proj-name {
		color: var(--color-fg);
		font-weight: 600;
	}

	.proj-sub {
		display: flex;
		flex-direction: column;
		gap: 1px;
		padding-bottom: var(--sp-1);
	}

	.proj-subitem {
		display: flex;
		align-items: center;
		gap: var(--sp-1);
		font-size: 12px;
		font-weight: 400;
		color: var(--color-muted);
		text-decoration: none;
		padding: 3px var(--sp-3) 3px calc(var(--sp-3) + 22px);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		transition:
			background var(--dur-fast) ease,
			color var(--dur-fast) ease;
	}

	.proj-subitem:hover {
		color: var(--color-fg);
		background: var(--color-surface-muted);
	}

	.proj-subitem.active {
		color: var(--color-fg);
		font-weight: 600;
	}

	.sub-ic {
		display: inline-flex;
		flex: 0 0 auto;
		color: var(--color-muted);
	}

	.proj-subitem:hover .sub-ic,
	.proj-subitem.active .sub-ic {
		color: inherit;
	}

	.content {
		flex: 1;
		min-width: 0;
		overflow: scroll;
		padding: var(--sp-4) var(--sp-4) var(--sp-7);
		/* subtle page swap: replays on each navigation via the {#key} remount.
		   Barely-there (never fully blanks) so list pages' .stagger-in cascade
		   reads as the motion, not a big-block blink. */
		animation: pageFade 140ms ease-out both;
	}

	@keyframes pageFade {
		from {
			opacity: 0.5;
		}
		to {
			opacity: 1;
		}
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

		.topbar-user,
		/* the "admin" role badge is decorative — reclaim its width on mobile so the
		   project title gets room and the right controls don't overflow */
		.topbar-role {
			display: none;
		}

		.sidebar {
			position: fixed;
			/* start below the topbar. Its height = content(≈49px) + its own
			   padding-top, which is max(--sp-2, notch inset) — so mirror that
			   max() here rather than adding the inset twice. */
			top: calc(49px + max(var(--sp-2), env(safe-area-inset-top)));
			left: 0;
			bottom: 0;
			height: auto;
			padding-bottom: max(var(--sp-4), env(safe-area-inset-bottom));
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
