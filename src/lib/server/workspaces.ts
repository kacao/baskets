import { and, asc, eq, isNotNull, isNull } from 'drizzle-orm';
import { db, withTransaction } from './db';
import {
	integration,
	label,
	labelGroup,
	member,
	notification,
	organization,
	permission,
	project,
	status,
	task,
	user,
	view,
	workspace
} from './db/schema';

export const DEFAULT_WORKSPACE_ID = 'workspace-default';
export const DEFAULT_ORG_ID = 'org-default';

// One-time, marker-gated boot migration (ADR-062 D9). Replaces the old
// ensureDefaultWorkspace request-loop: it adopts the single-tenant install into a
// default organization exactly once, then no-ops forever (the marker on the
// org-default row is authoritative; the in-memory flags avoid per-request DB hits).
let migrated = false;
let inflight: Promise<void> | null = null;

function hasMarker(metadata: string | null): boolean {
	if (!metadata) return false;
	try {
		return JSON.parse(metadata)?.migrated === true;
	} catch {
		return false;
	}
}

/**
 * Idempotent, crash-resumable migration of a legacy single-tenant install to the
 * organization model. Body runs only when there is legacy data to adopt:
 *   (no org rows AND ≥1 workspace row) OR (org-default exists without its marker).
 * Fresh installs (no workspace rows) create NOTHING — the first user owns their
 * org via the plugin + /onboarding. Every step is idempotent; the whole body is
 * wrapped in one transaction and the completion marker is written LAST.
 */
export async function ensureDefaultOrganization(): Promise<void> {
	if (migrated) return;
	if (inflight) return inflight;
	inflight = runMigration().finally(() => {
		inflight = null;
	});
	return inflight;
}

