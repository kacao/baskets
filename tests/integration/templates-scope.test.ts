import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Regression test for the cross-scope template fix (BASDEV-8 / templates.ts).
 *
 * `instantiateTemplate` must only create tasks from a template into a project
 * that template belongs to: the template's own project, or a project in the
 * same workspace (for workspace-scoped templates). A project-scoped template
 * from project A must NOT be instantiable into a different project B — doing so
 * would copy A's tasks into B. The REST POST instantiate path surfaces this
 * rejection as a non-2xx (400 "Template could not be instantiated") and must
 * NOT create any task in B.
 *
 * This exercises the real HTTP surface against the RUNNING dev server:
 *   POST /api/projects/[id]/templates  { name, scope, payload }      (create)
 *   POST /api/projects/[id]/templates  { templateId, instantiate }   (instantiate)
 *
 * Cross-workspace: there is no REST endpoint to create a workspace, so if a
 * second workspace already exists (discovered from existing projects' rows) the
 * test asserts the strong cross-WORKSPACE rejection; otherwise it falls back to
 * a cross-PROJECT (same-workspace) rejection — still a valid proof that a
 * project-scoped template can't leak into another project.
 *
 * Auth: signs in the seeded admin via BetterAuth (scripts/seed.ts creds) with an
 * Origin header and reuses the session cookie. If the server is unreachable or
 * auth can't be established, the suite SKIPS with a clear message.
 *
 * Self-cleaning: every project created here is deleted in afterAll (cascading
 * its tasks + project-scoped templates).
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

	// 2) Sign in via BetterAuth (mounted by hooks at /api/auth/...). Origin-aware.
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
		console.warn(`[templates-scope] SKIPPED: ${skipReason}`);
		return false;
	}
	return true;
}

const rid = () => crypto.randomUUID();

/** Create a project, optionally in a specific workspace. Returns id + workspaceId. */
async function createProject(
	name: string,
	workspaceId?: string
): Promise<{ id: string; workspaceId: string | null }> {
	const res = await api('/api/projects', {
		method: 'POST',
		json: workspaceId ? { name, workspaceId } : { name }
	});
	const body = await res.json().catch(() => null);
	const id = body?.project?.id as string | undefined;
	if (id) createdProjectIds.add(id);
	return { id: id ?? '', workspaceId: body?.project?.workspaceId ?? null };
}

/** Number of tasks currently in a project (via GET /api/projects/[id]). */
async function taskCount(projectId: string): Promise<number> {
	const res = await api(`/api/projects/${projectId}`);
	if (!res.ok) return -1;
	const { tasks } = await res.json();
	return Array.isArray(tasks) ? tasks.length : -1;
}

/**
 * Find a workspace id different from `excludeWs` that the admin can create
 * projects in. There's no REST workspace-create, so probe existing projects'
 * workspace ids; return null when only one workspace is reachable.
 */
async function findOtherWorkspaceId(excludeWs: string): Promise<string | null> {
	const res = await api('/api/projects');
	if (!res.ok) return null;
	const { projects } = await res.json();
	const candidates = new Set<string>();
	for (const p of projects ?? []) {
		if (p?.workspaceId && p.workspaceId !== excludeWs) candidates.add(p.workspaceId);
	}
	for (const ws of candidates) {
		// Confirm the admin can actually create a project in it (canEditWorkspace).
		const probe = await api('/api/projects', {
			method: 'POST',
			json: { name: `itest-ws-probe-${rid()}`, workspaceId: ws }
		});
		if (probe.status === 201) {
			const body = await probe.json().catch(() => null);
			const id = body?.project?.id;
			if (id) createdProjectIds.add(id);
			return ws;
		}
	}
	return null;
}

describe.skipIf(!RUN_INTEGRATION)('templates: cross-scope instantiation is rejected (regression)', () => {
	it('does not copy project A’s template tasks into a different project B', async () => {
		if (!ensureAuth()) return;

		// Project A + a project-scoped template that carries a recognisable task.
		const a = await createProject(`itest-tmpl-A-${rid()}`);
		expect(a.id).toBeTruthy();

		const tplPayload = {
			task: { title: 'LEAKED-FROM-A', description: 'should never appear in B', priority: 'high' },
			subtasks: [{ title: 'LEAKED-SUB-A' }]
		};
		const createTpl = await api(`/api/projects/${a.id}/templates`, {
			method: 'POST',
			json: { name: `itest-tmpl-${rid()}`, scope: 'project', payload: tplPayload }
		});
		expect(createTpl.status).toBe(201);
		const templateId = (await createTpl.json()).id as string;
		expect(templateId).toBeTruthy();

		// Project B — in a DIFFERENT workspace if one is reachable, else same.
		const otherWs = a.workspaceId ? await findOtherWorkspaceId(a.workspaceId) : null;
		const crossWorkspace = !!otherWs;
		const b = await createProject(`itest-tmpl-B-${rid()}`, otherWs ?? undefined);
		expect(b.id).toBeTruthy();
		if (crossWorkspace) {
			expect(b.workspaceId).toBe(otherWs);
			expect(b.workspaceId).not.toBe(a.workspaceId);
		}

		const before = await taskCount(b.id);
		expect(before).toBeGreaterThanOrEqual(0);

		// Instantiate A's template against B — must be REJECTED, not copied.
		const inst = await api(`/api/projects/${b.id}/templates`, {
			method: 'POST',
			json: { templateId, instantiate: true }
		});
		expect(inst.ok).toBe(false);
		expect([400, 404]).toContain(inst.status);

		// And B must be untouched — none of A's tasks leaked in.
		const after = await taskCount(b.id);
		expect(after).toBe(before);

		const bState = await (await api(`/api/projects/${b.id}`)).json();
		const titles = (bState.tasks ?? []).map((t: any) => t.title);
		expect(titles).not.toContain('LEAKED-FROM-A');
		expect(titles).not.toContain('LEAKED-SUB-A');
	});

	it('still instantiates a template into its OWN project (in-scope success)', async () => {
		if (!ensureAuth()) return;

		const p = await createProject(`itest-tmpl-own-${rid()}`);
		expect(p.id).toBeTruthy();

		const title = `itest-in-scope-${rid()}`;
		const subTitle = `itest-in-scope-sub-${rid()}`;
		const createTpl = await api(`/api/projects/${p.id}/templates`, {
			method: 'POST',
			json: {
				name: `itest-tmpl-${rid()}`,
				scope: 'project',
				payload: { task: { title }, subtasks: [{ title: subTitle }] }
			}
		});
		expect(createTpl.status).toBe(201);
		const templateId = (await createTpl.json()).id as string;

		const before = await taskCount(p.id);
		const inst = await api(`/api/projects/${p.id}/templates`, {
			method: 'POST',
			json: { templateId, instantiate: true }
		});
		expect(inst.status).toBe(201);
		const { taskId } = await inst.json();
		expect(taskId).toBeTruthy();

		// The parent + sub-task now exist in this project.
		const after = await taskCount(p.id);
		expect(after).toBe(before + 2);

		const state = await (await api(`/api/projects/${p.id}`)).json();
		const titles = (state.tasks ?? []).map((t: any) => t.title);
		expect(titles).toContain(title);
		expect(titles).toContain(subTitle);

		const parent = (state.tasks ?? []).find((t: any) => t.id === taskId);
		expect(parent?.parentId).toBeNull();
	});
});
