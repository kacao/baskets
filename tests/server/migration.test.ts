import { beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq, isNull } from 'drizzle-orm';
import { resetTables, SENTINEL_WORKSPACE_ID, SENTINEL_USER_ID } from './isolationGuard';

beforeEach(resetTables);

// ADR-062 D9 — the one-time boot migration `ensureDefaultOrganization`. It is
// guarded by a module-level `migrated` flag + a durable marker on `org-default`,
// so each scenario needs a FRESH module instance. We `vi.resetModules()` per test
// and re-import the db/schema/migration from the fresh graph.
//
// HARNESS NOTES (documented in the report):
//   * The sentinel organization ALWAYS exists, so `orgs.length === 0` (the pure
//     legacy-entry condition) is unreachable. We drive the identical migration
//     BODY through the resumable `org-default exists, unmarked` entry instead —
//     same steps 1-7, same guarantees.
//   * The sentinel user/workspace also exist. We seed test users/workspaces with
//     epoch-era createdAt so they sort OLDER than the sentinel, making owner
//     selection deterministic and independent of the sentinel.

const DEFAULT_ORG_ID = 'org-default';

type FreshModules = {
	db: (typeof import('$lib/server/db'))['db'];
	schema: typeof import('$lib/server/db/schema.sqlite');
	ensureDefaultOrganization: (typeof import('$lib/server/workspaces'))['ensureDefaultOrganization'];
};

/**
 * Reset the module registry (so `migrated` starts false) and re-import the
 * migration on a FRESH db connection. CRITICAL SAFETY: assert the sentinel
 * workspace is visible through this fresh connection BEFORE returning it — this
 * replicates the isolationGuard tripwire so a mis-resolved DATABASE_URL can never
 * let this file mutate the dev DB.
 */
async function freshModules(): Promise<FreshModules> {
	vi.resetModules();
	const { db } = await import('$lib/server/db');
	const schema = await import('$lib/server/db/schema.sqlite');
	const { ensureDefaultOrganization } = await import('$lib/server/workspaces');
	const sentinel = await db
		.select()
		.from(schema.workspace)
		.where(eq(schema.workspace.id, SENTINEL_WORKSPACE_ID));
	if (sentinel.length === 0) {
		throw new Error(
			'ISOLATION FAILED (migration test): fresh db connection is not the test DB. Aborting.'
		);
	}
	return { db, schema, ensureDefaultOrganization };
}

async function seedUser(
	db: FreshModules['db'],
	schema: FreshModules['schema'],
	id: string,
	role: string | null,
	createdAtMs: number
) {
	await db.insert(schema.user).values({
		id,
		name: id,
		email: `${id}@example.invalid`,
		emailVerified: false,
		role,
		createdAt: new Date(createdAtMs),
		updatedAt: new Date(createdAtMs)
	});
}

/** Insert an UNMARKED org-default so the migration takes the resumable entry. */
async function seedUnmarkedOrgDefault(db: FreshModules['db'], schema: FreshModules['schema']) {
	await db
		.insert(schema.organization)
		.values({ id: DEFAULT_ORG_ID, name: 'Default', slug: 'default', createdAt: new Date(1000) });
}

