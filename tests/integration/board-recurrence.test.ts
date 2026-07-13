import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Regression test for the board-drag recurrence-spawn bug (Plan 003): completing
 * a recurring task by dragging it onto a completed-category board column (the
 * `moveTask` form action → `moveTaskService`) must spawn the next occurrence,
 * same as the status dropdown (`setTaskStatusService`) and REST PATCH
 * (`updateTaskService` with `completeCascade`) already do.
 *
 * Modeled on tests/integration/task-mutations.test.ts — same auth/skip/cleanup
 * shape, run against the RUNNING dev server.
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

/** Board drag-and-drop form action: POST /projects/{id}?/moveTask. */
async function moveTask(projectId: string, id: string, statusId: string): Promise<Response> {
	return fetch(`${BASE}/projects/${projectId}?/moveTask`, {
		method: 'POST',
		headers: {
			'content-type': 'application/x-www-form-urlencoded',
			origin: BASE,
			...(cookie ? { cookie } : {})
		},
		body: new URLSearchParams({ id, statusId }).toString()
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
		console.warn(`[board-recurrence] SKIPPED: ${skipReason}`);
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

describe.skipIf(!RUN_INTEGRATION)('board drag recurrence spawn (regression)', () => {
	it('spawns the next occurrence when a recurring task is completed via board drag', async () => {
		if (!ensureAuth()) return;
		const projectId = await createProject(`itest-project-${rid()}`);

		const projRes = await api(`/api/projects/${projectId}`);
		const projData = await projRes.json();
		const completedStatus = projData.statuses.find(
			(s: { category: string }) => s.category === 'completed'
		);
		expect(completedStatus).toBeTruthy();
		const completedId = completedStatus.id;

		const title = `recur-${rid()}`;
		const created = await (
			await api('/api/tasks', {
				method: 'POST',
				json: { projectId, title, dueDate: '2026-01-01' }
			})
		).json();
		const id = created.task.id;

		const patch = await api(`/api/tasks/${id}`, {
			method: 'PATCH',
			json: { recurrence: 'weekly:1' }
		});
		expect(patch.status).toBe(200);

		const move = await moveTask(projectId, id, completedId);
		expect(move.status).toBe(200);

		const after = await (await api(`/api/projects/${projectId}`)).json();
		const matching = after.tasks.filter((t: { title: string }) => t.title === title);
		expect(matching).toHaveLength(2);

		const original = matching.find((t: { id: string }) => t.id === id);
		expect(original.statusId).toBe(completedId);

		const spawned = matching.find((t: { id: string }) => t.id !== id);
		expect(spawned).toBeTruthy();
		expect(spawned.recurrence).toBe('weekly:1');
		expect(spawned.dueDate?.slice(0, 10)).toBe('2026-01-08');
		const spawnedStatus = after.statuses.find(
			(s: { id: string }) => s.id === spawned.statusId
		);
		expect(spawnedStatus?.category).toBe('backlog');
	});
});
