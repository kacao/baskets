# Plan 006: Reject cross-origin WebSocket upgrades on `/ws`

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 3958dd6..HEAD -- src/lib/server/realtime/attach.js`
> If `src/lib/server/realtime/attach.js` changed since this plan was written,
> compare the "Current state" excerpt against the live code before proceeding;
> on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `3958dd6`, 2026-07-12

## Why this matters

The realtime WebSocket endpoint (`/ws`) authenticates a connection by forwarding
the browser's ambient session cookie to `GET /api/me` — but it never checks the
request's `Origin` header. That makes it vulnerable to **Cross-Site WebSocket
Hijacking (CSWSH)**: any web page the victim visits while logged in can open
`ws(s)://<baskets-host>/ws`, the browser attaches the victim's cookie
automatically, and the attacker's page receives presence updates and
project-change broadcasts. Worse, the `subscribe` message replies `ready` vs
`denied` per project id — an oracle an attacker can use to enumerate which
projects the victim can access. Unlike CSRF, the SameSite cookie attribute does
NOT protect WebSocket handshakes reliably, so an explicit origin check is the
standard defense. This plan rejects upgrades whose `Origin` isn't the server's
own origin (or an explicit allowlist), closing the hole with no impact on the
first-party app.

## Current state

- `src/lib/server/realtime/attach.js` — plain-ESM (NO TypeScript, NO `$lib`
  imports) WebSocket transport, imported by BOTH the Vite dev/preview plugin
  (`vite.config.ts`) AND the production server (`server.js`). Its header comment
  is explicit that it must not import app modules. Any new logic here must stay
  dependency-free (Node built-ins + `ws` only).
- The `baseUrl()` helper already computes the server's OWN bound origin (used to
  forward cookies to `/api/me` safely). We can reuse the same bound host/port to
  derive the expected same-origin value.
- Trusted extra origins are already configured for BetterAuth via the
  `TRUSTED_ORIGINS` env var (comma-separated) — see `src/lib/server/auth.ts`
  lines 13–16 and `.env.example` (`TRUSTED_ORIGINS=`). We mirror that config
  name here so operators have ONE place to allowlist a domain. NOTE: `attach.js`
  cannot use SvelteKit's `$env/dynamic/private`; read `process.env.TRUSTED_ORIGINS`
  directly (it is plain ESM run under Node).

### The upgrade handler as it exists today (`attach.js`):

```js
	httpServer.on('upgrade', async (req, socket, head) => {
		let pathname;
		try {
			pathname = new URL(req.url, `http://${req.headers.host}`).pathname;
		} catch {
			return;
		}
		// Only claim our path — leave Vite HMR and any other upgrades untouched.
		if (pathname !== WS_PATH) return;

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
			/* ... registers the client, subscribe/unsubscribe/ping handling ... */
		});
	});
```

Note the existing rejection idiom (write an HTTP status line, then
`socket.destroy()`) — reuse it for the new 403.

### `baseUrl()` — already present, gives the server's own origin:

```js
	let _baseUrl = null;
	function baseUrl() {
		if (!_baseUrl) {
			const addr = httpServer.address();
			// ...derives http://<own-host>:<port> from httpServer.address()...
			_baseUrl = `http://${host}:${addr.port}`;
		}
		return _baseUrl;
	}
```

## Commands you will need

| Purpose        | Command                     | Expected on success                    |
|----------------|-----------------------------|----------------------------------------|
| Typecheck      | `npm run check`             | exit 0, 0 errors, 0 warnings           |
| Unit tests     | `npm run test:unit`         | all pass (baseline: 416 tests)         |
| Start dev srv  | `npm run dev`               | serves on `http://localhost:5173`      |
| Seed DB        | `npm run db:seed`           | seeds admin/demo + sample data         |

`attach.js` has `// @ts-nocheck` at the top, so `npm run check` will not
type-check its body — it still must be valid ESM. The real regression check is
manual: the first-party app's realtime + presence must still connect (Step 3).

## Scope

**In scope** (the only files you should modify):
- `src/lib/server/realtime/attach.js`
- `.env.example` (document the reused `TRUSTED_ORIGINS` also gates `/ws`)

