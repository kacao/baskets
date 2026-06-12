import { sqliteTable, text, integer, primaryKey, unique } from 'drizzle-orm/sqlite-core';

/* ------------------------------------------------------------------ */
/* better-auth tables (email/password + twoFactor + admin plugins)     */
/* ------------------------------------------------------------------ */

export const user = sqliteTable('user', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	email: text('email').notNull().unique(),
	emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
	image: text('image'),
	createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
	updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
	// admin plugin
	role: text('role'),
	banned: integer('banned', { mode: 'boolean' }),
	banReason: text('ban_reason'),
	banExpires: integer('ban_expires', { mode: 'timestamp' }),
	// twoFactor plugin
	twoFactorEnabled: integer('two_factor_enabled', { mode: 'boolean' })
});

export const session = sqliteTable('session', {
	id: text('id').primaryKey(),
	expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
	token: text('token').notNull().unique(),
	createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
	updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
	ipAddress: text('ip_address'),
	userAgent: text('user_agent'),
	userId: text('user_id')
		.notNull()
		.references(() => user.id, { onDelete: 'cascade' }),
	// admin plugin
	impersonatedBy: text('impersonated_by')
});

export const account = sqliteTable('account', {
	id: text('id').primaryKey(),
	accountId: text('account_id').notNull(),
	providerId: text('provider_id').notNull(),
	userId: text('user_id')
		.notNull()
		.references(() => user.id, { onDelete: 'cascade' }),
	accessToken: text('access_token'),
	refreshToken: text('refresh_token'),
	idToken: text('id_token'),
	accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp' }),
	refreshTokenExpiresAt: integer('refresh_token_expires_at', { mode: 'timestamp' }),
	scope: text('scope'),
	password: text('password'),
	createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
	updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull()
});

export const verification = sqliteTable('verification', {
	id: text('id').primaryKey(),
	identifier: text('identifier').notNull(),
	value: text('value').notNull(),
	expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
	createdAt: integer('created_at', { mode: 'timestamp' }),
	updatedAt: integer('updated_at', { mode: 'timestamp' })
});

export const twoFactor = sqliteTable('two_factor', {
	id: text('id').primaryKey(),
	secret: text('secret').notNull(),
	backupCodes: text('backup_codes').notNull(),
	verified: integer('verified', { mode: 'boolean' }).notNull().default(false),
	userId: text('user_id')
		.notNull()
		.references(() => user.id, { onDelete: 'cascade' })
});

/* ------------------------------------------------------------------ */
/* App tables                                                          */
/* ------------------------------------------------------------------ */

export const project = sqliteTable('project', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	description: text('description'),
	createdBy: text('created_by')
		.notNull()
		.references(() => user.id),
	createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
	updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull()
});

export const apiKey = sqliteTable('api_key', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	prefix: text('prefix').notNull(), // displayable start of the key, e.g. bsk_a1b2c3
	keyHash: text('key_hash').notNull().unique(), // sha-256 of the full key; plaintext never stored
	userId: text('user_id')
		.notNull()
		.references(() => user.id, { onDelete: 'cascade' }),
	lastUsedAt: integer('last_used_at', { mode: 'timestamp' }),
	createdAt: integer('created_at', { mode: 'timestamp' }).notNull()
});

export const integration = sqliteTable('integration', {
	id: text('id').primaryKey(),
	type: text('type').notNull().unique(), // 'slack' (single tenant: one row per type)
	enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
	config: text('config').notNull(), // JSON, shape depends on type
	createdBy: text('created_by')
		.notNull()
		.references(() => user.id),
	createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
	updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull()
});

export const status = sqliteTable('status', {
	id: text('id').primaryKey(),
	name: text('name').notNull().unique(),
	category: text('category').notNull().default('todo'), // todo | active | done | canceled
	position: integer('position').notNull().default(0),
	builtIn: integer('built_in', { mode: 'boolean' }).notNull().default(false),
	createdAt: integer('created_at', { mode: 'timestamp' }).notNull()
});

// Which app-wide statuses a project allows on its tasks
export const projectStatus = sqliteTable(
	'project_status',
	{
		projectId: text('project_id')
			.notNull()
			.references(() => project.id, { onDelete: 'cascade' }),
		statusId: text('status_id')
			.notNull()
			.references(() => status.id, { onDelete: 'cascade' })
	},
	(t) => [primaryKey({ columns: [t.projectId, t.statusId] })]
);

