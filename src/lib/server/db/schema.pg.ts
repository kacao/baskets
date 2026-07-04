import {
	pgTable,
	text,
	integer,
	boolean,
	timestamp,
	doublePrecision,
	primaryKey,
	unique
} from 'drizzle-orm/pg-core';

// Postgres mirror of schema.sqlite.ts (ADR-050). Table + column NAMES must stay
// byte-identical to the sqlite schema — the facade (schema.ts) casts one onto the
// other, and every importer/query references columns by name. Only the column
// TYPES differ: sqlite integer(mode:'boolean'|'timestamp') → native boolean/
// timestamp; real → doublePrecision. Keep the two files in lockstep.

/* ------------------------------------------------------------------ */
/* better-auth tables (email/password + twoFactor + admin plugins)     */
/* ------------------------------------------------------------------ */

export const user = pgTable('user', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	email: text('email').notNull().unique(),
	emailVerified: boolean('email_verified').notNull().default(false),
	image: text('image'),
	createdAt: timestamp('created_at', { mode: 'date' }).notNull(),
	updatedAt: timestamp('updated_at', { mode: 'date' }).notNull(),
	// admin plugin
	role: text('role'),
	banned: boolean('banned'),
	banReason: text('ban_reason'),
	banExpires: timestamp('ban_expires', { mode: 'date' }),
	// twoFactor plugin
	twoFactorEnabled: boolean('two_factor_enabled')
});

export const session = pgTable('session', {
	id: text('id').primaryKey(),
	expiresAt: timestamp('expires_at', { mode: 'date' }).notNull(),
	token: text('token').notNull().unique(),
	createdAt: timestamp('created_at', { mode: 'date' }).notNull(),
	updatedAt: timestamp('updated_at', { mode: 'date' }).notNull(),
	ipAddress: text('ip_address'),
	userAgent: text('user_agent'),
	userId: text('user_id')
		.notNull()
		.references(() => user.id, { onDelete: 'cascade' }),
	// admin plugin
	impersonatedBy: text('impersonated_by')
});

export const account = pgTable('account', {
	id: text('id').primaryKey(),
	accountId: text('account_id').notNull(),
	providerId: text('provider_id').notNull(),
	userId: text('user_id')
		.notNull()
		.references(() => user.id, { onDelete: 'cascade' }),
	accessToken: text('access_token'),
	refreshToken: text('refresh_token'),
	idToken: text('id_token'),
	accessTokenExpiresAt: timestamp('access_token_expires_at', { mode: 'date' }),
	refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { mode: 'date' }),
	scope: text('scope'),
	password: text('password'),
	createdAt: timestamp('created_at', { mode: 'date' }).notNull(),
	updatedAt: timestamp('updated_at', { mode: 'date' }).notNull()
});

export const verification = pgTable('verification', {
	id: text('id').primaryKey(),
	identifier: text('identifier').notNull(),
	value: text('value').notNull(),
	expiresAt: timestamp('expires_at', { mode: 'date' }).notNull(),
	createdAt: timestamp('created_at', { mode: 'date' }),
	updatedAt: timestamp('updated_at', { mode: 'date' })
});

export const twoFactor = pgTable('two_factor', {
	id: text('id').primaryKey(),
	secret: text('secret').notNull(),
	backupCodes: text('backup_codes').notNull(),
	verified: boolean('verified').notNull().default(false),
	userId: text('user_id')
		.notNull()
		.references(() => user.id, { onDelete: 'cascade' })
});

/* ------------------------------------------------------------------ */
/* App tables                                                          */
/* ------------------------------------------------------------------ */

export const workspace = pgTable('workspace', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	ownerId: text('owner_id')
		.notNull()
		.references(() => user.id),
	createdAt: timestamp('created_at', { mode: 'date' }).notNull(),
	updatedAt: timestamp('updated_at', { mode: 'date' }).notNull()
});

export const project = pgTable('project', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	description: text('description'),
	workspaceId: text('workspace_id').references(() => workspace.id),
	statusId: text('status_id'),
	icon: text('icon'),
	statusDisplay: text('status_display').notNull().default('text'),
	chipFields: text('chip_fields'),
	pinned: boolean('pinned').notNull().default(false),
	startDate: timestamp('start_date', { mode: 'date' }),
	dueDate: timestamp('due_date', { mode: 'date' }),
	createdBy: text('created_by')
		.notNull()
		.references(() => user.id),
	createdAt: timestamp('created_at', { mode: 'date' }).notNull(),
	updatedAt: timestamp('updated_at', { mode: 'date' }).notNull()
});

export const apiKey = pgTable('api_key', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	prefix: text('prefix').notNull(),
	keyHash: text('key_hash').notNull().unique(),
	userId: text('user_id')
		.notNull()
		.references(() => user.id, { onDelete: 'cascade' }),
	lastUsedAt: timestamp('last_used_at', { mode: 'date' }),
	createdAt: timestamp('created_at', { mode: 'date' }).notNull()
});

