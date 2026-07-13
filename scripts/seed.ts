/**
 * Seed script — creates an admin user, a demo user, and sample projects/tasks.
 * Run: npm run db:push && node --env-file=.env scripts/seed.ts
 * Idempotent-ish: skips if the admin user already exists.
 */
import { eq } from 'drizzle-orm';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { twoFactor, admin, organization } from 'better-auth/plugins';
import * as schema from '../src/lib/server/db/schema.ts';
import { DIALECT } from '../src/lib/server/db/dialect.ts';

// Passwords are read from the environment for real deployments; the fallbacks are
// dev-only defaults (never use them in production — override via SEED_*_PASSWORD).
const ADMIN_EMAIL = 'admin@baskets.local';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'admin-baskets-2026';
const DEMO_EMAIL = 'demo@baskets.local';
const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'demo-baskets-2026';
// owner2 owns a SECOND org (org-two) for cross-org isolation tests (ADR-062).
const OWNER2_EMAIL = 'owner2@baskets.local';
const OWNER2_PASSWORD = process.env.SEED_OWNER2_PASSWORD ?? 'owner2-baskets-2026';

// Dialect-aware client (ADR-050) — mirrors src/lib/server/db/index.ts. Drivers
// are dynamically imported so only the selected one loads.
let db;
if (DIALECT === 'postgres') {
	if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required for DB_DIALECT=postgres');
	const { default: postgres } = await import('postgres');
	const { drizzle } = await import('drizzle-orm/postgres-js');
	db = drizzle(postgres(process.env.DATABASE_URL, { max: 4 }), { schema });
} else {
	const { default: Database } = await import('better-sqlite3');
	const { drizzle } = await import('drizzle-orm/better-sqlite3');
	const sqlite = new Database(process.env.DATABASE_URL ?? './data/baskets.db');
	try {
		sqlite.pragma('journal_mode = WAL');
	} catch {
		// some filesystems (network mounts) don't support WAL — fall back to default
	}
	sqlite.pragma('foreign_keys = ON');
	db = drizzle(sqlite, { schema });
}

const auth = betterAuth({
	appName: 'Baskets',
	secret: process.env.BETTER_AUTH_SECRET ?? 'seed-secret',
	baseURL: process.env.BETTER_AUTH_URL ?? 'http://localhost:5173',
	database: drizzleAdapter(db, {
		provider: DIALECT === 'postgres' ? 'pg' : 'sqlite',
		schema: {
			user: schema.user,
			session: schema.session,
			account: schema.account,
			verification: schema.verification,
			twoFactor: schema.twoFactor,
			organization: schema.organization,
			member: schema.member,
			invitation: schema.invitation
		}
	}),
	emailAndPassword: { enabled: true, minPasswordLength: 12 },
	plugins: [twoFactor({ issuer: 'Baskets' }), admin(), organization()]
});

const existing = await db.select().from(schema.user).where(eq(schema.user.email, ADMIN_EMAIL));
if (existing.length > 0) {
	console.log('Seed skipped — admin user already exists.');
	process.exit(0);
}

console.log('Creating users…');
const adminRes = await auth.api.signUpEmail({
	body: { name: 'Admin', email: ADMIN_EMAIL, password: ADMIN_PASSWORD }
});
const demoRes = await auth.api.signUpEmail({
	body: { name: 'Demo Dana', email: DEMO_EMAIL, password: DEMO_PASSWORD }
});
const owner2Res = await auth.api.signUpEmail({
	body: { name: 'Olivia Owner', email: OWNER2_EMAIL, password: OWNER2_PASSWORD }
});

const adminId = adminRes.user.id;
const demoId = demoRes.user.id;
const owner2Id = owner2Res.user.id;

await db
	.update(schema.user)
	.set({ role: 'admin', emailVerified: true })
	.where(eq(schema.user.id, adminId));
await db.update(schema.user).set({ emailVerified: true }).where(eq(schema.user.id, demoId));
await db.update(schema.user).set({ emailVerified: true }).where(eq(schema.user.id, owner2Id));