export const view = sqliteTable('view', {
	id: text('id').primaryKey(),
	projectId: text('project_id')
		.notNull()
		.references(() => project.id, { onDelete: 'cascade' }),
	name: text('name').notNull(),
	type: text('type').notNull().default('table'), // dashboard | table | board | map
	config: text('config').notNull().default('{}'), // JSON, shape depends on type
	position: integer('position').notNull().default(0),
	isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
	createdBy: text('created_by')
		.notNull()
		.references(() => user.id),
	createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
	updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull()
});

// Edit grants. Read is implicit for all signed-in users (single tenant).
export const permission = sqliteTable(
	'permission',
	{
		id: text('id').primaryKey(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		resourceType: text('resource_type').notNull(), // project | view | task
		resourceId: text('resource_id').notNull(),
		grantedBy: text('granted_by')
			.notNull()
			.references(() => user.id),
		createdAt: integer('created_at', { mode: 'timestamp' }).notNull()
	},
	(t) => [unique().on(t.userId, t.resourceType, t.resourceId)]
);

export const milestone = sqliteTable('milestone', {
	id: text('id').primaryKey(),
	projectId: text('project_id')
		.notNull()
		.references(() => project.id, { onDelete: 'cascade' }),
	name: text('name').notNull(),
	description: text('description'),
	targetDate: integer('target_date', { mode: 'timestamp' }),
	position: integer('position').notNull().default(0),
	createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
	updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull()
});

export const labelGroup = sqliteTable('label_group', {
	id: text('id').primaryKey(),
	name: text('name').notNull().unique(),
	position: integer('position').notNull().default(0),
	createdAt: integer('created_at', { mode: 'timestamp' }).notNull()
});

export const label = sqliteTable('label', {
	id: text('id').primaryKey(),
	name: text('name').notNull().unique(),
	groupId: text('group_id').references(() => labelGroup.id, { onDelete: 'set null' }),
	position: integer('position').notNull().default(0),
	createdAt: integer('created_at', { mode: 'timestamp' }).notNull()
});

export const projectLabel = sqliteTable(
	'project_label',
	{
		projectId: text('project_id')
			.notNull()
			.references(() => project.id, { onDelete: 'cascade' }),
		labelId: text('label_id')
			.notNull()
			.references(() => label.id, { onDelete: 'cascade' })
	},
	(t) => [primaryKey({ columns: [t.projectId, t.labelId] })]
);

export const taskLabel = sqliteTable(
	'task_label',
	{
		taskId: text('task_id')
			.notNull()
			.references(() => task.id, { onDelete: 'cascade' }),
		labelId: text('label_id')
			.notNull()
			.references(() => label.id, { onDelete: 'cascade' })
	},
	(t) => [primaryKey({ columns: [t.taskId, t.labelId] })]
);

export const projectDependency = sqliteTable(
	'project_dependency',
	{
		projectId: text('project_id')
			.notNull()
			.references(() => project.id, { onDelete: 'cascade' }),
		dependsOnId: text('depends_on_id')
			.notNull()
			.references(() => project.id, { onDelete: 'cascade' })
	},
	(t) => [primaryKey({ columns: [t.projectId, t.dependsOnId] })]
);

export const taskDependency = sqliteTable(
	'task_dependency',
	{
		taskId: text('task_id')
			.notNull()
			.references(() => task.id, { onDelete: 'cascade' }),
		dependsOnId: text('depends_on_id')
			.notNull()
			.references(() => task.id, { onDelete: 'cascade' })
	},
	(t) => [primaryKey({ columns: [t.taskId, t.dependsOnId] })]
);

export const task = sqliteTable('task', {
	id: text('id').primaryKey(),
	projectId: text('project_id')
		.notNull()
		.references(() => project.id, { onDelete: 'cascade' }),
	parentId: text('parent_id'), // self-reference: null = top-level task
	title: text('title').notNull(),
	description: text('description'),
	statusId: text('status_id')
		.notNull()
		.references(() => status.id),
	priority: text('priority').notNull().default('none'), // none | low | medium | high | urgent
	assigneeId: text('assignee_id').references(() => user.id),
	milestoneId: text('milestone_id').references(() => milestone.id, { onDelete: 'set null' }),
	location: text('location'), // "lat, lng" — plotted by map views
	order: integer('task_order'), // user-assigned rank for list views; null = unranked
	position: integer('position').notNull().default(0),
	dueDate: integer('due_date', { mode: 'timestamp' }),
	createdBy: text('created_by')
		.notNull()
		.references(() => user.id),
	createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
	updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull()
});