async function runMigration(): Promise<void> {
	const orgs = await db
		.select({ id: organization.id, metadata: organization.metadata })
		.from(organization);
	const orgDefault = orgs.find((o) => o.id === DEFAULT_ORG_ID);
	if (orgDefault && hasMarker(orgDefault.metadata)) {
		migrated = true;
		return;
	}

	const [anyWs] = await db.select({ id: workspace.id }).from(workspace).limit(1);
	const hasWorkspaces = !!anyWs;

	// (no org rows AND ≥1 workspace) OR (org-default exists, unmarked → resume).
	const shouldRun = (orgs.length === 0 && hasWorkspaces) || orgDefault !== undefined;
	if (!shouldRun) {
		// Fresh install (no legacy data) or already-consistent: nothing to migrate.
		// Mark done so this doesn't re-query on every request — no legacy (org-less)
		// data can appear after boot on a DB that has none (all post-org insert paths
		// stamp organizationId), and a restore/reseed implies a process restart.
		migrated = true;
		return;
	}

	// NOTE: the marker on org-default gates re-runs. The realistic vector for CLEARING
	// that marker (an org admin PATCHing organization.metadata) is blocked upstream by
	// auth.ts's beforeUpdateOrganization hook, so this one-time backfill can't be
	// weaponised to force-join users. A direct DB edit that cleared the marker would
	// re-run the (idempotent) backfill — acceptable for a self-hosted operator who
	// already has full DB access.

	await withTransaction(async (tx) => {
		const now = new Date();

		// 1. Legacy orphan adoption (the old ensureDefaultWorkspace body). Lives ONLY
		//    here — after the marker no adoption ever runs again.
		const [existingWs] = await tx.select({ id: workspace.id }).from(workspace).limit(1);
		if (!existingWs) {
			let [owner] = await tx
				.select({ id: user.id })
				.from(user)
				.where(eq(user.role, 'admin'))
				.limit(1);
			if (!owner)
				[owner] = await tx.select({ id: user.id }).from(user).orderBy(asc(user.createdAt)).limit(1);
			if (owner) {
				await tx
					.insert(workspace)
					.values({
						id: DEFAULT_WORKSPACE_ID,
						name: 'Default',
						ownerId: owner.id,
						createdAt: now,
						updatedAt: now
					})
					.onConflictDoNothing();
			}
		}
		const [adopter] = await tx
			.select({ id: workspace.id })
			.from(workspace)
			.orderBy(asc(workspace.createdAt))
			.limit(1);
		if (adopter) {
			await tx.update(project).set({ workspaceId: adopter.id }).where(isNull(project.workspaceId));
			await tx.update(label).set({ workspaceId: adopter.id }).where(isNull(label.workspaceId));
			await tx
				.update(labelGroup)
				.set({ workspaceId: adopter.id })
				.where(isNull(labelGroup.workspaceId));
			await tx
				.update(status)
				.set({ workspaceId: adopter.id })
				.where(
					and(isNull(status.workspaceId), isNull(status.projectId), eq(status.builtIn, false))
				);
		}

		// 2. Create org-default (marker deferred to step 7).
		await tx
			.insert(organization)
			.values({ id: DEFAULT_ORG_ID, name: 'Default', slug: 'default', createdAt: now })
			.onConflictDoNothing();

		// 3. Stamp org onto workspaces + integrations (Slack must be adopted or dispatch
		//    silently dies — the composite unique ignores NULL rows on sqlite).
		await tx
			.update(workspace)
			.set({ organizationId: DEFAULT_ORG_ID })
			.where(isNull(workspace.organizationId));
		await tx
			.update(integration)
			.set({ organizationId: DEFAULT_ORG_ID })
			.where(isNull(integration.organizationId));

		// 4. Membership for every existing user (banned included). Oldest admin → owner;
		//    if no admin, oldest user → owner; other admins → admin; everyone else member.
		const users = await tx
			.select({ id: user.id, role: user.role })
			.from(user)
			.orderBy(asc(user.createdAt));
		if (users.length > 0) {
			const admins = users.filter((u) => u.role === 'admin');
			const ownerId = admins.length > 0 ? admins[0].id : users[0].id;
			for (const u of users) {
				const role = u.id === ownerId ? 'owner' : u.role === 'admin' ? 'admin' : 'member';
				await tx
					.insert(member)
					.values({
						id: `member-org-default-${u.id}`,
						organizationId: DEFAULT_ORG_ID,
						userId: u.id,
						role,
						createdAt: now
					})
					.onConflictDoNothing();
			}
		}

		// 5. Stamp permission.organizationId by resolving each grant's resource chain
		//    (all four resourceTypes chain to org-default now); drop unresolvable rows.
		const [wsIds, projIds, viewIds, taskIds] = await Promise.all([
			tx.select({ id: workspace.id }).from(workspace),
			tx.select({ id: project.id }).from(project),
			tx.select({ id: view.id }).from(view),
			tx.select({ id: task.id }).from(task)
		]);
		const resolvable: Record<string, Set<string>> = {
			workspace: new Set(wsIds.map((r) => r.id)),
			project: new Set(projIds.map((r) => r.id)),
			view: new Set(viewIds.map((r) => r.id)),
			task: new Set(taskIds.map((r) => r.id))
		};
		const perms = await tx.select().from(permission);
		for (const p of perms) {
			const set = resolvable[p.resourceType];
			if (set && set.has(p.resourceId)) {
				await tx
					.update(permission)
					.set({ organizationId: DEFAULT_ORG_ID })
					.where(eq(permission.id, p.id));
			} else {
				await tx.delete(permission).where(eq(permission.id, p.id));
			}
		}

		// 6. Stamp notification.organizationId from projectId; delete the underivable
		//    remainder (project-less legacy bell rows — acceptable loss).
		await tx
			.update(notification)
			.set({ organizationId: DEFAULT_ORG_ID })
			.where(isNotNull(notification.projectId));
		await tx.delete(notification).where(isNull(notification.projectId));

		// 7. Completion marker — written LAST so a partial run re-runs on next boot.
		await tx
			.update(organization)
			.set({ metadata: JSON.stringify({ migrated: true }) })
			.where(eq(organization.id, DEFAULT_ORG_ID));
	});

	migrated = true;
}

export async function listWorkspaces() {
	return db.select().from(workspace).orderBy(asc(workspace.name), asc(workspace.createdAt));
}

export async function getWorkspace(id: string) {
	const [w] = await db.select().from(workspace).where(eq(workspace.id, id));
	return w ?? null;
}
