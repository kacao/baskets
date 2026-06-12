/**
 * Seed script — creates an admin user, a demo user, and sample projects/tasks.
 * Run: npm run db:push && node --env-file=.env scripts/seed.ts
 * Idempotent-ish: skips if the admin user already exists.
 */
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { twoFactor, admin } from 'better-auth/plugins';
import * as schema from '../src/lib/server/db/schema.ts';

const ADMIN_EMAIL = 'admin@baskets.local';
const ADMIN_PASSWORD = 'admin-baskets-2026';
const DEMO_EMAIL = 'demo@baskets.local';
const DEMO_PASSWORD = 'demo-baskets-2026';

const sqlite = new Database(process.env.DATABASE_URL ?? './baskets.db');
try {
	sqlite.pragma('journal_mode = WAL');
} catch {
	// some filesystems (network mounts) don't support WAL — fall back to default
}
sqlite.pragma('foreign_keys = ON');
const db = drizzle(sqlite, { schema });

const auth = betterAuth({
	appName: 'Baskets',
	secret: process.env.BETTER_AUTH_SECRET ?? 'seed-secret',
	baseURL: process.env.BETTER_AUTH_URL ?? 'http://localhost:5173',
	database: drizzleAdapter(db, {
		provider: 'sqlite',
		schema: {
			user: schema.user,
			session: schema.session,
			account: schema.account,
			verification: schema.verification,
			twoFactor: schema.twoFactor
		}
	}),
	emailAndPassword: { enabled: true, minPasswordLength: 8 },
	plugins: [twoFactor({ issuer: 'Baskets' }), admin()]
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

const adminId = adminRes.user.id;
const demoId = demoRes.user.id;

await db
	.update(schema.user)
	.set({ role: 'admin', emailVerified: true })
	.where(eq(schema.user.id, adminId));
await db.update(schema.user).set({ emailVerified: true }).where(eq(schema.user.id, demoId));

console.log('Creating default statuses…');
const now = new Date();
const statuses = [
	{ id: 'status-backlog', name: 'Backlog', category: 'todo' },
	{ id: 'status-planned', name: 'Planned', category: 'todo' },
	{ id: 'status-in-progress', name: 'In progress', category: 'active' },
	{ id: 'status-completed', name: 'Completed', category: 'done' },
	{ id: 'status-canceled', name: 'Canceled', category: 'canceled' }
];
await db
	.insert(schema.status)
	.values(statuses.map((s, i) => ({ ...s, position: i * 10, builtIn: true, createdAt: now })))
	.onConflictDoNothing();

console.log('Creating sample projects…');
const pid = (n: number) => `seed-project-${n}`;
const tid = (n: number) => `seed-task-${n}`;

await db.insert(schema.project).values([
	{
		id: pid(1),
		name: 'Website Relaunch',
		description: 'Rebuild the marketing site with the new brutalist brand.',
		createdBy: adminId,
		createdAt: now,
		updatedAt: now
	},
	{
		id: pid(2),
		name: 'Q3 Operations',
		description: 'Recurring ops work for the third quarter.',
		createdBy: adminId,
		createdAt: now,
		updatedAt: now
	}
]);

console.log('Creating views, statuses, milestones, labels…');
await db.insert(schema.projectStatus).values(
	[pid(1), pid(2)].flatMap((projectId) =>
		statuses.map((s) => ({ projectId, statusId: s.id }))
	)
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
	position: 0,
	createdAt: now
});
await db.insert(schema.label).values([
	{ id: 'seed-label-1', name: 'design', groupId: 'seed-label-group-1', position: 0, createdAt: now },
	{ id: 'seed-label-2', name: 'engineering', groupId: 'seed-label-group-1', position: 1, createdAt: now },
	{ id: 'seed-label-3', name: 'urgent-review', groupId: null, position: 2, createdAt: now }
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
	t(2, pid(1), 'Design homepage in StudioBlank style', {
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

console.log(`
Seed complete.
  Admin: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}
  Demo:  ${DEMO_EMAIL} / ${DEMO_PASSWORD}
`);
process.exit(0);
