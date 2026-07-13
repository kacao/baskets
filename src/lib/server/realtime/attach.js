// @ts-nocheck — intentionally plain ESM (no TS build step) so server.js can
// `import` it directly at runtime; types live in hub.ts on the app side.
//
// Plain-ESM WebSocket transport for realtime updates + presence (ADR-026).
//
// Imported by BOTH the Vite dev/preview plugin (vite.config.ts) and the
// production server (server.js), so it must avoid any SvelteKit-aliased ($lib)
// imports and TypeScript. Authentication and per-project access checks are
// delegated to the app's OWN HTTP endpoints by forwarding the upgrade request's
// cookies:
//   - GET /api/me            → who is this session? (else reject the upgrade)
//   - GET /api/projects/{id} → 200 = may view, 404 = no access (ADR-019)
// This reuses the existing permission logic without importing app modules. The
// connection registry is kept on `globalThis` so app code (hub.ts) broadcasts
// to the exact same Set this file fills.

import { WebSocketServer } from 'ws';

const WS_PATH = '/ws';
const OPEN = 1;

function clients() {
	globalThis.__basketsRealtime ??= { clients: new Set() };
	return globalThis.__basketsRealtime.clients;
}

function send(ws, obj) {
	try {
		if (ws.readyState === OPEN) ws.send(JSON.stringify(obj));
	} catch {
		/* ignore */
	}
}

function presenceFor(projectId) {
	const seen = new Map();
	for (const c of clients()) if (c.projectId === projectId) seen.set(c.userId, c.userName);
	return [...seen].map(([id, name]) => ({ id, name }));
}

function broadcastPresence(projectId) {
	if (!projectId) return;
	const msg = { type: 'presence', projectId, users: presenceFor(projectId) };
	for (const c of clients()) if (c.projectId === projectId) send(c.ws, msg);
}

/** Attach the /ws upgrade handler + heartbeat to an http.Server. Idempotent. */
export function attachRealtime(httpServer) {
	if (!httpServer || httpServer.__basketsRealtimeAttached) return;
	httpServer.__basketsRealtimeAttached = true;

	const wss = new WebSocketServer({ noServer: true });

	// Resolve the auth/access endpoints from the server's OWN bound port, never the
	// client-supplied Host header — otherwise an attacker sets Host: evil.com and we
	// forward the session cookie to them (SSRF + session leak).
	let _baseUrl = null;
	function baseUrl() {
		if (!_baseUrl) {
			const addr = httpServer.address();
			if (addr && typeof addr === 'object') {
				// use the server's OWN bound address+family — hardcoding 127.0.0.1 breaks
				// when it's bound IPv6-only (e.g. Vite dev binds ::1, refusing IPv4). For a
				// wildcard bind fall back to the matching-family loopback.
				const wildcard = !addr.address || addr.address === '::' || addr.address === '0.0.0.0';
				const host = wildcard
					? addr.family === 'IPv6'
						? '[::1]'
						: '127.0.0.1'
					: addr.family === 'IPv6'
						? `[${addr.address}]`
						: addr.address;
				_baseUrl = `http://${host}:${addr.port}`;
			} else {
				_baseUrl = 'http://127.0.0.1:5173';
			}
		}
		return _baseUrl;
	}

	const trusted = (process.env.TRUSTED_ORIGINS ?? '')
		.split(',')
		.map((o) => o.trim())
		.filter(Boolean);
	function originAllowed(req) {
		const origin = req.headers.origin;
		if (!origin) return true; // non-browser client (no ambient-cookie risk)
		let host;
		try {
			host = new URL(origin).host;
		} catch {
			return false;
		}
		if (origin === baseUrl()) return true;
		if (req.headers.host && host === req.headers.host) return true;
		return trusted.includes(origin);
	}

	httpServer.on('upgrade', async (req, socket, head) => {
		let pathname;
		try {
			pathname = new URL(req.url, `http://${req.headers.host}`).pathname;
		} catch {
			return;
		}
		// Only claim our path — leave Vite HMR and any other upgrades untouched.
		if (pathname !== WS_PATH) return;

		// Reject cross-origin browser upgrades before touching auth (CSWSH defense) —
		// SameSite cookies don't reliably protect the WS handshake, so we check Origin
		// explicitly. Non-browser clients (no Origin header) pass through to auth.
		if (!originAllowed(req)) {
			socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
			socket.destroy();
			return;
		}

		const origin = baseUrl();
		const cookie = req.headers.cookie ?? '';

		let user = null;
		try {
			const res = await fetch(`${origin}/api/me`, { headers: { cookie } });
			if (res.ok) user = (await res.json()).user ?? null;
		} catch {
			/* ignore */
		}
		if (!user) {
			socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
			socket.destroy();
			return;
		}

		wss.handleUpgrade(req, socket, head, (ws) => {
			const client = {
				ws,
				userId: user.id,
				userName: user.name,
				projectId: null,
				isAlive: true
			};
			clients().add(client);

			ws.on('pong', () => (client.isAlive = true));

			ws.on('message', async (raw) => {
				let m;
				try {
					m = JSON.parse(raw.toString());
				} catch {
					return;
				}

				if (m.type === 'subscribe' && typeof m.projectId === 'string') {
					let ok = false;
					try {
						const r = await fetch(`${origin}/api/projects/${encodeURIComponent(m.projectId)}`, {
							headers: { cookie }
						});
						ok = r.ok;
					} catch {
						ok = false;
					}
					if (!ok) {
						send(ws, { type: 'denied', projectId: m.projectId });
						return;
					}
					const prev = client.projectId;
					client.projectId = m.projectId;
					if (prev && prev !== m.projectId) broadcastPresence(prev);
					broadcastPresence(m.projectId);
				} else if (m.type === 'unsubscribe') {
					const prev = client.projectId;
					client.projectId = null;
					if (prev) broadcastPresence(prev);
				} else if (m.type === 'ping') {
					send(ws, { type: 'pong' });
				}
			});

			const drop = () => {
				if (!clients().delete(client)) return;
				if (client.projectId) broadcastPresence(client.projectId);
			};
			ws.on('close', drop);
			ws.on('error', drop);

			send(ws, { type: 'ready' });
		});
	});

	// Heartbeat: terminate sockets that stopped answering so presence stays honest.
	const interval = setInterval(() => {
		for (const c of clients()) {
			if (!c.isAlive) {
				try {
					c.ws.terminate();
				} catch {
					/* ignore */
				}
				if (clients().delete(c) && c.projectId) broadcastPresence(c.projectId);
				continue;
			}
			c.isAlive = false;
			try {
				c.ws.ping();
			} catch {
				/* ignore */
			}
		}
	}, 30000);
	if (interval.unref) interval.unref();

	return wss;
}
