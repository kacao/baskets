import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Regression test for scoping `person` custom-field values to the project's
 * access roster (Plan 007). Before the fix, `writeTaskCustomValues` validated
 * a `person` id only against the GLOBAL `user` table — any real user id was
 * accepted regardless of project access, letting a task editor store (and
 * later read back, e.g. via CSV export) an arbitrary user's name: a
 * cross-project disclosure per ADR-019. The fix intersects candidate ids with
 * `projectAccessUserIds(projectId, workspaceId)` (mirrors `notifyMentions`).
 *
 * Run against the RUNNING dev server, same harness as task-mutations.test.ts:
 * signs in the seeded admin via BetterAuth and reuses the session cookie.
 * SKIPS (not fails) when RUN_INTEGRATION is unset; a broken/unseeded env
 * FAILS loudly when RUN_INTEGRATION=1.
 */

const BASE = process.env.TEST_BASE_URL ?? 'http://localhost:5173';
// Seeded admin + demo users (see scripts/seed.ts — keep in sync if creds change).
const ADMIN_EMAIL = 'admin@baskets.local';
const ADMIN_PASSWORD = 'admin-baskets-2026';
const DEMO_EMAIL = 'demo@baskets.local';
const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'demo-baskets-2026';

const RUN_INTEGRATION = !!process.env.RUN_INTEGRATION;

let cookie = '';
let skipReason = '';
let adminUserId = '';
// Real user id NOT granted access to the project created below — best case is the
// seeded demo user (proves "real but off-roster id rejected"); if the demo sign-in
// isn't available, falls back to a random UUID (weaker — only proves "unknown id
// rejected", not "known-but-off-roster id rejected").
let offRosterUserId = '';
let offRosterIsRealUser = false;
const createdProjectIds = new Set<string>();

/** fetch wrapper that attaches the given session cookie + JSON content-type. */
async function apiAs(
	sessionCookie: string,
	path: string,
	init: RequestInit & { json?: unknown } = {}
): Promise<Response> {
	const { json: body, headers, ...rest } = init;
	return fetch(`${BASE}${path}`, {
		...rest,
		headers: {
			...(body !== undefined ? { 'content-type': 'application/json' } : {}),
			...(sessionCookie ? { cookie: sessionCookie } : {}),
			...(headers ?? {})
		},
		body: body !== undefined ? JSON.stringify(body) : (rest.body as BodyInit | undefined)
	});
}

async function signIn(email: string, password: string): Promise<string | null> {
	const res = await fetch(`${BASE}/api/auth/sign-in/email`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', origin: BASE },
		body: JSON.stringify({ email, password })
	});
	if (!res.ok) return null;
	const setCookie = res.headers.get('set-cookie');
	if (!setCookie) return null;
	return setCookie
		.split(/,(?=[^;]+?=)/)
		.map((c) => c.split(';')[0].trim())
		.join('; ');
}

function api(path: string, init: RequestInit & { json?: unknown } = {}): Promise<Response> {
	return apiAs(cookie, path, init);
}

beforeAll(async () => {
	let reachable = false;
	try {
		const ping = await fetch(`${BASE}/api/me`);
		reachable = ping.status !== undefined;
	} catch {
		reachable = false;
	}
	if (!reachable) {
		skipReason = `dev server not reachable at ${BASE} — start it with \`npm run dev\``;
		if (RUN_INTEGRATION) throw new Error(skipReason);
		return;
	}

	let adminCookie: string | null;
	try {
		adminCookie = await signIn(ADMIN_EMAIL, ADMIN_PASSWORD);
	} catch (err) {
		skipReason = `admin sign-in request failed: ${(err as Error).message}`;
		if (RUN_INTEGRATION) throw new Error(skipReason);
		return;
	}
	if (!adminCookie) {
		skipReason = `admin sign-in failed — is the DB seeded (npm run db:seed)?`;
		if (RUN_INTEGRATION) throw new Error(skipReason);
		return;
	}
	cookie = adminCookie;

	const me = await api('/api/me');
	if (!me.ok) {
		skipReason = `session cookie did not authenticate (/api/me → ${me.status})`;
		cookie = '';
		if (RUN_INTEGRATION) throw new Error(skipReason);
		return;
	}
	adminUserId = (await me.json())?.user?.id ?? '';

	// Best-effort: sign in as the seeded demo user to get a REAL, off-roster id.
	try {
		const demoCookie = await signIn(DEMO_EMAIL, DEMO_PASSWORD);
		if (demoCookie) {
			const demoMe = await apiAs(demoCookie, '/api/me');
			if (demoMe.ok) {
				const demoId = (await demoMe.json())?.user?.id;
				if (demoId) {
					offRosterUserId = demoId;
					offRosterIsRealUser = true;
				}
			}
		}
	} catch {
		// fall through to the random-UUID fallback below
	}
	if (!offRosterUserId) offRosterUserId = crypto.randomUUID();
});