**Out of scope** (do NOT touch):
- `src/lib/server/auth.ts` — it already reads `TRUSTED_ORIGINS`; do not change
  its parsing.
- `vite.config.ts` / `server.js` — they import `attach.js` unchanged; no signature
  change is needed.
- `src/lib/realtime.svelte.ts` (the browser client) — a same-origin client sends
  a matching `Origin` automatically; no client change is required.
- Do NOT add any `$lib`/TS import to `attach.js` (would break the Vite plugin +
  prod server that import it as plain ESM).

## Git workflow

- Work on branch `dev` (already the current branch).
- Commit style: conventional commits, e.g.
  `fix(realtime): reject cross-origin WebSocket upgrades on /ws (CSWSH)`.
- Do NOT push or open a PR unless the operator instructs it.

## Steps

### Step 1: Add an origin-allowlist check before the `/api/me` fetch

In `attach.js`, add a small dependency-free helper (top-level in
`attachRealtime`, near `baseUrl`) that decides whether a request's `Origin` is
allowed. Rules:

- If there is NO `Origin` header, ALLOW. (Non-browser clients — e.g. native tools
  and same-process health checks — omit `Origin`; the CSWSH threat is
  browser-only, and browsers always send `Origin` on a WebSocket handshake.)
- If `Origin` exactly equals the server's own origin (`baseUrl()`), ALLOW.
- If `Origin` (host:port, scheme-insensitive) matches the request's own `Host`
  header, ALLOW. (Covers reverse-proxy / LAN-hostname deploys where the public
  origin differs from the internally-bound `baseUrl()` — e.g. `inspiron:5173`.)
- If `Origin` is in the `TRUSTED_ORIGINS` allowlist (comma-separated
  `process.env.TRUSTED_ORIGINS`, trimmed, empties dropped), ALLOW.
- Otherwise DENY.

Target shape:

```js
	// CSWSH defense (ADR: Realtime): browsers always send Origin on a WS handshake,
	// so reject any cross-origin upgrade before we touch the session cookie. A
	// missing Origin = a non-browser client (no ambient-cookie risk) → allowed.
	const trusted = (process.env.TRUSTED_ORIGINS ?? '')
		.split(',')
		.map((o) => o.trim())
		.filter(Boolean);

	function originAllowed(req) {
		const origin = req.headers.origin;
		if (!origin) return true; // non-browser client
		let host;
		try {
			host = new URL(origin).host;
		} catch {
			return false; // malformed Origin
		}
		if (origin === baseUrl()) return true;
		if (req.headers.host && host === req.headers.host) return true;
		return trusted.includes(origin);
	}
```

Then, inside the `httpServer.on('upgrade', ...)` handler, add the check
immediately after the `if (pathname !== WS_PATH) return;` line and BEFORE the
`/api/me` fetch:

```js
		if (pathname !== WS_PATH) return;

		if (!originAllowed(req)) {
			socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
			socket.destroy();
			return;
		}

		const origin = baseUrl();
		const cookie = req.headers.cookie ?? '';
		// ...unchanged /api/me fetch...
```

Note: the local `const origin = baseUrl()` below is the server's own base URL for
the cookie-forwarding fetch — it is a DIFFERENT variable from `req.headers.origin`.
Keep both; do not rename or conflate them.

**Verify**: `npm run check` → exit 0 (attach.js is `@ts-nocheck`, so this only
confirms the rest of the app still typechecks). Also run:
`node --input-type=module -e "await import('./src/lib/server/realtime/attach.js'); console.log('ok')"`
→ prints `ok` (the module still parses/loads as ESM). If that fails with a module
resolution error unrelated to syntax, skip it and rely on Step 3.

### Step 2: Document the config in `.env.example`

Extend the existing `TRUSTED_ORIGINS` comment block in `.env.example` to note it
also gates `/ws`. Current lines:

```
# Comma-separated extra origins BetterAuth accepts for auth/callback requests.
# Leave empty for a single-origin local deploy; set when serving under a domain.
TRUSTED_ORIGINS=
```

