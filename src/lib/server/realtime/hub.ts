// App-side handle to the realtime hub (ADR-026).
//
// The hub's state — the set of live WebSocket connections — lives on `globalThis`
// so it is shared across module realms within a single process. In dev, the Vite
// plugin's WebSocket server (attach.js) and SvelteKit's SSR code run in DIFFERENT
// module realms; in prod they share Node's module system. Either way `globalThis`
// is the one source of truth, so this file and attach.js agree on the same Set.
//
// This module has ZERO dependencies (no `ws` import) so it can be pulled into the
// SvelteKit SSR bundle cheaply; it only ever calls `.send()` on stored sockets.

export type RealtimeClient = {
	ws: { send(data: string): void; readyState: number };
	userId: string;
	userName: string;
	projectId: string | null;
	isAlive: boolean;
};

type HubState = { clients: Set<RealtimeClient> };

function hub(): HubState {
	const g = globalThis as unknown as { __basketsRealtime?: HubState };
	g.__basketsRealtime ??= { clients: new Set<RealtimeClient>() };
	return g.__basketsRealtime;
}

/**
 * Fire-and-forget: tell everyone currently viewing `projectId` that its data
 * changed so their pages refetch (invalidate + refetch model). The actor is
 * skipped — their own page already updated via the form `enhance` callback.
 * Never throws; realtime must not break a mutation.
 */
export function broadcastProjectChange(projectId: string, actorUserId?: string) {
	try {
		const msg = JSON.stringify({ type: 'changed', projectId });
		for (const c of hub().clients) {
			if (c.projectId !== projectId) continue;
			if (actorUserId && c.userId === actorUserId) continue;
			try {
				if (c.ws.readyState === 1) c.ws.send(msg);
			} catch {
				/* dead socket; the transport layer's heartbeat prunes it */
			}
		}
	} catch {
		/* never let realtime break a mutation */
	}
}
