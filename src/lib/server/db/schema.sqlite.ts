import {
	sqliteTable,
	text,
	integer,
	real,
	primaryKey,
	unique,
	index
} from 'drizzle-orm/sqlite-core';

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

// Workspaces own projects, custom statuses and labels. Owned by one user;
// other users get edit rights via permission grants (resourceType 'workspace').
export const workspace = sqliteTable('workspace', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	ownerId: text('owner_id')
		.notNull()
		.references(() => user.id),
	createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
	updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull()
});

export const project = sqliteTable('project', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	description: text('description'),
	// nullable for db:push on pre-workspace rows; backfilled by ensureDefaultWorkspace,
	// required in code (every create path sets it)
	workspaceId: text('workspace_id').references(() => workspace.id),
	// optional project-level status (defaults + the workspace's statuses)
	statusId: text('status_id'),
	icon: text('icon'), // emoji or `iconoir:<name>` shown beside the project name
	// how statuses render across this project's views: text | icon | text-icon
	statusDisplay: text('status_display').notNull().default('text'),
	// ordered JSON array of project-entity custom-field ids to show as header chips;
	// null = unset (show all project fields with a value); '[]' = show none
	chipFields: text('chip_fields'),
	pinned: integer('pinned', { mode: 'boolean' }).notNull().default(false),
	startDate: integer('start_date', { mode: 'timestamp' }),
	dueDate: integer('due_date', { mode: 'timestamp' }),
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
	// uniqueness enforced in code, scoped: defaults / per-workspace / per-(project ∪ inherited)
	name: text('name').notNull(),
	description: text('description'), // optional one-line note, shown in the status editor
	category: text('category').notNull().default('backlog'), // backlog | planned | in-progress | completed | canceled
	color: text('color'), // hex, e.g. #16a34a; null = neutral
	icon: text('icon'), // emoji or `iconoir:<name>`; null = none
	// both null = app-wide default (the five built-ins, immutable)
	projectId: text('project_id').references(() => project.id, { onDelete: 'cascade' }),
	workspaceId: text('workspace_id').references(() => workspace.id, { onDelete: 'cascade' }),
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
	// hidden views keep their config; the "+" menu re-enables them
	hidden: integer('hidden', { mode: 'boolean' }).notNull().default(false),
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
		resourceType: text('resource_type').notNull(), // workspace | project | view | task
		resourceId: text('resource_id').notNull(),
		grantedBy: text('granted_by')
			.notNull()
			.references(() => user.id),
		createdAt: integer('created_at', { mode: 'timestamp' }).notNull()
	},
	(t) => [unique().on(t.userId, t.resourceType, t.resourceId)]
);

