import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Regression/investigation test for Plan 020: does firing two concurrent
 * "complete" PATCHes on a recurring task spawn TWO next-occurrences (a
 * duplicate) instead of one? Run against the RUNNING dev server
 * (ADR-019/ADR-049), same pattern as task-mutations.test.ts /
 * delete-file-cleanup.test.ts.
 *
 * `updateTaskService` (src/lib/server/tasks.ts) reads `existing` + computes
 * `wasDone`/`didCascade` BEFORE its `withTransaction` block, then only
 * re-writes + spawns inside the transaction — the completed-decision itself
 * is a pre-transaction snapshot, not re-verified inside the critical section.
 * Two concurrent `PATCH /api/tasks/[id] { status: 'Completed' }` calls could
 * each observe `wasDone === false` and each spawn a next occurrence.
 *
 * Correct outcome per race: exactly 2 tasks with the unique title (the
 * original, now completed, + ONE spawn). A reproduced double-spawn = 3.
 *
 * Self-cleaning: every project created here is deleted in afterAll (cascading
 * its tasks).
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
		console.warn(`[recurrence-race] SKIPPED: ${skipReason}`);
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

async function createRecurringTask(projectId: string, title: string): Promise<string> {
	const createRes = await api('/api/tasks', {
		method: 'POST',
		json: { projectId, title, dueDate: '2026-01-01' }
	});
	const createBody = await createRes.json().catch(() => null);
	const id = createBody?.task?.id;
	expect(id, `task creation failed: ${JSON.stringify(createBody)}`).toBeTruthy();

	const recRes = await api(`/api/tasks/${id}`, {
		method: 'PATCH',
		json: { recurrence: 'weekly:1' }
	});
	expect(recRes.status, `recurrence PATCH failed: ${recRes.status}`).toBe(200);
	return id;
}

/** Count tasks in a project whose title === the given title. */
async function countByTitle(projectId: string, title: string): Promise<number> {
	const res = await api(`/api/projects/${projectId}`);
	const body = await res.json().catch(() => null);
	const tasks: Array<{ title: string }> = body?.tasks ?? [];
	return tasks.filter((t) => t.title === title).length;
}

const rid = () => crypto.randomUUID();

describe.skipIf(!RUN_INTEGRATION)(
	'recurrence spawn race on concurrent completes (Plan 020)',
	() => {
		it('firing two concurrent PATCH .../Completed on a recurring task spawns exactly ONE next occurrence, every iteration', async () => {
			if (!ensureAuth()) return;

			const projectId = await createProject(`Recurrence race ${rid()}`);
			expect(projectId).toBeTruthy();

			const ITERATIONS = 12;
			const counts: number[] = [];

			for (let i = 0; i < ITERATIONS; i++) {
				const title = `race-task-${rid()}`;
				const taskId = await createRecurringTask(projectId, title);

				const [a, b] = await Promise.all([
					api(`/api/tasks/${taskId}`, { method: 'PATCH', json: { status: 'Completed' } }),
					api(`/api/tasks/${taskId}`, { method: 'PATCH', json: { status: 'Completed' } })
				]);
				expect([a.status, b.status]).toEqual([200, 200]);

				const count = await countByTitle(projectId, title);
				counts.push(count);
			}

			// eslint-disable-next-line no-console
			console.log('[recurrence-race] per-iteration task counts (expect 2 always):', counts);

			expect(
				counts.every((c) => c === 2),
				`expected every iteration to be 2, got: ${counts.join(',')}`
			).toBe(true);
		});
	}
);
