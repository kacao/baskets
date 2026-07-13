import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Integration tests for the REST API (ADR-019/ADR auth-access) against the
 * RUNNING dev server. These exercise the real HTTP surface end to end:
 *
 *   POST/GET/PATCH/DELETE  /api/projects  +  /api/projects/[id]
 *   POST/GET/PATCH/DELETE  /api/tasks     +  /api/tasks/[id]
 *   sub-task one-level enforcement, parent-done cascade,
 *   title-length validation, and 404 for nonexistent ids.
 *
 * Auth: signs in the seeded admin via BetterAuth (scripts/seed.ts creds) and
 * reuses the returned session cookie. If the server is unreachable or auth
 * can't be established, the whole suite SKIPS with a clear message rather than
 * failing hard (the dev server / seeded data may not be present in CI).
 *
 * Self-cleaning: every project created here is deleted in afterAll (which
 * cascades its tasks); nonexistent-id probes use random UUIDs.
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
async function api(
	path: string,
	init: RequestInit & { json?: unknown } = {}
): Promise<Response> {
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
		console.warn(`[api-projects-tasks] SKIPPED: ${skipReason}`);
		return false;
	}
	return true;
}

async function createProject(name: string): Promise<{ id: string; status: number; body: any }> {
	const res = await api('/api/projects', { method: 'POST', json: { name } });
	const body = await res.json().catch(() => null);
	const id = body?.project?.id;
	if (id) createdProjectIds.add(id);
	return { id, status: res.status, body };
}

const rid = () => crypto.randomUUID();

