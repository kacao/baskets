import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Atomicity regression test for Plan 011 (`withTransaction` around
 * `updateTaskService`). A single `PATCH /api/tasks/{id}` that carries BOTH a
 * VALID field change (title) AND an INVALID custom-field value must fail as a
 * unit: the custom-field validation error returns 400 AND the valid title write
 * is rolled back (nothing persisted). Before the fix, the title `UPDATE` ran as
 * a separate statement before the CF write, so a CF error left the task
 * title-changed-but-error-returned — a partial write.
 *
 * Uses the same harness as person-field-scope.test.ts: signs in the seeded
 * admin via BetterAuth and reuses the session cookie. SKIPS (not fails) when
 * RUN_INTEGRATION is unset; a broken/unseeded env FAILS loudly when set.
 */

const BASE = process.env.TEST_BASE_URL ?? 'http://localhost:5173';
const ADMIN_EMAIL = 'admin@baskets.local';
const ADMIN_PASSWORD = 'admin-baskets-2026';
const RUN_INTEGRATION = !!process.env.RUN_INTEGRATION;

let cookie = '';
let skipReason = '';
const createdProjectIds = new Set<string>();

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
	const adminCookie = await signIn(ADMIN_EMAIL, ADMIN_PASSWORD);
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
	}
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
		console.warn(`[tx-atomicity] SKIPPED: ${skipReason}`);
		return false;
	}
	return true;
}

async function createProject(name: string): Promise<string> {
	const res = await api('/api/projects', { method: 'POST', json: { name } });
	const id = (await res.json().catch(() => null))?.project?.id;
	if (id) createdProjectIds.add(id);
	return id;
}

const rid = () => crypto.randomUUID();

describe.skipIf(!RUN_INTEGRATION)('updateTaskService atomicity (Plan 011)', () => {
	it('rolls back a valid title change when a custom-field value in the same PATCH is invalid', async () => {
		if (!ensureAuth()) return;

		const projectId = await createProject(`itest-tx-atomicity-${rid()}`);
		const fieldRes = await api(`/api/projects/${projectId}/custom-fields`, {
			method: 'POST',
			json: { name: 'Owner', type: 'person' }
		});
		expect(fieldRes.status).toBe(201);
		const fieldId = (await fieldRes.json()).customField.id;

		const originalTitle = `original-${rid()}`;
		const created = await (
			await api('/api/tasks', { method: 'POST', json: { projectId, title: originalTitle } })
		).json();
		const taskId = created.task.id;

		// One PATCH: a VALID title change + an INVALID person-cf value (unknown/off-roster id).
		const patch = await api(`/api/tasks/${taskId}`, {
			method: 'PATCH',
			json: { title: `changed-${rid()}`, customFields: { [fieldId]: [rid()] } }
		});
		expect(patch.status).toBe(400);

		// Atomicity: the title write must have rolled back, and the cf value must not persist.
		const after = await (await api(`/api/tasks/${taskId}`)).json();
		expect(after.task.title).toBe(originalTitle);
		expect(after.task.customFields?.[fieldId]).toBeUndefined();
	});

	it('control: a title-only PATCH (no invalid cf) DOES persist — proves the rollback above is meaningful', async () => {
		if (!ensureAuth()) return;

		const projectId = await createProject(`itest-tx-atomicity-${rid()}`);
		const created = await (
			await api('/api/tasks', { method: 'POST', json: { projectId, title: `original-${rid()}` } })
		).json();
		const taskId = created.task.id;

		const newTitle = `changed-ok-${rid()}`;
		const patch = await api(`/api/tasks/${taskId}`, {
			method: 'PATCH',
			json: { title: newTitle }
		});
		expect(patch.status).toBe(200);

		const after = await (await api(`/api/tasks/${taskId}`)).json();
		expect(after.task.title).toBe(newTitle);
	});
});