console.log('Creating default statuses…');
const now = new Date();
const statuses = [
	{
		id: 'status-backlog',
		name: 'Backlog',
		category: 'backlog',
		color: '#71717a',
		icon: 'iconoir:circle'
	},
	{
		id: 'status-planned',
		name: 'Planned',
		category: 'planned',
		color: '#3b82f6',
		icon: 'iconoir:clock'
	},
	{
		id: 'status-in-progress',
		name: 'In progress',
		category: 'in-progress',
		color: '#f59e0b',
		icon: 'iconoir:half-moon'
	},
	{
		id: 'status-completed',
		name: 'Completed',
		category: 'completed',
		color: '#16a34a',
		icon: 'iconoir:check-circle'
	},
	{
		id: 'status-canceled',
		name: 'Canceled',
		category: 'canceled',
		color: '#a1a1aa',
		icon: 'iconoir:xmark-circle'
	}
];
await db
	.insert(schema.status)
	.values(statuses.map((s, i) => ({ ...s, position: i * 10, builtIn: true, createdAt: now })))
	.onConflictDoNothing();

console.log('Creating organizations + memberships…');
const ORG_ID = 'org-default';
const ORG_TWO_ID = 'org-two';
await db
	.insert(schema.organization)
	.values([
		{
			id: ORG_ID,
			name: 'Default',
			slug: 'default',
			// migration marker: a booted seed DB skips ensureDefaultOrganization
			metadata: JSON.stringify({ migrated: true }),
			createdAt: now
		},
		{ id: ORG_TWO_ID, name: 'Org Two', slug: 'org-two', createdAt: now }
	])
	.onConflictDoNothing();

// admin owns org-default; demo is a plain member (keeps its existing project grant);
// owner2 owns org-two (isolated). Deterministic member ids (mirror the migration).
await db
	.insert(schema.member)
	.values([
		{
			id: `member-org-default-${adminId}`,
			organizationId: ORG_ID,
			userId: adminId,
			role: 'owner',
			createdAt: now
		},
		{
			id: `member-org-default-${demoId}`,
			organizationId: ORG_ID,
			userId: demoId,
			role: 'member',
			createdAt: now
		},
		{
			id: `member-org-two-${owner2Id}`,
			organizationId: ORG_TWO_ID,
			userId: owner2Id,
			role: 'owner',
			createdAt: now
		}
	])
	.onConflictDoNothing();

console.log('Creating default workspace…');
const WORKSPACE_ID = 'workspace-default';
await db
	.insert(schema.workspace)
	.values({
		id: WORKSPACE_ID,
		name: 'Default',
		ownerId: adminId,
		organizationId: ORG_ID,
		createdAt: now,
		updatedAt: now
	})
	.onConflictDoNothing();

console.log('Creating sample projects…');
const pid = (n: number) => `seed-project-${n}`;
const tid = (n: number) => `seed-task-${n}`;

await db.insert(schema.project).values([
	{
		id: pid(1),
		name: 'Website Relaunch',
		description: 'Rebuild the marketing site with the new brutalist brand.',
		workspaceId: WORKSPACE_ID,
		createdBy: adminId,
		createdAt: now,
		updatedAt: now
	},
	{
		id: pid(2),
		name: 'Q3 Operations',
		description: 'Recurring ops work for the third quarter.',
		workspaceId: WORKSPACE_ID,
		createdBy: adminId,
		createdAt: now,
		updatedAt: now
	}
]);

console.log('Creating views, statuses, milestones, labels…');
await db
	.insert(schema.projectStatus)
	.values(
		[pid(1), pid(2)].flatMap((projectId) => statuses.map((s) => ({ projectId, statusId: s.id })))
	);

await db.insert(schema.view).values(
	[pid(1), pid(2)].map((projectId, i) => ({
		id: `seed-view-${i + 1}`,
		projectId,
		name: 'Table',
		type: 'table',
		config: '{}',
		position: 0,
		isDefault: true,
		createdBy: adminId,
		createdAt: now,
		updatedAt: now
	}))
);

await db.insert(schema.milestone).values({
	id: 'seed-milestone-1',
	projectId: pid(1),
	name: 'Launch',
	targetDate: new Date(now.getTime() + 30 * 86400_000),
	position: 0,
	createdAt: now,
	updatedAt: now
});

await db.insert(schema.labelGroup).values({
	id: 'seed-label-group-1',
	name: 'Area',
	workspaceId: WORKSPACE_ID,
	position: 0,
	createdAt: now
});
await db.insert(schema.label).values([
	{
		id: 'seed-label-1',
		name: 'design',
		workspaceId: WORKSPACE_ID,
		groupId: 'seed-label-group-1',
		position: 0,
		createdAt: now
	},
	{
		id: 'seed-label-2',
		name: 'engineering',
		workspaceId: WORKSPACE_ID,
		groupId: 'seed-label-group-1',
		position: 1,
		createdAt: now
	},
	{
		id: 'seed-label-3',
		name: 'urgent-review',
		workspaceId: WORKSPACE_ID,
		groupId: null,
		position: 2,
		createdAt: now
	}
]);