describe('ensureDefaultOrganization — membership materialization (A9)', () => {
	it('oldest admin → owner, other admins → admin, everyone else (incl. the sentinel) → member; marker written', async () => {
		const { db, schema, ensureDefaultOrganization } = await freshModules();
		await seedUnmarkedOrgDefault(db, schema);
		await seedUser(db, schema, 'u-admin-old', 'admin', 1000);
		await seedUser(db, schema, 'u-admin-new', 'admin', 2000);
		await seedUser(db, schema, 'u-plain', null, 1500);

		await ensureDefaultOrganization();

		const roleOf = async (userId: string) => {
			const [m] = await db
				.select({ role: schema.member.role })
				.from(schema.member)
				.where(
					and(eq(schema.member.organizationId, DEFAULT_ORG_ID), eq(schema.member.userId, userId))
				);
			return m?.role ?? null;
		};
		expect(await roleOf('u-admin-old')).toBe('owner'); // oldest admin
		expect(await roleOf('u-admin-new')).toBe('admin');
		expect(await roleOf('u-plain')).toBe('member');
		expect(await roleOf(SENTINEL_USER_ID)).toBe('member'); // sentinel is non-admin

		// deterministic member id (mirrors the migration + seed)
		const [byId] = await db
			.select()
			.from(schema.member)
			.where(eq(schema.member.id, `member-org-default-u-admin-old`));
		expect(byId?.role).toBe('owner');

		// completion marker written LAST
		const [org] = await db
			.select()
			.from(schema.organization)
			.where(eq(schema.organization.id, DEFAULT_ORG_ID));
		expect(JSON.parse(org.metadata!)?.migrated).toBe(true);
	});

	it('no-admin fallback: the oldest user overall becomes owner', async () => {
		const { db, schema, ensureDefaultOrganization } = await freshModules();
		await seedUnmarkedOrgDefault(db, schema);
		// both non-admin, both epoch-era so they sort older than the 2026 sentinel
		await seedUser(db, schema, 'u-first', null, 1000);
		await seedUser(db, schema, 'u-second', null, 2000);

		await ensureDefaultOrganization();

		const roleOf = async (userId: string) => {
			const [m] = await db
				.select({ role: schema.member.role })
				.from(schema.member)
				.where(
					and(eq(schema.member.organizationId, DEFAULT_ORG_ID), eq(schema.member.userId, userId))
				);
			return m?.role ?? null;
		};
		expect(await roleOf('u-first')).toBe('owner'); // oldest user, no admin present
		expect(await roleOf('u-second')).toBe('member');
	});
});

