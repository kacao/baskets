import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '$lib/server/db';
import { integration } from '$lib/server/db/schema.sqlite';
import { eq } from 'drizzle-orm';
import { projectAccessUserIds } from '$lib/server/permissions';
import { deleteOrganizationGuarded, leaveOrgService } from '$lib/server/orgs';
import { resetTables } from './isolationGuard';
import { createIntegration, createMember, createOrg, seedTwoOrgFixture } from './helpers/testDb';

// Regression tests for confirmed findings of the ADR-062 final adversarial review.
// (The migration marker-loss guard is tested in migration.test.ts, which owns the
// vi.resetModules() isolation the module-level `migrated` flag requires.)
beforeEach(async () => {
	await resetTables();
});

describe('projectAccessUserIds membership prerequisite (isolation)', () => {
	it('drops a grantee who has left the org (grant survives but roster excludes them)', async () => {
		const f = await seedTwoOrgFixture();
		// memberAGrant holds a direct project grant on projA and is in the roster.
		const before = await projectAccessUserIds(f.projA.id, f.wsA.id);
		expect(before.has(f.memberAGrant.id)).toBe(true);

		// They leave orgA. leaveOrgService deletes only the member row (the grant is
		// intentionally left inert), so the roster must now exclude them.
		const res = await leaveOrgService(f.memberAGrant.id, f.orgA.id);
		expect(res.ok).toBe(true);

		const after = await projectAccessUserIds(f.projA.id, f.wsA.id);
		expect(after.has(f.memberAGrant.id)).toBe(false);
		// the workspace owner (also org owner) is still present
		expect(after.has(f.ownerA.id)).toBe(true);
	});

	it('never seeds instance admins or out-of-org users', async () => {
		const f = await seedTwoOrgFixture();
		const roster = await projectAccessUserIds(f.projA.id, f.wsA.id);
		expect(roster.has(f.instanceAdmin.id)).toBe(false);
		expect(roster.has(f.ownerB.id)).toBe(false);
		expect(roster.has(f.stranger.id)).toBe(false);
	});
});

describe('deleteOrganizationGuarded sweeps org-scoped singletons', () => {
	it('removes the org integration row (Slack webhook secret) on delete', async () => {
		const org = await createOrg('Disposable');
		const owner = await createMember(org.id, 'owner');
		await createIntegration(org.id, owner.id, { webhookUrl: 'https://hooks.slack.com/x' });

		// org must have 0 workspaces to be deletable; it has none here.
		const res = await deleteOrganizationGuarded(org.id, owner.id);
		expect(res.ok).toBe(true);

		const left = await db
			.select({ id: integration.id })
			.from(integration)
			.where(eq(integration.organizationId, org.id));
		expect(left).toHaveLength(0);
	});
});
