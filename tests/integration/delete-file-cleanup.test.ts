import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Regression tests for Plan 008: deleting a task or project must unlink the
 * uploaded file BYTES on disk (not just cascade-delete the `file` DB rows),
 * run against the RUNNING dev server (ADR-019/ADR-049).
 *
 *   (a) DELETE /api/projects/[id] removes every file under
 *       UPLOADS_DIR/<projectId>/ (src/routes/(app)/projects/[id]/+page.server.ts
 *       and its siblings + the REST endpoint all call deleteFilesForProject).
 *   (b) DELETE /api/tasks/[id] removes the bytes for that task's direct
 *       attachments (deleteTaskService now calls deleteFilesForTasks).
 *
 * Auth: signs in the seeded admin via BetterAuth (scripts/seed.ts creds, with an
 * Origin header) and reuses the returned session cookie. If the server is
 * unreachable or auth can't be established, every test SKIPS with a clear
 * message rather than failing hard (the dev server / seeded data may be absent
 * in CI).
 *
 * Self-cleaning: every project created here is deleted in afterAll (cascading
 * its tasks); nonexistent-id probes use random UUIDs.
 */

const BASE = process.env.TEST_BASE_URL ?? 'http://localhost:5173';
const UPLOADS = process.env.UPLOADS_DIR ?? './data/uploads';
// Seeded admin (see scripts/seed.ts — keep in sync if creds change).
const ADMIN_EMAIL = 'admin@baskets.local';
const ADMIN_PASSWORD = 'admin-baskets-2026';

// Explicit opt-in: integration tests need a live, seeded dev server. When
// RUN_INTEGRATION is unset the whole suite is SKIPPED (see describe.skipIf
// below). When it IS set, a broken/unseeded env must FAIL loudly, not skip.
const RUN_INTEGRATION = !!process.env.RUN_INTEGRATION;

let cookie = '';
let skipReason = '';
const createdProjectIds = new Set<string>();

/** fetch wrapper that attaches the session cookie + JSON content-type. */
async function api(path: string, init: RequestInit & { json?: unknown } = {}): Promise<Response> {
	const { json: body, headers, ...rest } = init;
	return fetch(`${BASE}${path}`, {
		...rest,
		headers: {
			...(body !== undefined ? { 'content-type': 'application/json' } : {}),
			...(cookie ? { cookie } : {}),
			...(headers ?? {})
		},
		body: body !== undefined ? JSON.stringify(body) : (rest.body as BodyInit | undefined)
	});
}

beforeAll(async () => {
	// 1) Is the server up at all?
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

	// 2) Sign in via BetterAuth (mounted by hooks at /api/auth/...).
	let res: Response;
	try {
		res = await fetch(`${BASE}/api/auth/sign-in/email`, {
			method: 'POST',
			headers: { 'content-type': 'application/json', origin: BASE },
			body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
		});
	} catch (err) {
		skipReason = `sign-in request failed: ${(err as Error).message}`;
		if (RUN_INTEGRATION) throw new Error(skipReason);
		return;
	}
	if (!res.ok) {
		skipReason = `sign-in returned ${res.status} — is the DB seeded (npm run db:seed)?`;
		if (RUN_INTEGRATION) throw new Error(skipReason);
		return;
	}
	// BetterAuth sets the session via Set-Cookie; reuse the raw cookie pairs.
	const setCookie = res.headers.get('set-cookie');
	if (!setCookie) {
		skipReason = 'sign-in succeeded but no session cookie was returned';
		if (RUN_INTEGRATION) throw new Error(skipReason);
		return;
	}
	cookie = setCookie
		.split(/,(?=[^;]+?=)/)
		.map((c) => c.split(';')[0].trim())
		.join('; ');

	// 3) Confirm the cookie actually authenticates.
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

/** Guard each test: skip with the reason when auth wasn't established. */
function ensureAuth() {
	if (!cookie) {
		// eslint-disable-next-line no-console
		console.warn(`[delete-file-cleanup] SKIPPED: ${skipReason}`);
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

async function createTask(projectId: string, title: string): Promise<string> {
	const res = await api('/api/tasks', { method: 'POST', json: { projectId, title } });
	const body = await res.json().catch(() => null);
	return body?.task?.id;
}

/** List the files persisted on disk under UPLOADS_DIR/<projectId>/. */
async function projectFiles(projectId: string): Promise<string[]> {
	try {
		return await readdir(join(UPLOADS, projectId));
	} catch {
		return [];
	}
}

/** Attach a small text file directly to a task via the REST upload endpoint. */
async function uploadToTask(taskId: string, name: string, bytes: string): Promise<Response> {
	const fd = new FormData();
	fd.set('file', new File([bytes], name, { type: 'text/plain' }));
	return fetch(`${BASE}/api/tasks/${taskId}/files`, {
		method: 'POST',
		headers: { ...(cookie ? { cookie } : {}) },
		body: fd
	});
}

const rid = () => crypto.randomUUID();

describe.skipIf(!RUN_INTEGRATION)('file byte cleanup on delete (Plan 008)', () => {
	it('DELETE /api/projects/[id] unlinks all uploaded file bytes for that project', async () => {
		if (!ensureAuth()) return;
		const projectId = await createProject(`itest-project-${rid()}`);
		const taskId = await createTask(projectId, 'Attachment holder');

		const uploadRes = await uploadToTask(taskId, 'note.txt', 'hello world');
		expect(uploadRes.status).toBe(201);

		const before = await projectFiles(projectId);
		expect(before.length).toBeGreaterThanOrEqual(1);

		const del = await api(`/api/projects/${projectId}`, { method: 'DELETE' });
		expect(del.status).toBe(204);
		createdProjectIds.delete(projectId); // already deleted — afterAll shouldn't re-delete

		const after = await projectFiles(projectId);
		expect(after.length).toBe(0);
	});

	it("DELETE /api/tasks/[id] unlinks that task's attachment bytes", async () => {
		if (!ensureAuth()) return;
		const projectId = await createProject(`itest-project-${rid()}`);
		const taskId = await createTask(projectId, 'Task to delete');

		const uploadRes = await uploadToTask(taskId, 'note.txt', 'hello again');
		expect(uploadRes.status).toBe(201);

		const before = await projectFiles(projectId);
		expect(before.length).toBeGreaterThanOrEqual(1);

		const del = await api(`/api/tasks/${taskId}`, { method: 'DELETE' });
		expect(del.status).toBe(204);

		const after = await projectFiles(projectId);
		expect(after.length).toBe(0);
	});
});
