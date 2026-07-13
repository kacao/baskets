<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { popover } from '$lib/transitions';
	import { tooltip } from '$lib/tooltip';
	import { t } from '$lib/i18n';
	import Icon from '$lib/components/Icon.svelte';

	type Notification = {
		id: string;
		type: string;
		body: string;
		projectId: string | null;
		taskId: string | null;
		organizationId: string | null;
		read: boolean;
		createdAt: string;
	};

	// notifications may span the user's orgs (D7); tag rows from a non-active org
	// with its name so a cross-org item reads coherently.
	const orgs = $derived((page.data.orgs as { id: string; name: string }[] | undefined) ?? []);
	const currentOrgId = $derived(
		(page.data.currentOrg as { id: string } | null | undefined)?.id ?? null
	);
	function foreignOrgName(id: string | null): string | null {
		if (!id || id === currentOrgId) return null;
		return orgs.find((o) => o.id === id)?.name ?? null;
	}

	let open = $state(false);
	let loading = $state(false);
	let notifications = $state<Notification[]>([]);
	let unread = $state(0);
	let wrap = $state<HTMLElement | null>(null);

	const close = () => (open = false);

	const onWindowClick = (e: MouseEvent) => {
		if (open && wrap && !wrap.contains(e.target as Node)) close();
	};

	async function load() {
		loading = true;
		try {
			const res = await fetch('/api/notifications');
			if (!res.ok) return;
			const data = await res.json();
			notifications = data.notifications ?? [];
			unread = data.unreadCount ?? 0;
		} catch {
			// network hiccup — leave previous state
		} finally {
			loading = false;
		}
	}

	function toggle() {
		open = !open;
		if (open) void load();
	}

	async function onClickNotification(n: Notification) {
		if (!n.read) {
			n.read = true;
			unread = Math.max(0, unread - 1);
			try {
				await fetch(`/api/notifications/${n.id}`, { method: 'POST' });
			} catch {
				// best-effort
			}
		}
		close();
		if (n.projectId) {
			const url = n.taskId
				? `/projects/${n.projectId}?task=${n.taskId}`
				: `/projects/${n.projectId}`;
			void goto(url);
		}
	}

	async function markAll() {
		notifications = notifications.map((n) => ({ ...n, read: true }));
		unread = 0;
		try {
			await fetch('/api/notifications/read-all', { method: 'POST' });
		} catch {
			// best-effort
		}
	}

	function relativeTime(iso: string): string {
		const then = new Date(iso).getTime();
		if (Number.isNaN(then)) return '';
		const diff = Date.now() - then;
		const min = Math.round(diff / 60000);
		if (min < 1) return $t('just now');
		if (min < 60) return $t('{n}m ago', { n: min });
		const hr = Math.round(min / 60);
		if (hr < 24) return $t('{n}h ago', { n: hr });
		const day = Math.round(hr / 24);
		return $t('{n}d ago', { n: day });
	}

	onMount(() => {
		void load();
	});
</script>

<svelte:window onclick={onWindowClick} />

<div class="bell-wrap" bind:this={wrap}>
	<button
		class="btn btn-sm btn-ghost btn-circle bell-trigger"
		type="button"
		aria-haspopup="dialog"
		aria-expanded={open}
		aria-label={$t('Notifications')}
		use:tooltip={$t('Notifications')}
		onclick={toggle}
	>
		<Icon name="bell" size={16} />
		{#if unread > 0}
			<span class="bell-badge" aria-hidden="true">{unread > 99 ? '99+' : unread}</span>
		{/if}
	</button>

	{#if open}
		<div class="bell-pop" role="dialog" aria-label={$t('Notifications')} transition:popover>
			<div class="bell-head">
				<span class="u-small">{$t('Notifications')}</span>
				{#if unread > 0}
					<button class="btn btn-xs btn-ghost" type="button" onclick={markAll}>
						{$t('Mark all read')}
					</button>
				{/if}
			</div>
			<div class="bell-list">
				{#if loading && notifications.length === 0}
					<div class="bell-empty u-small u-muted">{$t('Loading…')}</div>
				{:else if notifications.length === 0}
					<div class="bell-empty u-small u-muted">{$t('No notifications')}</div>
				{:else}
					{#each notifications as n (n.id)}
						<button
							class="bell-item"
							class:unread={!n.read}
							type="button"
							onclick={() => onClickNotification(n)}
						>
							{#if !n.read}<span class="bell-dot" aria-hidden="true"></span>{/if}
							<span class="bell-body">
								{n.body}
								{#if foreignOrgName(n.organizationId)}
									<span class="bell-org">{foreignOrgName(n.organizationId)}</span>
								{/if}
							</span>
							<span class="bell-time u-small u-muted">{relativeTime(n.createdAt)}</span>
						</button>
					{/each}
				{/if}
			</div>
		</div>
	{/if}
</div>

<style>
	.bell-wrap {
		position: relative;
		display: inline-flex;
	}
	.bell-trigger {
		position: relative;
	}
	.bell-badge {
		position: absolute;
		top: -2px;
		right: -2px;
		min-width: 16px;
		height: 16px;
		padding: 0 3px;
		border-radius: 999px;
		background: var(--color-error, #e11d48);
		color: #fff;
		font-size: 10px;
		line-height: 16px;
		text-align: center;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}
	.bell-pop {
		position: absolute;
		top: calc(100% + 6px);
		right: 0;
		z-index: 50;
		width: 320px;
		max-width: 90vw;
		background: var(--color-base-100, #fff);
		border: 1px solid var(--color-base-300, #e5e7eb);
		border-radius: 0.5rem;
		box-shadow:
			0 1px 2px rgba(0, 0, 0, 0.06),
			0 8px 24px rgba(0, 0, 0, 0.14);
		overflow: hidden;
	}
	.bell-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.5rem 0.75rem;
		border-bottom: 1px solid var(--color-base-300, #e5e7eb);
		font-weight: 600;
	}
	.bell-list {
		max-height: 360px;
		overflow-y: auto;
	}
	.bell-empty {
		padding: 1rem 0.75rem;
		text-align: center;
	}
	.bell-item {
		display: flex;
		align-items: flex-start;
		gap: 0.5rem;
		width: 100%;
		padding: 0.5rem 0.75rem;
		text-align: left;
		background: none;
		border: none;
		border-bottom: 1px solid var(--color-base-200, #f3f4f6);
		cursor: pointer;
		font: inherit;
		color: inherit;
		transition: background var(--dur-fast, 100ms);
	}
	.bell-item:hover {
		background: var(--color-base-200, #f3f4f6);
	}
	.bell-item.unread {
		background: var(--color-base-200, #f3f4f6);
	}
	.bell-dot {
		flex: 0 0 auto;
		width: 8px;
		height: 8px;
		margin-top: 5px;
		border-radius: 999px;
		background: var(--color-primary, #2563eb);
	}
	.bell-body {
		flex: 1 1 auto;
		min-width: 0;
		word-break: break-word;
	}
	.bell-org {
		display: inline-block;
		margin-left: 4px;
		padding: 0 5px;
		border-radius: 999px;
		background: var(--color-base-300, #e5e7eb);
		color: var(--color-base-content, #374151);
		font-size: 10px;
		font-weight: 600;
		line-height: 15px;
		vertical-align: middle;
		white-space: nowrap;
	}
	.bell-time {
		flex: 0 0 auto;
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
	}
</style>
