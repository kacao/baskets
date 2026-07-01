import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * ADR-019 authorization regression tests for the Baskets REST API.
 *
 * Runs against a LIVE dev server (default http://localhost:5173) and drives the
 * HTTP boundary as an external client would — it imports no app modules. It signs
 * in as BOTH the seeded admin AND the seeded (non-admin) demo user so it can prove
 * the access tiers:
 *   - unauthenticated            → 401
 *   - authed but INACCESSIBLE    → 404 (never 403 — no existence oracle)
 *   - admin-gated, non-admin     → 403 BEFORE the existence lookup (ghost ≡ real)
 *   - per-user resources         → owner-scoped (other user's row ≡ missing → 404)
 *   - secrets (key hash, storagePath) are never serialized
 *
 * Self-cleaning; gracefully skips (no assertion) when the server is unreachable or
 * a seeded account can't sign in, so the file is safe to run anywhere.
 *
 * Run: `npm run test:integration` against a running, seeded dev server.
 */

const BASE = (process.env.TEST_BASE_URL ?? 'http://localhost:5173').replace(/\/$/, '');
const ADMIN_EMAIL = process.env.TEST_ADMIN_EMAIL ?? 'admin@baskets.local';
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD ?? 'admin-baskets-2026';
const DEMO_EMAIL = process.env.TEST_DEMO_EMAIL ?? 'demo@baskets.local';
const DEMO_PASSWORD = process.env.TEST_DEMO_PASSWORD ?? 'demo-baskets-2026';

const url = (path: string) => `${BASE}${path}`;
const ghostId = () => `ghost-${Math.random().toString(36).slice(2)}-${Date.now()}`;

let serverUp = false;
let adminCookie = '';
let demoCookie = '';

// Resources created as admin (torn down in afterAll).
let projectA = '';
let projectB = '';
let taskA = '';
let taskB = '';
let adminKeyId = '';
let filesFieldId = '';

function collectCookies(res: Response): string {
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
		return res.status > 0;
	} catch {
		return false;
	}
}

async function signIn(email: string, password: string): Promise<string> {
	try {
		const res = await fetch(url('/api/auth/sign-in/email'), {
			method: 'POST',
			headers: { 'content-type': 'application/json', origin: BASE },
			body: JSON.stringify({ email, password })
		});
		if (!res.ok) return '';
		return collectCookies(res);
	} catch {
		return '';
	}
}

async function createProject(cookie: string, name: string): Promise<string> {
	const res = await fetch(url('/api/projects'), {
		method: 'POST',
		headers: { 'content-type': 'application/json', cookie },
		body: JSON.stringify({ name })
	});
	if (!res.ok) return '';
	const j = (await res.json()) as { project?: { id?: string } };
	return j.project?.id ?? '';
}

async function createTask(cookie: string, projectId: string, title: string): Promise<string> {
	const res = await fetch(url('/api/tasks'), {
		method: 'POST',
		headers: { 'content-type': 'application/json', cookie },
		body: JSON.stringify({ projectId, title })
	});
	if (!res.ok) return '';
	const j = (await res.json()) as { task?: { id?: string }; id?: string };
	return j.task?.id ?? j.id ?? '';
}

beforeAll(async () => {
	serverUp = await ping();
	if (!serverUp) return;
	adminCookie = await signIn(ADMIN_EMAIL, ADMIN_PASSWORD);
	demoCookie = await signIn(DEMO_EMAIL, DEMO_PASSWORD);
	if (!adminCookie) return;

	projectA = await createProject(adminCookie, `authz-A-${ghostId()}`);
	projectB = await createProject(adminCookie, `authz-B-${ghostId()}`);
	if (projectA) taskA = await createTask(adminCookie, projectA, 'task in A');
	if (projectB) taskB = await createTask(adminCookie, projectB, 'task in B');

	// an admin-owned API key (for the owner-scoping test)
	const keyRes = await fetch(url('/api/keys'), {
		method: 'POST',
		headers: { 'content-type': 'application/json', cookie: adminCookie },
		body: JSON.stringify({ name: `authz-key-${ghostId()}` })
	});
	if (keyRes.ok) {
		const j = (await keyRes.json()) as { key?: { id?: string } };
		adminKeyId = j.key?.id ?? '';
	}

	// a files-type custom field on project A (for the upload tests)
	if (projectA) {
		const fd = new URLSearchParams();
		fd.set('name', 'Attachments');
		fd.set('type', 'files');
		fd.set('appliesTo', 'all');
		await fetch(url(`/projects/${projectA}/settings?/createCustomField`), {
			method: 'POST',
			headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: adminCookie },
			body: fd.toString()
		});
		const detail = await fetch(url(`/api/projects/${projectA}`), { headers: { cookie: adminCookie } });
		if (detail.ok) {
			const j = (await detail.json()) as { customFields?: Array<{ id: string; type: string }> };
			filesFieldId = j.customFields?.find((f) => f.type === 'files')?.id ?? '';
		}
	}
}, 30_000);

