import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * ADR-062 cross-ORG isolation regression tests for the Baskets REST API.
 *
 * The cross-org twin of api-authz.test.ts: it drives the HTTP boundary as three
 * seeded principals and proves org boundaries hold end to end:
 *   - admin@baskets.local  → owner of org-default
 *   - demo@baskets.local   → plain member of org-default (holds one project grant)
 *   - owner2@baskets.local → owner of org-two (a SEPARATE tenant)
 *
 * Owner2 must see NOTHING of org-default (404/empty, never 403 — no existence
 * oracle); a plain member cannot list invitations (403) but can list the roster;
 * a plain member's workspace collection is limited to what they're granted; and a
 * freshly-registered user can accept an invitation link and join.
 *
 * Gated behind RUN_INTEGRATION (a broken/unseeded env FAILS loudly, per ADR-058).
 * Run: `RUN_INTEGRATION=1 npm run test:integration` against a running seeded server.
 */

const BASE = (process.env.TEST_BASE_URL ?? 'http://localhost:5173').replace(/\/$/, '');
const ADMIN_EMAIL = process.env.TEST_ADMIN_EMAIL ?? 'admin@baskets.local';
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD ?? 'admin-baskets-2026';
const DEMO_EMAIL = process.env.TEST_DEMO_EMAIL ?? 'demo@baskets.local';
const DEMO_PASSWORD = process.env.TEST_DEMO_PASSWORD ?? 'demo-baskets-2026';
const OWNER2_EMAIL = process.env.TEST_OWNER2_EMAIL ?? 'owner2@baskets.local';
const OWNER2_PASSWORD = process.env.TEST_OWNER2_PASSWORD ?? 'owner2-baskets-2026';

const ORG_DEFAULT = 'org-default';
const ORG_TWO = 'org-two';
const WS_DEFAULT = 'workspace-default';
// A STABLE seeded project id (scripts/seed.ts pid(1)). Using a seed constant — not
// `projects[0]` — keeps these probes deterministic even while other integration
// files concurrently create/delete transient projects on the shared server.
const SEED_PROJECT = 'seed-project-1';

const RUN_INTEGRATION = !!process.env.RUN_INTEGRATION;

const url = (path: string) => `${BASE}${path}`;
const ghostId = () => `ghost-${Math.random().toString(36).slice(2)}-${Date.now()}`;

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

async function signUp(email: string, password: string, name: string): Promise<string> {
	try {
		const res = await fetch(url('/api/auth/sign-up/email'), {
			method: 'POST',
			headers: { 'content-type': 'application/json', origin: BASE },
			body: JSON.stringify({ email, password, name })
		});
		if (!res.ok) return '';
		return collectCookies(res);
	} catch {
		return '';
	}
}

let serverUp = false;
let adminCookie = '';
let demoCookie = '';
let owner2Cookie = '';
let owner2Id = '';

beforeAll(async () => {
	serverUp = await ping();
	if (!serverUp) {
		if (RUN_INTEGRATION) throw new Error(`dev server not reachable at ${BASE}`);
		return;
	}
	adminCookie = await signIn(ADMIN_EMAIL, ADMIN_PASSWORD);
	demoCookie = await signIn(DEMO_EMAIL, DEMO_PASSWORD);
	owner2Cookie = await signIn(OWNER2_EMAIL, OWNER2_PASSWORD);
	if (!adminCookie || !owner2Cookie) {
		if (RUN_INTEGRATION)
			throw new Error('seeded sign-in failed — is the DB seeded (npm run db:seed)?');
		return;
	}

	// owner2's user id (for the grantee-not-a-member probe)
	const meRes = await fetch(url('/api/me'), { headers: { cookie: owner2Cookie } });
	if (meRes.ok) {
		const j = (await meRes.json()) as { user?: { id: string } };
		owner2Id = j.user?.id ?? '';
	}
}, 30_000);

