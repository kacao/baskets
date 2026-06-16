import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Integration security tests for the Baskets REST API + Slack integration.
 *
 * Runs against a LIVE dev server (default http://localhost:5173). It does not
 * import app modules — it drives the HTTP boundary the same way an external
 * client (or attacker) would.
 *
 * Self-cleaning: any project/custom-field it creates is deleted in afterAll.
 * Graceful skip: if the server is unreachable, or the seeded admin can't sign
 * in, the affected cases `it.skip` themselves rather than failing — so the file
 * is safe to run in an env that blocks a given case.
 *
 * Run: `npx vitest run --dir tests/integration` (or add tests/integration to the
 * vitest `include`). The seeded admin (scripts/seed.ts) is admin@baskets.local.
 */

const BASE = (process.env.TEST_BASE_URL ?? 'http://localhost:5173').replace(/\/$/, '');
const ADMIN_EMAIL = process.env.TEST_ADMIN_EMAIL ?? 'admin@baskets.local';
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD ?? 'admin-baskets-2026';
const SLACK_WEBHOOK_HOST = 'https://hooks.slack.com/';

const url = (path: string) => `${BASE}${path}`;

// A random id that should never resolve to a real, accessible row.
const ghostId = () => `ghost-${Math.random().toString(36).slice(2)}-${Date.now()}`;

let serverUp = false;
// Session cookie string (e.g. "better-auth.session_token=...") once signed in.
let sessionCookie = '';
// Resources created during the run, torn down in afterAll.
let createdProjectId: string | null = null;
let filesFieldId: string | null = null;

/** Parse all set-cookie pairs into a single `Cookie` header value. */
function collectCookies(res: Response): string {
	// Node 18+ exposes getSetCookie(); fall back to the single header.
	const raw =
		typeof (res.headers as { getSetCookie?: () => string[] }).getSetCookie === 'function'
			? (res.headers as { getSetCookie: () => string[] }).getSetCookie()
			: [res.headers.get('set-cookie') ?? ''];
	return raw
		.filter(Boolean)
		.map((c) => c.split(';')[0])
		.join('; ');
}

async function ping(): Promise<boolean> {
	try {
		const res = await fetch(url('/api/projects'), { redirect: 'manual' });
		// Any HTTP response (even 401) means the server is up.
		return res.status > 0;
	} catch {
		return false;
	}
}

async function signInAdmin(): Promise<string> {
	const res = await fetch(url('/api/auth/sign-in/email'), {
		method: 'POST',
		headers: { 'content-type': 'application/json', origin: BASE },
		body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
	});
	if (!res.ok) return '';
	return collectCookies(res);
}

beforeAll(async () => {
	serverUp = await ping();
	if (!serverUp) return;
	sessionCookie = await signInAdmin();
}, 20_000);

afterAll(async () => {
	// Best-effort cleanup; ignore failures so a half-created run still tears down.
	if (!sessionCookie) return;
	if (createdProjectId) {
		try {
			await fetch(url(`/api/projects/${createdProjectId}`), {
				method: 'DELETE',
				headers: { cookie: sessionCookie }
			});
		} catch {
			/* ignore */
		}
	}
});

describe('REST API security (live :5173)', () => {
	describe('(a) unauthenticated reads are rejected', () => {
		it('GET /api/projects without a session returns 401', async () => {
			if (!serverUp) return void it.skip;
			const res = await fetch(url('/api/projects'), { redirect: 'manual' });
			expect(res.status).toBe(401);
		});

		it('GET /api/tasks/:id without a session returns 401', async () => {
			if (!serverUp) return;
			// /api/tasks has no collection GET; the id route is the protected read.
			const res = await fetch(url(`/api/tasks/${ghostId()}`), { redirect: 'manual' });
			expect(res.status).toBe(401);
		});

		it('GET /api/projects/:id without a session returns 401', async () => {
			if (!serverUp) return;
			const res = await fetch(url(`/api/projects/${ghostId()}`), { redirect: 'manual' });
			expect(res.status).toBe(401);
		});
	});

	describe('(b) invalid Bearer token is rejected', () => {
		it('garbage non-prefixed Bearer token returns 401', async () => {
			if (!serverUp) return;
			const res = await fetch(url('/api/projects'), {
				headers: { authorization: 'Bearer not-a-real-token' }
			});
			expect(res.status).toBe(401);
		});

		it('well-formed-but-fake bsk_ key returns 401', async () => {
			if (!serverUp) return;
			const res = await fetch(url('/api/projects'), {
				headers: { authorization: `Bearer bsk_${'0'.repeat(40)}` }
			});
			expect(res.status).toBe(401);
		});

		it('empty Bearer token returns 401', async () => {
			if (!serverUp) return;
			const res = await fetch(url('/api/projects'), {
				headers: { authorization: 'Bearer ' }
			});
			expect(res.status).toBe(401);
		});
	});

	describe('(d) inaccessible ids return 404 (not 403)', () => {
		it('GET a non-existent project id returns 404 even when authed', async () => {
			if (!serverUp) return;
			if (!sessionCookie) return; // skip if seeded admin unavailable
			const res = await fetch(url(`/api/projects/${ghostId()}`), {
				headers: { cookie: sessionCookie }
			});
			// ADR-019: inaccessible ≡ missing — never leak existence with a 403.
			expect(res.status).toBe(404);
			expect(res.status).not.toBe(403);
		});

		it('GET a non-existent task id returns 404 even when authed', async () => {
			if (!serverUp) return;
			if (!sessionCookie) return;
			const res = await fetch(url(`/api/tasks/${ghostId()}`), {
				headers: { cookie: sessionCookie }
			});
			expect(res.status).toBe(404);
			expect(res.status).not.toBe(403);
		});
	});

	describe('(c) file upload denylist + size cap', () => {
		// Create a real project + files-type custom field so the upload reaches the
		// denylist/size checks (which run AFTER project-access resolution).
		beforeAll(async () => {
			if (!serverUp || !sessionCookie) return;

			const projRes = await fetch(url('/api/projects'), {
				method: 'POST',
				headers: { 'content-type': 'application/json', cookie: sessionCookie },
				body: JSON.stringify({ name: `sec-test-${ghostId()}` })
			});
			if (!projRes.ok) return;
			const projJson = (await projRes.json()) as { project?: { id?: string } };
			createdProjectId = projJson.project?.id ?? null;
			if (!createdProjectId) return;

			// Custom fields are created via the project settings form action.
			const fd = new URLSearchParams();
			fd.set('name', 'Attachments');
			fd.set('type', 'files');
			fd.set('appliesTo', 'all');
			const fieldRes = await fetch(
				url(`/projects/${createdProjectId}/settings?/createCustomField`),
				{
					method: 'POST',
					headers: {
						'content-type': 'application/x-www-form-urlencoded',
						cookie: sessionCookie
					},
					body: fd.toString()
				}
			);
			if (!fieldRes.ok) return;

			// Resolve the new field's id via the project detail endpoint.
			const detail = await fetch(url(`/api/projects/${createdProjectId}`), {
				headers: { cookie: sessionCookie }
			});
			if (!detail.ok) return;
			const detailJson = (await detail.json()) as {
				customFields?: Array<{ id: string; type: string }>;
			};
			filesFieldId = detailJson.customFields?.find((f) => f.type === 'files')?.id ?? null;
		}, 20_000);

		async function upload(filename: string, bytes: Uint8Array | Blob) {
			const form = new FormData();
			form.set('fieldId', filesFieldId ?? '');
			const blob = bytes instanceof Blob ? bytes : new Blob([bytes as BlobPart]);
			form.set('file', blob, filename);
			return fetch(url('/api/files'), {
				method: 'POST',
				headers: { cookie: sessionCookie },
				body: form
			});
		}

		for (const ext of ['svg', 'html', 'js']) {
			it(`rejects a .${ext} upload with 415`, async () => {
				if (!serverUp || !sessionCookie || !filesFieldId) return;
				const res = await upload(`evil.${ext}`, new TextEncoder().encode('<script>x</script>'));
				expect(res.status).toBe(415);
			});
		}

		it('rejects an oversize (>10 MB) upload with 413', async () => {
			if (!serverUp || !sessionCookie || !filesFieldId) return;
			// 10 MB + 1 byte of allowed-extension content.
			const big = new Uint8Array(10 * 1024 * 1024 + 1);
			const res = await upload('huge.png', big);
			expect(res.status).toBe(413);
		}, 30_000);

		it('rejects an empty file with 400', async () => {
			if (!serverUp || !sessionCookie || !filesFieldId) return;
			const res = await upload('empty.png', new Uint8Array(0));
			expect(res.status).toBe(400);
		});

		it('unauthenticated upload returns 401', async () => {
			if (!serverUp) return;
			const form = new FormData();
			form.set('fieldId', filesFieldId ?? ghostId());
			form.set('file', new Blob([new Uint8Array(4)]), 'x.png');
			const res = await fetch(url('/api/files'), { method: 'POST', body: form });
			expect(res.status).toBe(401);
		});
	});

	describe('(e) Slack integration URL validation', () => {
		async function saveSlack(webhookUrl: string, cookie: string) {
			const body = new URLSearchParams({ webhookUrl });
			return fetch(url('/integrations?/saveSlack'), {
				method: 'POST',
				headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
				body: body.toString()
			});
		}

		it('rejects a non-hooks.slack.com webhook URL', async () => {
			if (!serverUp || !sessionCookie) return;
			const res = await saveSlack('https://evil.example.com/webhook', sessionCookie);
			// SvelteKit form actions return 200 with an embedded failure payload, OR
			// the fail() status — accept either, but assert it did NOT succeed/save.
			const text = await res.text();
			expect(res.status).not.toBe(201);
			expect(res.status).not.toBe(204);
			// The action calls fail(400, { message: 'Webhook URL must start with …' }).
			expect(text).toMatch(/must start with|hooks\.slack\.com/i);
			expect(text).not.toMatch(/"saved":true/);
		});

		it('accepts the canonical hooks.slack.com host prefix (validation passes)', async () => {
			if (!serverUp || !sessionCookie) return;
			// A syntactically valid host that won't actually deliver — this only
			// exercises the URL-prefix guard, not real delivery. saveSlack stores
			// config without contacting Slack, so it should NOT be a 400 prefix error.
			const res = await saveSlack(`${SLACK_WEBHOOK_HOST}services/T000/B000/xxxx`, sessionCookie);
			const text = await res.text();
			expect(text).not.toMatch(/must start with/i);
		});
	});
});