afterAll(async () => {
	if (!cookie) return;
	for (const id of createdProjectIds) {
		try {
			await api(`/api/projects/${id}`, { method: 'DELETE' });
		} catch {
			// best-effort cleanup
		}
	}
});

function ensureAuth() {
	if (!cookie) {
		// eslint-disable-next-line no-console
		console.warn(`[person-field-scope] SKIPPED: ${skipReason}`);
		return false;
	}
	return true;
}

async function createProject(name: string): Promise<string> {
	const res = await api('/api/projects', { method: 'POST', json: { name } });
	const body = await res.json().catch(() => null);
	const id = body?.project?.id;
	if (id) createdProjectIds.add(id);
	return id;
}

const rid = () => crypto.randomUUID();

describe.skipIf(!RUN_INTEGRATION)('person custom-field values scoped to project roster', () => {
	it('rejects an off-roster/unknown user id on a person field (400, not persisted)', async () => {
		if (!ensureAuth()) return;
		if (!offRosterIsRealUser) {
			// eslint-disable-next-line no-console
			console.warn(
				'[person-field-scope] demo sign-in unavailable — falling back to a random UUID; ' +
					'this only proves "unknown id rejected", not "known-but-off-roster id rejected"'
			);
		}

		const projectId = await createProject(`itest-person-scope-${rid()}`);
		const fieldRes = await api(`/api/projects/${projectId}/custom-fields`, {
			method: 'POST',
			json: { name: 'Owner', type: 'person' }
		});
		expect(fieldRes.status).toBe(201);
		const fieldId = (await fieldRes.json()).customField.id;

		const created = await (
			await api('/api/tasks', { method: 'POST', json: { projectId, title: 'Person field check' } })
		).json();
		const taskId = created.task.id;

		const patch = await api(`/api/tasks/${taskId}`, {
			method: 'PATCH',
			json: { customFields: { [fieldId]: [offRosterUserId] } }
		});
		expect(patch.status).toBe(400);

		const after = await (await api(`/api/tasks/${taskId}`)).json();
		expect(after.task.customFields?.[fieldId]).toBeUndefined();
	});

	it("accepts the acting admin's own id on a person field (200, persisted) — proves no over-blocking", async () => {
		if (!ensureAuth()) return;
		expect(adminUserId).toBeTruthy();

		const projectId = await createProject(`itest-person-scope-${rid()}`);
		const fieldRes = await api(`/api/projects/${projectId}/custom-fields`, {
			method: 'POST',
			json: { name: 'Owner', type: 'person' }
		});
		expect(fieldRes.status).toBe(201);
		const fieldId = (await fieldRes.json()).customField.id;

		const created = await (
			await api('/api/tasks', { method: 'POST', json: { projectId, title: 'Person field check' } })
		).json();
		const taskId = created.task.id;

		const patch = await api(`/api/tasks/${taskId}`, {
			method: 'PATCH',
			json: { customFields: { [fieldId]: [adminUserId] } }
		});
		expect(patch.status).toBe(200);

		const after = await (await api(`/api/tasks/${taskId}`)).json();
		expect(after.task.customFields?.[fieldId]).toEqual([adminUserId]);
	});
});