describe.skipIf(!RUN_INTEGRATION)('REST cross-org isolation / ADR-062 (live :5173)', () => {
	describe('(A) owner2 (org-two) sees NOTHING of org-default — 404/empty, never 403', () => {
		it('GET /api/orgs/org-default → 404 (org invisible to a non-member)', async () => {
			if (!serverUp || !owner2Cookie) return;
			const res = await fetch(url(`/api/orgs/${ORG_DEFAULT}`), {
				headers: { cookie: owner2Cookie }
			});
			expect(res.status).toBe(404);
			expect(res.status).not.toBe(403);
		});

		it('GET /api/orgs/org-default/members → 404', async () => {
			if (!serverUp || !owner2Cookie) return;
			const res = await fetch(url(`/api/orgs/${ORG_DEFAULT}/members`), {
				headers: { cookie: owner2Cookie }
			});
			expect(res.status).toBe(404);
		});

		it('GET /api/orgs/org-default/invites → 404 (never 403 — no existence oracle)', async () => {
			if (!serverUp || !owner2Cookie) return;
			const res = await fetch(url(`/api/orgs/${ORG_DEFAULT}/invites`), {
				headers: { cookie: owner2Cookie }
			});
			expect(res.status).toBe(404);
			expect(res.status).not.toBe(403);
		});

		it('GET a real org-default project → 404 (cross-org)', async () => {
			if (!serverUp || !owner2Cookie) return;
			const res = await fetch(url(`/api/projects/${SEED_PROJECT}`), {
				headers: { cookie: owner2Cookie }
			});
			expect(res.status).toBe(404);
		});

		it('GET org-default’s workspace → 404 (cross-org)', async () => {
			if (!serverUp || !owner2Cookie) return;
			const res = await fetch(url(`/api/workspaces/${WS_DEFAULT}`), {
				headers: { cookie: owner2Cookie }
			});
			expect(res.status).toBe(404);
		});

		it('owner2’s workspace/project collections never leak org-default rows', async () => {
			if (!serverUp || !owner2Cookie) return;
			const ws = await fetch(url('/api/workspaces'), { headers: { cookie: owner2Cookie } });
			expect(ws.status).toBe(200);
			const wsText = await ws.text();
			expect(wsText).not.toContain(WS_DEFAULT);

			const proj = await fetch(url('/api/projects'), { headers: { cookie: owner2Cookie } });
			const projText = await proj.text();
			expect(projText).not.toContain(SEED_PROJECT);
		});

		it('sanity: owner2 CAN see its own org-two (200)', async () => {
			if (!serverUp || !owner2Cookie) return;
			const res = await fetch(url(`/api/orgs/${ORG_TWO}`), { headers: { cookie: owner2Cookie } });
			expect(res.status).toBe(200);
		});
	});

	describe('(B) a plain member of org-default: roster yes, invites no', () => {
		it('demo GET /api/orgs/org-default/members → 200 (any member may list the roster)', async () => {
			if (!serverUp || !demoCookie) return;
			const res = await fetch(url(`/api/orgs/${ORG_DEFAULT}/members`), {
				headers: { cookie: demoCookie }
			});
			expect(res.status).toBe(200);
		});

		it('demo GET /api/orgs/org-default/invites → 403 (owner/admin-only surface)', async () => {
			if (!serverUp || !demoCookie) return;
			const res = await fetch(url(`/api/orgs/${ORG_DEFAULT}/invites`), {
				headers: { cookie: demoCookie }
			});
			expect(res.status).toBe(403);
		});

		it('demo GET /api/workspaces never leaks another org’s workspaces (isolation)', async () => {
			if (!serverUp || !demoCookie) return;
			const res = await fetch(url('/api/workspaces'), { headers: { cookie: demoCookie } });
			expect(res.status).toBe(200);
			const j = (await res.json()) as {
				workspaces?: Array<{ id: string; organizationId?: string }>;
			};
			const list = j.workspaces ?? [];
			// whatever demo sees, it is only org-default (never org-two) — the isolation
			// guarantee holds regardless of the grant-visibility bug below.
			expect(list.every((w) => w.organizationId === ORG_DEFAULT || w.organizationId == null)).toBe(
				true
			);
		});

		// FINDING (scripts/seed.ts — OUT OF W5 SCOPE, reported not fixed): the seeded demo
		// grant row `seed-perm-1` is inserted with organizationId = NULL. `grantedProjectIds`
		// filters grants by organizationId, so demo's granted project (and thus its
		// workspace) is INVISIBLE in /api/projects and /api/workspaces — a seeded member
		// lands on an EMPTY app. (Inconsistently, canAccessProject uses org-agnostic
		// hasGrant, so demo CAN still deep-link seed-project-1.) This test asserts the
		// CORRECT post-fix behavior and is expected to FAIL until seed.ts stamps
		// organizationId: ORG_ID on the demo grant. Remove `.fails` once fixed.
		it.fails(
			'demo should see its granted project’s workspace (BLOCKED: seed grant org-null)',
			async () => {
				if (!serverUp || !demoCookie) throw new Error('server down — treat as expected-fail');
				const res = await fetch(url('/api/workspaces'), { headers: { cookie: demoCookie } });
				const j = (await res.json()) as { workspaces?: Array<{ id: string }> };
				expect((j.workspaces ?? []).some((w) => w.id === WS_DEFAULT)).toBe(true);
			}
		);
	});

	describe('(C) grant writes: grantee must be a member (out-of-org ≡ nonexistent, no oracle)', () => {
		it('admin granting an org-two user on an org-default project → 400 Unknown user', async () => {
			if (!serverUp || !adminCookie || !owner2Id) return;
			const res = await fetch(url(`/api/projects/${SEED_PROJECT}/grants`), {
				method: 'POST',
				headers: { 'content-type': 'application/json', cookie: adminCookie },
				body: JSON.stringify({ userId: owner2Id })
			});
			expect(res.status).toBe(400); // owner2 is not a member of org-default
			const ghost = await fetch(url(`/api/projects/${SEED_PROJECT}/grants`), {
				method: 'POST',
				headers: { 'content-type': 'application/json', cookie: adminCookie },
				body: JSON.stringify({ userId: ghostId() })
			});
			// identical status for an out-of-org user and a nonexistent one (no oracle).
			expect(ghost.status).toBe(400);
		});
	});

	describe('(D) invitation accept round-trip with a freshly-registered user', () => {
		const freshEmail = `invitee-${Date.now()}-${Math.random().toString(36).slice(2)}@example.invalid`;
		let inviteId = '';
		let freshCookie = '';

		it('admin invites the fresh email → a pending invitation id', async () => {
			if (!serverUp || !adminCookie) return;
			const res = await fetch(url(`/api/orgs/${ORG_DEFAULT}/invites`), {
				method: 'POST',
				headers: { 'content-type': 'application/json', cookie: adminCookie },
				body: JSON.stringify({ email: freshEmail, role: 'member' })
			});
			expect(res.status).toBe(201);
			const j = (await res.json()) as { invitation?: { id: string } };
			inviteId = j.invitation?.id ?? '';
			expect(inviteId).not.toBe('');
		});

		it('the fresh user registers, cannot see org-default yet (404), then accepts and joins (200)', async () => {
			if (!serverUp || !inviteId) return;
			freshCookie = await signUp(freshEmail, 'invitee-pass-2026', 'Invitee');
			expect(freshCookie).not.toBe('');

			const before = await fetch(url(`/api/orgs/${ORG_DEFAULT}`), {
				headers: { cookie: freshCookie }
			});
			expect(before.status).toBe(404); // not a member yet

			const accept = await fetch(url(`/api/invites/${inviteId}/accept`), {
				method: 'POST',
				headers: { cookie: freshCookie }
			});
			expect(accept.status).toBe(200);
			const j = (await accept.json()) as { orgId?: string };
			expect(j.orgId).toBe(ORG_DEFAULT);

			const after = await fetch(url(`/api/orgs/${ORG_DEFAULT}`), {
				headers: { cookie: freshCookie }
			});
			expect(after.status).toBe(200); // now a member
		});

		afterAll(async () => {
			// best-effort: the fresh user leaves org-default so reruns stay clean.
			if (!freshCookie) return;
			try {
				const me = await fetch(url('/api/me'), { headers: { cookie: freshCookie } });
				if (!me.ok) return;
				const j = (await me.json()) as { user?: { id: string } };
				const uid = j.user?.id;
				if (uid)
					await fetch(url(`/api/orgs/${ORG_DEFAULT}/members/${uid}`), {
						method: 'DELETE',
						headers: { cookie: freshCookie }
					});
			} catch {
				/* ignore */
			}
		});
	});
});