describe.skipIf(!RUN_INTEGRATION)('REST API: /api/projects + /api/tasks (integration)', () => {
	it('rejects unauthenticated requests with 401', async () => {
		if (!ensureAuth()) return;
		const res = await fetch(`${BASE}/api/projects`); // no cookie
		expect(res.status).toBe(401);
	});

	it('POST /api/projects creates a project (201) and GET lists it', async () => {
		if (!ensureAuth()) return;
		const name = `itest-project-${rid()}`;
		const { id, status, body } = await createProject(name);
		expect(status).toBe(201);
		expect(id).toBeTruthy();
		expect(body.project.name).toBe(name);

		const list = await api('/api/projects');
		expect(list.status).toBe(200);
		const { projects } = await list.json();
		expect(projects.some((p: any) => p.id === id)).toBe(true);
	});

	it('POST /api/projects rejects a missing/blank name (400)', async () => {
		if (!ensureAuth()) return;
		const res = await api('/api/projects', { method: 'POST', json: { name: '   ' } });
		expect(res.status).toBe(400);
	});

	it('POST /api/projects rejects an over-long name >120 chars (400)', async () => {
		if (!ensureAuth()) return;
		const res = await api('/api/projects', {
			method: 'POST',
			json: { name: 'x'.repeat(121) }
		});
		expect(res.status).toBe(400);
	});

	it('GET /api/projects/[id] returns 404 for a nonexistent id', async () => {
		if (!ensureAuth()) return;
		const res = await api(`/api/projects/${rid()}`);
		expect(res.status).toBe(404);
	});

	it('PATCH /api/projects/[id] updates name and persists', async () => {
		if (!ensureAuth()) return;
		const { id } = await createProject(`itest-project-${rid()}`);
		const renamed = `itest-renamed-${rid()}`;
		const res = await api(`/api/projects/${id}`, { method: 'PATCH', json: { name: renamed } });
		expect(res.status).toBe(200);
		const { project } = await res.json();
		expect(project.name).toBe(renamed);

		const reread = await api(`/api/projects/${id}`);
		expect((await reread.json()).project.name).toBe(renamed);
	});

	it('POST /api/tasks creates a task (201) and GET lists it', async () => {
		if (!ensureAuth()) return;
		const { id: projectId } = await createProject(`itest-project-${rid()}`);
		const res = await api('/api/tasks', {
			method: 'POST',
			json: { projectId, title: 'Top-level task' }
		});
		expect(res.status).toBe(201);
		const { task } = await res.json();
		expect(task.title).toBe('Top-level task');
		expect(task.parentId).toBeNull();

		const list = await api(`/api/tasks?projectId=${projectId}`);
		expect(list.status).toBe(200);
		const { tasks } = await list.json();
		expect(tasks.some((t: any) => t.id === task.id)).toBe(true);
	});

	it('POST /api/tasks rejects an over-long title >240 chars (400)', async () => {
		if (!ensureAuth()) return;
		const { id: projectId } = await createProject(`itest-project-${rid()}`);
		const res = await api('/api/tasks', {
			method: 'POST',
			json: { projectId, title: 'x'.repeat(241) }
		});
		expect(res.status).toBe(400);
	});

	it('POST /api/tasks rejects a blank title (400)', async () => {
		if (!ensureAuth()) return;
		const { id: projectId } = await createProject(`itest-project-${rid()}`);
		const res = await api('/api/tasks', {
			method: 'POST',
			json: { projectId, title: '   ' }
		});
		expect(res.status).toBe(400);
	});

	it('POST /api/tasks returns 404 for a nonexistent projectId', async () => {
		if (!ensureAuth()) return;
		const res = await api('/api/tasks', {
			method: 'POST',
			json: { projectId: rid(), title: 'orphan' }
		});
		expect(res.status).toBe(404);
	});

	it('enforces one-level nesting: a sub-task cannot have its own sub-task (400)', async () => {
		if (!ensureAuth()) return;
		const { id: projectId } = await createProject(`itest-project-${rid()}`);
		const parent = await (
			await api('/api/tasks', { method: 'POST', json: { projectId, title: 'Parent' } })
		).json();
		const child = await (
			await api('/api/tasks', {
				method: 'POST',
				json: { projectId, title: 'Child', parentId: parent.task.id }
			})
		).json();
		expect(child.task.parentId).toBe(parent.task.id);

		// Grandchild under the child must be rejected.
		const res = await api('/api/tasks', {
			method: 'POST',
			json: { projectId, title: 'Grandchild', parentId: child.task.id }
		});
		expect(res.status).toBe(400);
	});

	it('cascades a parent → done status onto its sub-tasks', async () => {
		if (!ensureAuth()) return;
		const { id: projectId } = await createProject(`itest-project-${rid()}`);
		const parent = await (
			await api('/api/tasks', { method: 'POST', json: { projectId, title: 'Cascade parent' } })
		).json();
		const child = await (
			await api('/api/tasks', {
				method: 'POST',
				json: { projectId, title: 'Cascade child', parentId: parent.task.id }
			})
		).json();

		// Move the parent to the completed-category status ("Completed" built-in).
		const patch = await api(`/api/tasks/${parent.task.id}`, {
			method: 'PATCH',
			json: { status: 'Completed' }
		});
		expect(patch.status).toBe(200);
		const completedStatusId = (await patch.json()).task.statusId;

		// The child should now share the parent's completed statusId.
		const childAfter = await (await api(`/api/tasks/${child.task.id}`)).json();
		expect(childAfter.task.statusId).toBe(completedStatusId);
	});

	it('PATCH /api/tasks/[id] rejects an unknown status (400)', async () => {
		if (!ensureAuth()) return;
		const { id: projectId } = await createProject(`itest-project-${rid()}`);
		const t = await (
			await api('/api/tasks', { method: 'POST', json: { projectId, title: 'Bad status' } })
		).json();
		const res = await api(`/api/tasks/${t.task.id}`, {
			method: 'PATCH',
			json: { status: 'Not A Real Status' }
		});
		expect(res.status).toBe(400);
	});

	it('GET/PATCH/DELETE /api/tasks/[id] return 404 for a nonexistent id', async () => {
		if (!ensureAuth()) return;
		const id = rid();
		expect((await api(`/api/tasks/${id}`)).status).toBe(404);
		expect(
			(await api(`/api/tasks/${id}`, { method: 'PATCH', json: { title: 'x' } })).status
		).toBe(404);
		expect((await api(`/api/tasks/${id}`, { method: 'DELETE' })).status).toBe(404);
	});

	it('DELETE /api/tasks/[id] removes the task and its sub-tasks (204 then 404)', async () => {
		if (!ensureAuth()) return;
		const { id: projectId } = await createProject(`itest-project-${rid()}`);
		const parent = await (
			await api('/api/tasks', { method: 'POST', json: { projectId, title: 'Del parent' } })
		).json();
		const child = await (
			await api('/api/tasks', {
				method: 'POST',
				json: { projectId, title: 'Del child', parentId: parent.task.id }
			})
		).json();

		const del = await api(`/api/tasks/${parent.task.id}`, { method: 'DELETE' });
		expect(del.status).toBe(204);
		expect((await api(`/api/tasks/${parent.task.id}`)).status).toBe(404);
		expect((await api(`/api/tasks/${child.task.id}`)).status).toBe(404);
	});

	it('DELETE /api/projects/[id] removes the project (204 then 404)', async () => {
		if (!ensureAuth()) return;
		const { id } = await createProject(`itest-project-${rid()}`);
		const del = await api(`/api/projects/${id}`, { method: 'DELETE' });
		expect(del.status).toBe(204);
		createdProjectIds.delete(id); // already gone — skip afterAll cleanup
		expect((await api(`/api/projects/${id}`)).status).toBe(404);
	});
});