describe('ensureDefaultOrganization — stamping + pruning (A9)', () => {
	it('stamps null-org workspace/integration, adopts orphan projects, stamps/prunes permission + notification', async () => {
		const { db, schema, ensureDefaultOrganization } = await freshModules();
		await seedUnmarkedOrgDefault(db, schema);
		await seedUser(db, schema, 'u-owner', 'admin', 1000);

		// a legacy workspace with NO org, older than the sentinel → it becomes the adopter
		await db.insert(schema.workspace).values({
			id: 'ws-legacy',
			name: 'Legacy',
			ownerId: 'u-owner',
			organizationId: null,
			createdAt: new Date(500),
			updatedAt: new Date(500)
		});
		// an orphan project (no workspace) to be adopted
		await db.insert(schema.project).values({
			id: 'p-orphan',
			name: 'Orphan',
			workspaceId: null,
			createdBy: 'u-owner',
			createdAt: new Date(600),
			updatedAt: new Date(600)
		});
		// a legacy Slack integration with no org (dispatch would silently die unstamped)
		await db.insert(schema.integration).values({
			id: 'int-legacy',
			type: 'slack',
			organizationId: null,
			enabled: true,
			config: '{}',
			createdBy: 'u-owner',
			createdAt: new Date(500),
			updatedAt: new Date(500)
		});
		// a resolvable grant (on the orphan project) + an unresolvable one (ghost id)
		await db.insert(schema.permission).values([
			{
				id: 'perm-ok',
				userId: 'u-owner',
				resourceType: 'project',
				resourceId: 'p-orphan',
				organizationId: null,
				grantedBy: 'u-owner',
				createdAt: new Date(700)
			},
			{
				id: 'perm-ghost',
				userId: 'u-owner',
				resourceType: 'project',
				resourceId: 'does-not-exist',
				organizationId: null,
				grantedBy: 'u-owner',
				createdAt: new Date(700)
			}
		]);
		// a derivable notification (has projectId) + an underivable one (null projectId)
		await db.insert(schema.notification).values([
			{
				id: 'notif-ok',
				userId: 'u-owner',
				type: 'mention',
				body: 'x',
				organizationId: null,
				projectId: 'p-orphan',
				taskId: null,
				read: false,
				createdAt: new Date(800)
			},
			{
				id: 'notif-orphan',
				userId: 'u-owner',
				type: 'mention',
				body: 'y',
				organizationId: null,
				projectId: null,
				taskId: null,
				read: false,
				createdAt: new Date(800)
			}
		]);

		await ensureDefaultOrganization();

		// workspace + integration stamped
		const [ws] = await db
			.select()
			.from(schema.workspace)
			.where(eq(schema.workspace.id, 'ws-legacy'));
		expect(ws.organizationId).toBe(DEFAULT_ORG_ID);
		const [int] = await db
			.select()
			.from(schema.integration)
			.where(eq(schema.integration.id, 'int-legacy'));
		expect(int.organizationId).toBe(DEFAULT_ORG_ID);

		// orphan project adopted into the oldest workspace (ws-legacy)
		const [proj] = await db.select().from(schema.project).where(eq(schema.project.id, 'p-orphan'));
		expect(proj.workspaceId).toBe('ws-legacy');
		// no orphans remain
		expect(
			await db.select().from(schema.project).where(isNull(schema.project.workspaceId))
		).toHaveLength(0);

		// permission: resolvable stamped, unresolvable pruned
		const [permOk] = await db
			.select()
			.from(schema.permission)
			.where(eq(schema.permission.id, 'perm-ok'));
		expect(permOk.organizationId).toBe(DEFAULT_ORG_ID);
		expect(
			await db.select().from(schema.permission).where(eq(schema.permission.id, 'perm-ghost'))
		).toHaveLength(0);

		// notification: derivable stamped, underivable pruned
		const [notifOk] = await db
			.select()
			.from(schema.notification)
			.where(eq(schema.notification.id, 'notif-ok'));
		expect(notifOk.organizationId).toBe(DEFAULT_ORG_ID);
		expect(
			await db.select().from(schema.notification).where(eq(schema.notification.id, 'notif-orphan'))
		).toHaveLength(0);
	});
});

describe('ensureDefaultOrganization — idempotency + fresh install (A9)', () => {
	it('a second run in a fresh process no-ops via the marker (no duplicate members)', async () => {
		const first = await freshModules();
		await seedUnmarkedOrgDefault(first.db, first.schema);
		await seedUser(first.db, first.schema, 'u-a', 'admin', 1000);
		await seedUser(first.db, first.schema, 'u-b', null, 2000);
		await first.ensureDefaultOrganization();

		const countMembers = async (db: FreshModules['db'], schema: FreshModules['schema']) =>
			(
				await db
					.select()
					.from(schema.member)
					.where(eq(schema.member.organizationId, DEFAULT_ORG_ID))
			).length;
		const after1 = await countMembers(first.db, first.schema);
		expect(after1).toBeGreaterThan(0);

		// a fresh process (migrated=false) sees the marker → early return, no writes
		const second = await freshModules();
		await second.ensureDefaultOrganization();
		const after2 = await countMembers(second.db, second.schema);
		expect(after2).toBe(after1);
	});

	it('a fresh-ish state (sentinel only, no org-default) creates NOTHING', async () => {
		const { db, schema, ensureDefaultOrganization } = await freshModules();
		// no org-default, no legacy data seeded → shouldRun is false (orgs.length ≥ 1 due
		// to the sentinel, orgDefault undefined). The migration must be a pure no-op.
		await ensureDefaultOrganization();

		expect(
			await db.select().from(schema.organization).where(eq(schema.organization.id, DEFAULT_ORG_ID))
		).toHaveLength(0);
		// no memberships created anywhere
		expect(await db.select().from(schema.member)).toHaveLength(0);
	});
});
