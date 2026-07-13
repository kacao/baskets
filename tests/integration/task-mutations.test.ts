import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Regression tests for two task-mutation fixes on the REST surface, run against
 * the RUNNING dev server (ADR-019/ADR auth-access):
 *
 *   (a) PATCH /api/tasks/[id] rejects an assigneeId that doesn't reference a
 *       real user with 400 (the assignee existence check in
 *       src/routes/api/tasks/[id]/+server.ts).
 *   (b) Moving a parent task to a completed-category status via PATCH cascades
 *       that status onto its sub-tasks.
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
		console.warn(`[task-mutations] SKIPPED: ${skipReason}`);
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

describe.skipIf(!RUN_INTEGRATION)('REST API task mutations (regression)', () => {
	it('PATCH /api/tasks/[id] rejects an assigneeId for a nonexistent user (400)', async () => {
		if (!ensureAuth()) return;
		const projectId = await createProject(`itest-project-${rid()}`);
		const created = await (
			await api('/api/tasks', { method: 'POST', json: { projectId, title: 'Assignee check' } })
		).json();

		const res = await api(`/api/tasks/${created.task.id}`, {
			method: 'PATCH',
			json: { assigneeId: 'nonexistent-user-id' }
		});
		expect(res.status).toBe(400);

		// The assignee must NOT have been persisted.
		const after = await (await api(`/api/tasks/${created.task.id}`)).json();
		expect(after.task.assigneeId).toBeNull();
	});

	it('cascades a parent → completed status onto its sub-task via PATCH', async () => {
		if (!ensureAuth()) return;
		const projectId = await createProject(`itest-project-${rid()}`);
		const parent = await (
			await api('/api/tasks', { method: 'POST', json: { projectId, title: 'Cascade parent' } })
		).json();
		const child = await (
			await api('/api/tasks', {
				method: 'POST',
				json: { projectId, title: 'Cascade child', parentId: parent.task.id }
			})
		).json();
		expect(child.task.parentId).toBe(parent.task.id);

		// Move the parent to the completed-category status ("Completed" built-in).
		const patch = await api(`/api/tasks/${parent.task.id}`, {
			method: 'PATCH',
			json: { status: 'Completed' }
		});
		expect(patch.status).toBe(200);
		const completedStatusId = (await patch.json()).task.statusId;
		expect(completedStatusId).toBeTruthy();

		// The sub-task should now share the parent's completed statusId.
		const childAfter = await (await api(`/api/tasks/${child.task.id}`)).json();
		expect(childAfter.task.statusId).toBe(completedStatusId);
	});
});