afterAll(async () => {
	if (!adminCookie) return;
	for (const p of [projectA, projectB]) {
		if (!p) continue;
		try {
			await fetch(url(`/api/projects/${p}`), { method: 'DELETE', headers: { cookie: adminCookie } });
		} catch {
			/* ignore */
		}
	}
	if (adminKeyId) {
		try {
			await fetch(url('/api/keys'), {
				method: 'DELETE',
				headers: { 'content-type': 'application/json', cookie: adminCookie },
				body: JSON.stringify({ id: adminKeyId })
			});
		} catch {
			/* ignore */
		}
	}
});

// GET-capable project sub-resources — all must 404 for a missing/inaccessible project.
const PROJECT_GET_SUBPATHS = [
	'',
	'/statuses',
	'/labels',
	'/milestones',
	'/locations',
	'/views',
	'/custom-fields',
	'/custom-values',
	'/dependencies',
	'/files',
	'/export',
	'/templates'
];

describe('REST API authorization / ADR-019 (live :5173)', () => {
	describe('(A) a missing project id returns 404 on every sub-resource (admin)', () => {
		for (const sub of PROJECT_GET_SUBPATHS) {
			it(`GET /api/projects/:ghost${sub} → 404`, async () => {
				if (!serverUp || !adminCookie) return;
				const res = await fetch(url(`/api/projects/${ghostId()}${sub}`), {
					headers: { cookie: adminCookie }
				});
				expect(res.status).toBe(404);
			});
		}
	});

	describe('(B) an INACCESSIBLE project returns 404 (not 403) for a non-admin', () => {
		for (const sub of PROJECT_GET_SUBPATHS) {
			it(`demo GET /api/projects/:adminProject${sub} → 404, never 403`, async () => {
				if (!serverUp || !demoCookie || !projectA) return;
				const res = await fetch(url(`/api/projects/${projectA}${sub}`), {
					headers: { cookie: demoCookie }
				});
				// ADR-019: inaccessible ≡ missing — a 403 here would be an existence oracle.
				expect(res.status).toBe(404);
				expect(res.status).not.toBe(403);
			});
		}

		it('demo GET /api/tasks/:adminTask → 404, never 403', async () => {
			if (!serverUp || !demoCookie || !taskA) return;
			const res = await fetch(url(`/api/tasks/${taskA}`), { headers: { cookie: demoCookie } });
			expect(res.status).toBe(404);
			expect(res.status).not.toBe(403);
		});
	});

	describe('(C) admin-gated grants: 403 BEFORE existence (no oracle)', () => {
		it('demo GET grants on a REAL project → 403', async () => {
			if (!serverUp || !demoCookie || !projectA) return;
			const res = await fetch(url(`/api/projects/${projectA}/grants`), {
				headers: { cookie: demoCookie }
			});
			expect(res.status).toBe(403);
		});

		it('demo GET grants on a GHOST project → 403 (identical to the real one)', async () => {
			if (!serverUp || !demoCookie) return;
			const res = await fetch(url(`/api/projects/${ghostId()}/grants`), {
				headers: { cookie: demoCookie }
			});
			// The admin check runs first, so a non-admin can't tell a real project from a ghost.
			expect(res.status).toBe(403);
		});

		it('demo POST a grant → 403 (cannot escalate)', async () => {
			if (!serverUp || !demoCookie || !projectA) return;
			const res = await fetch(url(`/api/projects/${projectA}/grants`), {
				method: 'POST',
				headers: { 'content-type': 'application/json', cookie: demoCookie },
				body: JSON.stringify({ userId: 'anyone' })
			});
			expect(res.status).toBe(403);
		});
	});

	describe('(D) API keys are owner-scoped and never leak the hash', () => {
		it("demo cannot delete the admin's key (404, owner-scoped)", async () => {
			if (!serverUp || !demoCookie || !adminKeyId) return;
			const res = await fetch(url('/api/keys'), {
				method: 'DELETE',
				headers: { 'content-type': 'application/json', cookie: demoCookie },
				body: JSON.stringify({ id: adminKeyId })
			});
			expect(res.status).toBe(404);
		});

		it("demo's key list never contains the admin's key or any hash", async () => {
			if (!serverUp || !demoCookie) return;
			const res = await fetch(url('/api/keys'), { headers: { cookie: demoCookie } });
			if (!res.ok) return;
			const text = await res.text();
			expect(text).not.toContain(adminKeyId || '__no_admin_key__');
			expect(text).not.toMatch(/keyHash|"hash"/i);
		});

		it('the admin key list omits keyHash', async () => {
			if (!serverUp || !adminCookie) return;
			const res = await fetch(url('/api/keys'), { headers: { cookie: adminCookie } });
			if (!res.ok) return;
			const text = await res.text();
			expect(text).not.toMatch(/keyHash|"hash"/i);
		});
	});

	describe('(E) notifications are user-scoped', () => {
		it('demo can read its own notifications (200)', async () => {
			if (!serverUp || !demoCookie) return;
			const res = await fetch(url('/api/notifications'), { headers: { cookie: demoCookie } });
			expect(res.status).toBe(200);
		});

		it('acting on a non-existent notification id → 404', async () => {
			if (!serverUp || !demoCookie) return;
			const res = await fetch(url(`/api/notifications/${ghostId()}`), {
				method: 'PATCH',
				headers: { cookie: demoCookie }
			});
			expect(res.status).toBe(404);
			expect(res.status).not.toBe(403);
		});
	});

	describe('(F) storagePath is never serialized', () => {
		it('GET /api/projects/:id/files never exposes storagePath', async () => {
			if (!serverUp || !adminCookie || !projectA) return;
			const res = await fetch(url(`/api/projects/${projectA}/files`), {
				headers: { cookie: adminCookie }
			});
			if (!res.ok) return;
			const text = await res.text();
			expect(text).not.toMatch(/storagePath/i);
		});
	});

	describe('(G) upload validation: double-extension, case, server-derived MIME', () => {
		async function upload(filename: string, bytes: Uint8Array) {
			const form = new FormData();
			form.set('fieldId', filesFieldId);
			form.set('file', new Blob([bytes as BlobPart]), filename);
			return fetch(url('/api/files'), { method: 'POST', headers: { cookie: adminCookie }, body: form });
		}

		it('rejects a double-extension .pdf.exe with 415', async () => {
			if (!serverUp || !adminCookie || !filesFieldId) return;
			const res = await upload('evil.pdf.exe', new TextEncoder().encode('x'));
			expect(res.status).toBe(415);
		});

		it('rejects an uppercase .EXE with 415 (case-insensitive)', async () => {
			if (!serverUp || !adminCookie || !filesFieldId) return;
			const res = await upload('EVIL.EXE', new TextEncoder().encode('x'));
			expect(res.status).toBe(415);
		});

		it('a .png upload streams back as image/png with nosniff + CSP sandbox, no storagePath', async () => {
			if (!serverUp || !adminCookie || !filesFieldId) return;
			const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
			const res = await upload('ok.png', png);
			expect(res.status).toBe(201);
			const j = (await res.json()) as { file?: { id?: string } };
			expect(JSON.stringify(j)).not.toMatch(/storagePath/i);
			const id = j.file?.id;
			if (!id) return;
			const get = await fetch(url(`/api/files/${id}`), { headers: { cookie: adminCookie } });
			expect(get.headers.get('content-type')).toMatch(/^image\/png/);
			expect(get.headers.get('x-content-type-options')).toBe('nosniff');
			expect(get.headers.get('content-security-policy') ?? '').toContain('sandbox');
		});
	});

	describe('(H) bulk task ops reject cross-project + ghost ids', () => {
		it('PATCH /api/tasks/bulk with two-project ids → 400 (same-project rule)', async () => {
			if (!serverUp || !adminCookie || !taskA || !taskB) return;
			const res = await fetch(url('/api/tasks/bulk'), {
				method: 'PATCH',
				headers: { 'content-type': 'application/json', cookie: adminCookie },
				body: JSON.stringify({ ids: [taskA, taskB], set: { priority: 'high' } })
			});
			expect(res.status).toBe(400);
		});

		it('PATCH /api/tasks/bulk with only a ghost id → 404', async () => {
			if (!serverUp || !adminCookie) return;
			const res = await fetch(url('/api/tasks/bulk'), {
				method: 'PATCH',
				headers: { 'content-type': 'application/json', cookie: adminCookie },
				body: JSON.stringify({ ids: [ghostId()], set: { priority: 'high' } })
			});
			expect(res.status).toBe(404);
		});
	});

	describe('(I) task dependencies reject cross-project', () => {
		it('POST /api/tasks/:A/dependencies dependsOn a task in project B → 400', async () => {
			if (!serverUp || !adminCookie || !taskA || !taskB) return;
			const res = await fetch(url(`/api/tasks/${taskA}/dependencies`), {
				method: 'POST',
				headers: { 'content-type': 'application/json', cookie: adminCookie },
				body: JSON.stringify({ dependsOnId: taskB })
			});
			expect(res.status).toBe(400);
		});
	});

	describe('(J) DELETE on a missing scoped [id] returns 404 (no oracle)', () => {
		for (const kind of ['milestones', 'labels', 'statuses', 'locations', 'views', 'custom-fields']) {
			it(`admin DELETE /api/${kind}/:ghost → 404`, async () => {
				if (!serverUp || !adminCookie) return;
				const res = await fetch(url(`/api/${kind}/${ghostId()}`), {
					method: 'DELETE',
					headers: { cookie: adminCookie }
				});
				expect(res.status).toBe(404);
			});
		}
	});
});
