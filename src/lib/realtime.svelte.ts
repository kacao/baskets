// Browser realtime client (ADR-026): one shared WebSocket per tab. Subscribes to
// the project being viewed; on a `changed` broadcast it debounces an
// invalidateAll() (refetch model — reuses every server-side permission filter);
// on a `presence` broadcast it updates `presence.users`. Reconnects with backoff
// and pings to keep the socket alive. No-ops gracefully if the socket is absent.

import { browser } from '$app/environment';
import { invalidateAll } from '$app/navigation';

export type PresenceUser = { id: string; name: string };

export const presence = $state<{ users: PresenceUser[] }>({ users: [] });

let ws: WebSocket | null = null;
let currentProjectId: string | null = null;
let started = false;
let backoff = 1000;
let heartbeat: ReturnType<typeof setInterval> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let invalidateTimer: ReturnType<typeof setTimeout> | null = null;

function sendJson(obj: unknown) {
	if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

function scheduleInvalidate() {
	if (invalidateTimer) return;
	invalidateTimer = setTimeout(() => {
		invalidateTimer = null;
		void invalidateAll();
	}, 250);
}

function connect() {
	if (!browser) return;
	const proto = location.protocol === 'https:' ? 'wss' : 'ws';
	try {
		ws = new WebSocket(`${proto}://${location.host}/ws`);
	} catch {
		scheduleReconnect();
		return;
	}

	ws.addEventListener('open', () => {
		backoff = 1000;
		if (currentProjectId) sendJson({ type: 'subscribe', projectId: currentProjectId });
		heartbeat = setInterval(() => sendJson({ type: 'ping' }), 25000);
	});

	ws.addEventListener('message', (e) => {
		let m: { type?: string; projectId?: string; users?: PresenceUser[] };
		try {
			m = JSON.parse(e.data);
		} catch {
			return;
		}
		if (m.type === 'changed' && m.projectId === currentProjectId) scheduleInvalidate();
		else if (m.type === 'presence' && m.projectId === currentProjectId)
			presence.users = m.users ?? [];
	});

	ws.addEventListener('close', () => {
		if (heartbeat) clearInterval(heartbeat);
		heartbeat = null;
		ws = null;
		scheduleReconnect();
	});

	ws.addEventListener('error', () => {
		try {
			ws?.close();
		} catch {
			/* ignore */
		}
	});
}

function scheduleReconnect() {
	if (reconnectTimer || !started) return;
	reconnectTimer = setTimeout(() => {
		reconnectTimer = null;
		connect();
	}, backoff);
	backoff = Math.min(backoff * 2, 15000);
}

/** Start (if needed) and switch the live subscription to `projectId`. */
export function subscribeProject(projectId: string) {
	if (!browser) return;
	currentProjectId = projectId;
	presence.users = [];
	if (!started) {
		started = true;
		connect();
	} else {
		sendJson({ type: 'subscribe', projectId });
	}
}

/** Stop receiving updates for the current project (keeps the socket for reuse). */
export function unsubscribeProject() {
	if (!browser) return;
	if (currentProjectId) sendJson({ type: 'unsubscribe' });
	currentProjectId = null;
	presence.users = [];
}