Change the comment to:

```
# Comma-separated extra origins accepted for auth/callback requests AND for the
# realtime WebSocket (/ws) handshake. Leave empty for a single-origin local
# deploy; set when serving the app + WS under a different public domain.
TRUSTED_ORIGINS=
```

(Only the comment changes; leave `TRUSTED_ORIGINS=` empty.)

**Verify**: `git diff .env.example` shows only the comment change.

### Step 3: Manually confirm the first-party app still connects, and a cross-origin handshake is rejected

Start the dev server (`npm run dev`) and seed (`npm run db:seed`) if not already.

**(a) Same-origin still works** — open `http://localhost:5173`, sign in, open a
project. Confirm presence avatars appear in the project header and no `/ws`
connection error is logged in the browser console. (The browser sends
`Origin: http://localhost:5173`, which equals `baseUrl()` → allowed.)

**(b) Cross-origin is rejected** — from a terminal, attempt an upgrade with a
foreign `Origin` and confirm the server refuses it with 403 before auth:

```bash
curl -i -N \
  -H "Connection: Upgrade" -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" \
  -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
  -H "Origin: http://evil.example" \
  http://localhost:5173/ws
```

Expected: the response status line is `HTTP/1.1 403 Forbidden` (NOT `101
Switching Protocols`, NOT `401`). The 403 (rather than 401) confirms the origin
check runs BEFORE the cookie/auth check.

**(c) Missing-Origin still allowed** — repeat (b) WITHOUT the `-H "Origin: ..."`
header. Expected: NOT a 403 (it proceeds to the auth step and returns `401
Unauthorized` because no cookie is sent). This confirms non-browser clients are
not broken.

## Test plan

- This transport has no unit-test harness (plain ESM, no `$lib`), and `/ws` is
  not covered by the integration suite. Verification is the manual matrix in
  Step 3 (same-origin allowed; cross-origin 403; missing-origin passes to auth).
- Record the observed status codes from Step 3 (a/b/c) in your completion report.

## Done criteria

Machine-checkable / observable. ALL must hold:

- [ ] `npm run check` exits 0 with 0 errors / 0 warnings
- [ ] `npm run test:unit` exits 0 (416 tests still pass)
- [ ] Step 3(a): first-party app presence works with no `/ws` console error
- [ ] Step 3(b): cross-origin `curl` handshake returns `HTTP/1.1 403 Forbidden`
- [ ] Step 3(c): missing-Origin handshake is NOT 403 (returns 401 for lack of auth)
- [ ] `attach.js` imports no `$lib`/TS module (`grep -n "\$lib\|from '\.\./" src/lib/server/realtime/attach.js`
      returns nothing new — only the pre-existing `import { WebSocketServer } from 'ws';`)
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The upgrade handler in `attach.js` doesn't match the "Current state" excerpt
  (drift).
- Step 3(a) breaks — the legitimate first-party app can no longer connect to
  `/ws` (the `Host`/`baseUrl()` comparison may be too strict for your deploy;
  report the browser's `Origin` and the server's `baseUrl()` rather than loosening
  the check blindly).
- You find you need a package or `$lib` import to implement the check — the file
  MUST stay plain, dependency-free ESM (STOP and report; do not add a dependency).
- The reverse-proxy case can't satisfy `host === req.headers.host` (e.g. proxy
  strips/rewrites `Host`) — report so the operator can set `TRUSTED_ORIGINS`.

## Maintenance notes

- When the app is deployed behind a new public domain, that origin must be added
  to `TRUSTED_ORIGINS` (same env var BetterAuth already uses) — otherwise the
  browser's `/ws` handshake will 403. Document this in the deploy runbook.
- A reviewer should confirm the check runs BEFORE the `/api/me` fetch (so a
  cross-origin attacker never causes a cookie to be forwarded) and that the
  `req.headers.origin` variable is never confused with the local
  `const origin = baseUrl()` used for the internal fetch.
- If a future change makes the browser client connect from a genuinely different
  origin than it loads from, this check must be revisited alongside it.
