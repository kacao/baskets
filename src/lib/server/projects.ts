import { and, eq } from 'drizzle-orm';
import { db } from './db';
import {
	member,
	milestone,
	milestoneDependency,
	permission,
	project,
	projectStatus,
	task,
	view,
	workspace
} from './db/schema';
import { listStatuses, listWorkspaceStatuses } from './statuses';

export const VIEW_TYPES = [
	'dashboard',
	'table',
	'board',
	'list',
	'timeline',
	'calendar',
	'map',
	'flow'
] as const;
export type ViewType = (typeof VIEW_TYPES)[number];

/**
 * Creates a project with its invariants:
 * - belongs to a workspace
 * - at least one view (default "Table")
 * - the five defaults + its workspace's statuses eligible
 * - a creator who is NOT an org owner/admin gets an edit grant on their own
 *   project (org owners/admins already see everything in-org — ADR-062)
 */
export async function createProjectWithDefaults(opts: {
	name: string;
	description: string | null;
	workspaceId: string;
	creator: { id: string; role?: string | null };
}) {
	const id = crypto.randomUUID();
	const now = new Date();

	const [ws] = await db
		.select({ orgId: workspace.organizationId })
		.from(workspace)
		.where(eq(workspace.id, opts.workspaceId));
	const orgId = ws?.orgId ?? null;

	await db.insert(project).values({
		id,
		name: opts.name,
		description: opts.description,
		workspaceId: opts.workspaceId,
		createdBy: opts.creator.id,
		createdAt: now,
		updatedAt: now
	});

	await db.insert(view).values({
		id: crypto.randomUUID(),
		projectId: id,
		name: 'Table',
		type: 'table',
		config: '{}',
		position: 0,
		isDefault: true,
		createdBy: opts.creator.id,
		createdAt: now,
		updatedAt: now
	});

	const statuses = [...(await listStatuses()), ...(await listWorkspaceStatuses(opts.workspaceId))];
	if (statuses.length > 0) {
		await db.insert(projectStatus).values(statuses.map((s) => ({ projectId: id, statusId: s.id })));
	}

	// org owners/admins already see every project in the org, so they hold no grant
	// (mirrors the single-tenant admin-skip). Grant org == resource org (ADR-062).
	const [m] = orgId
		? await db
				.select({ role: member.role })
				.from(member)
				.where(and(eq(member.userId, opts.creator.id), eq(member.organizationId, orgId)))
		: [];
	const creatorIsOrgAdmin = m?.role === 'owner' || m?.role === 'admin';
	if (!creatorIsOrgAdmin) {
		await db.insert(permission).values({
			id: crypto.randomUUID(),
			userId: opts.creator.id,
			resourceType: 'project',
			resourceId: id,
			organizationId: orgId,
			grantedBy: opts.creator.id,
			createdAt: now
		});
	}

	return id;
}

/** Sample projects/milestones/tasks dropped into a user's FIRST workspace. */
const SAMPLE_PROJECTS: {
	name: string;
	icon: string;
	description: string;
	milestones: { name: string; days: number; dependsOn?: number }[];
	tasks: { title: string; milestone?: number; priority?: string }[];
}[] = [
	{
		name: 'Website Redesign',
		icon: '🎨',
		description: 'Refresh the marketing site and design system.',
		milestones: [
			{ name: 'Design complete', days: 14 },
			{ name: 'Launch', days: 30, dependsOn: 0 }
		],
		tasks: [
			{ title: 'Audit current pages', milestone: 0, priority: 'medium' },
			{ title: 'Draft new visual language', milestone: 0, priority: 'high' },
			{ title: 'Build component library', milestone: 1 },
			{ title: 'Ship to production', milestone: 1, priority: 'urgent' }
		]
	},
	{
		name: 'Mobile App',
		icon: '🚀',
		description: 'Native companion app — MVP then beta.',
		milestones: [
			{ name: 'MVP', days: 21 },
			{ name: 'Public beta', days: 45, dependsOn: 0 }
		],
		tasks: [
			{ title: 'Set up project scaffold', milestone: 0, priority: 'high' },
			{ title: 'Implement auth flow', milestone: 0 },
			{ title: 'Offline sync', milestone: 1, priority: 'medium' },
			{ title: 'TestFlight rollout', milestone: 1 }
		]
	},
	{
		name: 'Q3 Roadmap',
		icon: '📈',
		description: 'Planning and tracking for the quarter.',
		milestones: [{ name: 'Planning done', days: 7 }],
		tasks: [
			{ title: 'Collect team proposals', milestone: 0, priority: 'medium' },
			{ title: 'Prioritise initiatives', milestone: 0, priority: 'high' },
			{ title: 'Publish the roadmap' }
		]
	}
];

/** Seeds a brand-new workspace with example projects so it isn't empty. */
export async function seedWorkspaceSamples(
	workspaceId: string,
	creator: { id: string; role?: string | null }
) {
	const defaults = await listStatuses();
	const todo = defaults.find((s) => s.category === 'backlog') ?? defaults[0];
	if (!todo) return; // no statuses bootstrapped yet — skip

	for (const sample of SAMPLE_PROJECTS) {
		const projectId = await createProjectWithDefaults({
			name: sample.name,
			description: sample.description,
			workspaceId,
			creator
		});
		await db.update(project).set({ icon: sample.icon }).where(eq(project.id, projectId));

		const now = new Date();
		const milestoneIds = sample.milestones.map(() => crypto.randomUUID());
		await db.insert(milestone).values(
			sample.milestones.map((m, i) => ({
				id: milestoneIds[i],
				projectId,
				name: m.name,
				targetDate: new Date(now.getTime() + m.days * 86_400_000),
				position: i,
				createdAt: now,
				updatedAt: now
			}))
		);
		const msDeps = sample.milestones.flatMap((m, i) =>
			m.dependsOn !== undefined
				? [{ milestoneId: milestoneIds[i], dependsOnId: milestoneIds[m.dependsOn] }]
				: []
		);
		if (msDeps.length > 0) await db.insert(milestoneDependency).values(msDeps);

		await db.insert(task).values(
			sample.tasks.map((t, i) => ({
				id: crypto.randomUUID(),
				projectId,
				parentId: null,
				title: t.title,
				priority: t.priority ?? 'none',
				statusId: todo.id,
				milestoneId: t.milestone !== undefined ? milestoneIds[t.milestone] : null,
				createdBy: creator.id,
				position: now.getTime() + i,
				createdAt: now,
				updatedAt: now
			}))
		);
	}
}

/** True if the user owns no workspace yet (i.e. the next one is their first). */
export async function isFirstWorkspaceForUser(userId: string) {
	const owned = await db
		.select({ id: workspace.id })
		.from(workspace)
		.where(eq(workspace.ownerId, userId))
		.limit(1);
	return owned.length === 0;
}