export const integration = pgTable('integration', {
	id: text('id').primaryKey(),
	type: text('type').notNull().unique(),
	enabled: boolean('enabled').notNull().default(true),
	config: text('config').notNull(),
	createdBy: text('created_by')
		.notNull()
		.references(() => user.id),
	createdAt: timestamp('created_at', { mode: 'date' }).notNull(),
	updatedAt: timestamp('updated_at', { mode: 'date' }).notNull()
});

export const status = pgTable('status', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	description: text('description'),
	category: text('category').notNull().default('backlog'),
	color: text('color'),
	icon: text('icon'),
	projectId: text('project_id').references(() => project.id, { onDelete: 'cascade' }),
	workspaceId: text('workspace_id').references(() => workspace.id, { onDelete: 'cascade' }),
	position: integer('position').notNull().default(0),
	builtIn: boolean('built_in').notNull().default(false),
	createdAt: timestamp('created_at', { mode: 'date' }).notNull()
});

export const projectStatus = pgTable(
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

export const view = pgTable('view', {
	id: text('id').primaryKey(),
	projectId: text('project_id')
		.notNull()
		.references(() => project.id, { onDelete: 'cascade' }),
	name: text('name').notNull(),
	type: text('type').notNull().default('table'),
	config: text('config').notNull().default('{}'),
	position: integer('position').notNull().default(0),
	isDefault: boolean('is_default').notNull().default(false),
	hidden: boolean('hidden').notNull().default(false),
	createdBy: text('created_by')
		.notNull()
		.references(() => user.id),
	createdAt: timestamp('created_at', { mode: 'date' }).notNull(),
	updatedAt: timestamp('updated_at', { mode: 'date' }).notNull()
});

export const permission = pgTable(
	'permission',
	{
		id: text('id').primaryKey(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		resourceType: text('resource_type').notNull(),
		resourceId: text('resource_id').notNull(),
		grantedBy: text('granted_by')
			.notNull()
			.references(() => user.id),
		createdAt: timestamp('created_at', { mode: 'date' }).notNull()
	},
	(t) => [unique().on(t.userId, t.resourceType, t.resourceId)]
);

export const milestone = pgTable('milestone', {
	id: text('id').primaryKey(),
	projectId: text('project_id')
		.notNull()
		.references(() => project.id, { onDelete: 'cascade' }),
	name: text('name').notNull(),
	description: text('description'),
	startDate: timestamp('start_date', { mode: 'date' }),
	targetDate: timestamp('target_date', { mode: 'date' }),
	position: integer('position').notNull().default(0),
	createdAt: timestamp('created_at', { mode: 'date' }).notNull(),
	updatedAt: timestamp('updated_at', { mode: 'date' }).notNull()
});

export const milestoneDependency = pgTable(
	'milestone_dependency',
	{
		milestoneId: text('milestone_id')
			.notNull()
			.references(() => milestone.id, { onDelete: 'cascade' }),
		dependsOnId: text('depends_on_id')
			.notNull()
			.references(() => milestone.id, { onDelete: 'cascade' })
	},
	(t) => [primaryKey({ columns: [t.milestoneId, t.dependsOnId] })]
);

export const location = pgTable('location', {
	id: text('id').primaryKey(),
	projectId: text('project_id')
		.notNull()
		.references(() => project.id, { onDelete: 'cascade' }),
	title: text('title').notNull(),
	address: text('address'),
	latitude: doublePrecision('latitude'),
	longitude: doublePrecision('longitude'),
	position: integer('position').notNull().default(0),
	createdAt: timestamp('created_at', { mode: 'date' }).notNull(),
	updatedAt: timestamp('updated_at', { mode: 'date' }).notNull()
});

export const labelGroup = pgTable('label_group', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	workspaceId: text('workspace_id').references(() => workspace.id, { onDelete: 'cascade' }),
	position: integer('position').notNull().default(0),
	createdAt: timestamp('created_at', { mode: 'date' }).notNull()
});

export const label = pgTable('label', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	workspaceId: text('workspace_id').references(() => workspace.id, { onDelete: 'cascade' }),
	projectId: text('project_id').references(() => project.id, { onDelete: 'cascade' }),
	groupId: text('group_id').references(() => labelGroup.id, { onDelete: 'set null' }),
	color: text('color'),
	icon: text('icon'),
	position: integer('position').notNull().default(0),
	createdAt: timestamp('created_at', { mode: 'date' }).notNull()
});