// Demo user can edit project 1 (admins implicitly edit everything)
await db.insert(schema.permission).values({
	id: 'seed-perm-1',
	userId: demoId,
	resourceType: 'project',
	resourceId: pid(1),
	grantedBy: adminId,
	createdAt: now
});

let pos = 0;
const t = (
	n: number,
	projectId: string,
	title: string,
	opts: Partial<typeof schema.task.$inferInsert> = {}
) => ({
	id: tid(n),
	projectId,
	title,
	statusId: 'status-backlog',
	priority: 'none',
	position: pos++,
	createdBy: adminId,
	createdAt: now,
	updatedAt: now,
	...opts
});

await db.insert(schema.task).values([
	t(1, pid(1), 'Draft information architecture', {
		statusId: 'status-completed',
		priority: 'high',
		milestoneId: 'seed-milestone-1'
	}),
	t(2, pid(1), 'Design homepage in minimalist style', {
		statusId: 'status-in-progress',
		priority: 'urgent',
		assigneeId: demoId,
		milestoneId: 'seed-milestone-1',
		location: '52.3676, 4.9041',
		description: 'Whitespace-first, Inter weight contrast, hairline borders.'
	}),
	t(3, pid(1), 'Implement CMS integration', { priority: 'medium', statusId: 'status-planned' }),
	t(4, pid(1), 'Hero copy', { parentId: tid(2), statusId: 'status-completed' }),
	t(5, pid(1), 'Mobile breakpoints', { parentId: tid(2), priority: 'high' }),
	t(6, pid(1), 'Accessibility pass', { parentId: tid(2) }),
	t(7, pid(2), 'Renew SSL certificates', {
		priority: 'urgent',
		assigneeId: adminId,
		statusId: 'status-planned',
		location: '40.7128, -74.0060'
	}),
	t(8, pid(2), 'Vendor invoice review', { statusId: 'status-in-progress' }),
	t(9, pid(2), 'Archive stale documents', { priority: 'low' })
]);

await db.insert(schema.taskLabel).values([
	{ taskId: tid(2), labelId: 'seed-label-1' },
	{ taskId: tid(3), labelId: 'seed-label-2' }
]);
await db.insert(schema.projectLabel).values([{ projectId: pid(1), labelId: 'seed-label-1' }]);

// Sample custom fields on project 1: a Select (Severity) + a currency Number (Estimate).
await db.insert(schema.customField).values([
	{
		id: 'seed-cf-1',
		projectId: pid(1),
		name: 'Severity',
		type: 'select',
		config: JSON.stringify({ multi: false, displayOption: 'text-icon' }),
		position: 0,
		createdAt: now
	},
	{
		id: 'seed-cf-2',
		projectId: pid(1),
		name: 'Estimate',
		type: 'number',
		config: JSON.stringify({ numberFormat: 'currency', currencyCode: 'USD' }),
		position: 10,
		createdAt: now
	}
]);
await db.insert(schema.customFieldOption).values([
	{
		id: 'seed-cfo-1',
		fieldId: 'seed-cf-1',
		title: 'Low',
		color: '#16a34a',
		icon: 'iconoir:circle',
		position: 0,
		createdAt: now
	},
	{
		id: 'seed-cfo-2',
		fieldId: 'seed-cf-1',
		title: 'Medium',
		color: '#f59e0b',
		icon: 'iconoir:half-moon',
		position: 10,
		createdAt: now
	},
	{
		id: 'seed-cfo-3',
		fieldId: 'seed-cf-1',
		title: 'High',
		color: '#dc2626',
		icon: 'iconoir:fire-flame',
		position: 20,
		createdAt: now
	}
]);
await db.insert(schema.taskCustomValue).values([
	{ taskId: tid(1), fieldId: 'seed-cf-1', value: JSON.stringify(['seed-cfo-3']) },
	{ taskId: tid(1), fieldId: 'seed-cf-2', value: '1500' }
]);

console.log(`
Seed complete.
  Admin:  ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}   (org-default owner)
  Demo:   ${DEMO_EMAIL} / ${DEMO_PASSWORD}   (org-default member)
  Owner2: ${OWNER2_EMAIL} / ${OWNER2_PASSWORD}   (org-two owner)
`);
process.exit(0);