export const milestone = sqliteTable(
	'milestone',
	{
		id: text('id').primaryKey(),
		projectId: text('project_id')
			.notNull()
			.references(() => project.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		description: text('description'),
		startDate: integer('start_date', { mode: 'timestamp' }),
		targetDate: integer('target_date', { mode: 'timestamp' }),
		position: integer('position').notNull().default(0),
		createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
		updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull()
	},
	(t) => [index('idx_milestone_project').on(t.projectId)]
);

// Labels and groups are workspace-scoped (no app-wide labels).
// Name uniqueness enforced in code per workspace; workspaceId nullable only
// for db:push on pre-workspace rows (backfilled by ensureDefaultWorkspace).
// Milestones may depend on other milestones of the SAME project (informational,
// DFS cycle-checked in code — same shape as task/project dependencies).
export const milestoneDependency = sqliteTable(
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

// Saved places (project-scoped), pickable on tasks (task.locationId) and plotted
// by map views. Title + optional address + coordinates.
export const location = sqliteTable(
	'location',
	{
		id: text('id').primaryKey(),
		projectId: text('project_id')
			.notNull()
			.references(() => project.id, { onDelete: 'cascade' }),
		title: text('title').notNull(),
		address: text('address'),
		latitude: real('latitude'),
		longitude: real('longitude'),
		position: integer('position').notNull().default(0),
		createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
		updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull()
	},
	(t) => [index('idx_location_project').on(t.projectId)]
);

export const labelGroup = sqliteTable('label_group', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	workspaceId: text('workspace_id').references(() => workspace.id, { onDelete: 'cascade' }),
	position: integer('position').notNull().default(0),
	createdAt: integer('created_at', { mode: 'timestamp' }).notNull()
});

// A label is workspace-scoped (workspaceId set, shared pool, attached to projects
// via project_label) OR project-scoped (projectId set — owned by one project,
// always available to it). Exactly one of workspaceId/projectId is set.
export const label = sqliteTable('label', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	workspaceId: text('workspace_id').references(() => workspace.id, { onDelete: 'cascade' }),
	projectId: text('project_id').references(() => project.id, { onDelete: 'cascade' }),
	groupId: text('group_id').references(() => labelGroup.id, { onDelete: 'set null' }),
	color: text('color'), // hex #rrggbb or null (tinted chip), like status/custom_field_option
	icon: text('icon'), // emoji or `iconoir:<name>` or null
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

export const task = sqliteTable(
	'task',
	{
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
		locationId: text('location_id').references(() => location.id, { onDelete: 'set null' }),
		location: text('location'), // legacy freeform "lat, lng" (map fallback when no locationId)
		order: integer('task_order'), // user-assigned rank for list views; null = unranked
		position: integer('position').notNull().default(0),
		startDate: integer('start_date', { mode: 'timestamp' }), // timeline/calendar bar start (BASDEV-5/11)
		dueDate: integer('due_date', { mode: 'timestamp' }),
		recurrence: text('recurrence'), // simple repeat rule e.g. "weekly:1" (BASDEV-8); null = one-off
		coverFileId: text('cover_file_id'), // optional cover image (BASDEV-12)
		createdBy: text('created_by')
			.notNull()
			.references(() => user.id),
		createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
		updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull()
	},
	(t) => [index('idx_task_project').on(t.projectId), index('idx_task_parent').on(t.parentId)]
);

// Project-scoped custom fields on tasks. `type` is a free string from
// CUSTOM_FIELD_TYPES ($lib/customFields); `config` is schemaless JSON whose
// shape depends on type (number format, select multi/display, date format,
// person/place/files limit, …) — like view.config. Name unique per project (in
// code). Deferred types (formula/button) slot in via type + config, no schema
// change. position drives display order.
export const customField = sqliteTable('custom_field', {
	id: text('id').primaryKey(),
	projectId: text('project_id')
		.notNull()
		.references(() => project.id, { onDelete: 'cascade' }),
	// which entity the field describes: 'task' (default, values in task_custom_value)
	// or 'project' (the project itself, values in project_custom_value)
	entity: text('entity').notNull().default('task'),
	name: text('name').notNull(),
	type: text('type').notNull(),
	config: text('config').notNull().default('{}'),
	// which tasks this field applies to: all | tasks (top-level only) | subtasks
	// (only meaningful for entity='task')
	appliesTo: text('applies_to').notNull().default('all'),
	position: integer('position').notNull().default(0),
	createdAt: integer('created_at', { mode: 'timestamp' }).notNull()
});

// Enum members for a select-type custom field (title + optional color/icon),
// mirroring label/status. position drives order within the field.
export const customFieldOption = sqliteTable('custom_field_option', {
	id: text('id').primaryKey(),
	fieldId: text('field_id')
		.notNull()
		.references(() => customField.id, { onDelete: 'cascade' }),
	title: text('title').notNull(),
	color: text('color'), // hex #rrggbb or null
	icon: text('icon'), // emoji or `iconoir:<name>` or null
	position: integer('position').notNull().default(0),
	createdAt: integer('created_at', { mode: 'timestamp' }).notNull()
});

// One value per (task, field). `value` is a scalar string or a JSON array
// (multi-capable types: select/person/place/files). Absent row = no value.
export const taskCustomValue = sqliteTable(
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

// One value per (project, field) for entity='project' custom fields — mirrors
// task_custom_value. `value` is a scalar string or a JSON array. Absent = no value.
export const projectCustomValue = sqliteTable(
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

// Uploaded files (Files & media custom fields). Bytes live on local disk under
// UPLOADS_DIR (default ./data/uploads); storagePath is relative and NEVER sent
// to the client — files are served only via the access-gated /api/files/[id].
export const file = sqliteTable(
	'file',
	{
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
		createdAt: integer('created_at', { mode: 'timestamp' }).notNull()
	},
	(t) => [index('idx_file_project').on(t.projectId)]
);

// Threaded comments on a task (BASDEV-3).
export const comment = sqliteTable(
	'comment',
	{
		id: text('id').primaryKey(),
		taskId: text('task_id')
			.notNull()
			.references(() => task.id, { onDelete: 'cascade' }),
		authorId: text('author_id')
			.notNull()
			.references(() => user.id),
		body: text('body').notNull(),
		createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
		updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull()
	},
	(t) => [index('idx_comment_task').on(t.taskId)]
);

// Append-only audit trail of task/project changes (BASDEV-3).
export const activity = sqliteTable(
	'activity',
	{
		id: text('id').primaryKey(),
		projectId: text('project_id')
			.notNull()
			.references(() => project.id, { onDelete: 'cascade' }),
		taskId: text('task_id').references(() => task.id, { onDelete: 'cascade' }),
		actorId: text('actor_id')
			.notNull()
			.references(() => user.id),
		type: text('type').notNull(), // created | status | assignee | milestone | due | comment | ...
		data: text('data').notNull().default('{}'), // schemaless JSON detail (from/to, etc.)
		createdAt: integer('created_at', { mode: 'timestamp' }).notNull()
	},
	(t) => [index('idx_activity_task').on(t.taskId)]
);

// Per-user in-app notifications (BASDEV-4).
export const notification = sqliteTable(
	'notification',
	{
		id: text('id').primaryKey(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		type: text('type').notNull(), // assigned | mention | due_soon | overdue | ...
		projectId: text('project_id').references(() => project.id, { onDelete: 'cascade' }),
		taskId: text('task_id').references(() => task.id, { onDelete: 'cascade' }),
		body: text('body').notNull(),
		read: integer('read', { mode: 'boolean' }).notNull().default(false),
		createdAt: integer('created_at', { mode: 'timestamp' }).notNull()
	},
	(t) => [index('idx_notification_user').on(t.userId)]
);

// Reusable task templates, workspace- or project-scoped (BASDEV-8).
export const template = sqliteTable('template', {
	id: text('id').primaryKey(),
	scope: text('scope').notNull().default('project'), // workspace | project
	workspaceId: text('workspace_id').references(() => workspace.id, { onDelete: 'cascade' }),
	projectId: text('project_id').references(() => project.id, { onDelete: 'cascade' }),
	name: text('name').notNull(),
	payload: text('payload').notNull().default('{}'), // JSON: task(s) + subtasks + field values
	createdBy: text('created_by')
		.notNull()
		.references(() => user.id),
	createdAt: integer('created_at', { mode: 'timestamp' }).notNull()
});