export const projectLabel = pgTable(
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

export const taskLabel = pgTable(
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

export const projectDependency = pgTable(
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

export const taskDependency = pgTable(
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

export const task = pgTable('task', {
	id: text('id').primaryKey(),
	projectId: text('project_id')
		.notNull()
		.references(() => project.id, { onDelete: 'cascade' }),
	parentId: text('parent_id'),
	title: text('title').notNull(),
	description: text('description'),
	statusId: text('status_id')
		.notNull()
		.references(() => status.id),
	priority: text('priority').notNull().default('none'),
	assigneeId: text('assignee_id').references(() => user.id),
	milestoneId: text('milestone_id').references(() => milestone.id, { onDelete: 'set null' }),
	locationId: text('location_id').references(() => location.id, { onDelete: 'set null' }),
	location: text('location'),
	order: integer('task_order'),
	position: integer('position').notNull().default(0),
	startDate: timestamp('start_date', { mode: 'date' }),
	dueDate: timestamp('due_date', { mode: 'date' }),
	recurrence: text('recurrence'),
	coverFileId: text('cover_file_id'),
	createdBy: text('created_by')
		.notNull()
		.references(() => user.id),
	createdAt: timestamp('created_at', { mode: 'date' }).notNull(),
	updatedAt: timestamp('updated_at', { mode: 'date' }).notNull()
});

export const customField = pgTable('custom_field', {
	id: text('id').primaryKey(),
	projectId: text('project_id')
		.notNull()
		.references(() => project.id, { onDelete: 'cascade' }),
	entity: text('entity').notNull().default('task'),
	name: text('name').notNull(),
	type: text('type').notNull(),
	config: text('config').notNull().default('{}'),
	appliesTo: text('applies_to').notNull().default('all'),
	position: integer('position').notNull().default(0),
	createdAt: timestamp('created_at', { mode: 'date' }).notNull()
});

export const customFieldOption = pgTable('custom_field_option', {
	id: text('id').primaryKey(),
	fieldId: text('field_id')
		.notNull()
		.references(() => customField.id, { onDelete: 'cascade' }),
	title: text('title').notNull(),
	color: text('color'),
	icon: text('icon'),
	position: integer('position').notNull().default(0),
	createdAt: timestamp('created_at', { mode: 'date' }).notNull()
});

export const taskCustomValue = pgTable(
	'task_custom_value',
	{
		taskId: text('task_id')
			.notNull()
			.references(() => task.id, { onDelete: 'cascade' }),
		fieldId: text('field_id')
			.notNull()
			.references(() => customField.id, { onDelete: 'cascade' }),
		value: text('value').notNull()
	},
	(t) => [primaryKey({ columns: [t.taskId, t.fieldId] })]
);

export const projectCustomValue = pgTable(
	'project_custom_value',
	{
		projectId: text('project_id')
			.notNull()
			.references(() => project.id, { onDelete: 'cascade' }),
		fieldId: text('field_id')
			.notNull()
			.references(() => customField.id, { onDelete: 'cascade' }),
		value: text('value').notNull()
	},
	(t) => [primaryKey({ columns: [t.projectId, t.fieldId] })]
);

export const file = pgTable('file', {
	id: text('id').primaryKey(),
	projectId: text('project_id')
		.notNull()
		.references(() => project.id, { onDelete: 'cascade' }),
	fieldId: text('field_id').references(() => customField.id, { onDelete: 'set null' }),
	taskId: text('task_id').references(() => task.id, { onDelete: 'cascade' }),
	filename: text('filename').notNull(),
	mimeType: text('mime_type').notNull(),
	size: integer('size').notNull(),
	storagePath: text('storage_path').notNull(),
	createdBy: text('created_by')
		.notNull()
		.references(() => user.id),
	createdAt: timestamp('created_at', { mode: 'date' }).notNull()
});

export const comment = pgTable('comment', {
	id: text('id').primaryKey(),
	taskId: text('task_id')
		.notNull()
		.references(() => task.id, { onDelete: 'cascade' }),
	authorId: text('author_id')
		.notNull()
		.references(() => user.id),
	body: text('body').notNull(),
	createdAt: timestamp('created_at', { mode: 'date' }).notNull(),
	updatedAt: timestamp('updated_at', { mode: 'date' }).notNull()
});

export const activity = pgTable('activity', {
	id: text('id').primaryKey(),
	projectId: text('project_id')
		.notNull()
		.references(() => project.id, { onDelete: 'cascade' }),
	taskId: text('task_id').references(() => task.id, { onDelete: 'cascade' }),
	actorId: text('actor_id')
		.notNull()
		.references(() => user.id),
	type: text('type').notNull(),
	data: text('data').notNull().default('{}'),
	createdAt: timestamp('created_at', { mode: 'date' }).notNull()
});

export const notification = pgTable('notification', {
	id: text('id').primaryKey(),
	userId: text('user_id')
		.notNull()
		.references(() => user.id, { onDelete: 'cascade' }),
	type: text('type').notNull(),
	projectId: text('project_id').references(() => project.id, { onDelete: 'cascade' }),
	taskId: text('task_id').references(() => task.id, { onDelete: 'cascade' }),
	body: text('body').notNull(),
	read: boolean('read').notNull().default(false),
	createdAt: timestamp('created_at', { mode: 'date' }).notNull()
});

export const template = pgTable('template', {
	id: text('id').primaryKey(),
	scope: text('scope').notNull().default('project'),
	workspaceId: text('workspace_id').references(() => workspace.id, { onDelete: 'cascade' }),
	projectId: text('project_id').references(() => project.id, { onDelete: 'cascade' }),
	name: text('name').notNull(),
	payload: text('payload').notNull().default('{}'),
	createdBy: text('created_by')
		.notNull()
		.references(() => user.id),
	createdAt: timestamp('created_at', { mode: 'date' }).notNull()
});
