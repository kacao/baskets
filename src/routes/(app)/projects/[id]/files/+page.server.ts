import { error } from '@sveltejs/kit';
import { desc, eq, inArray } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { customField, file, project, task, user } from '$lib/server/db/schema';
import { canAccessProject, canEditProject, workspaceOrgId } from '$lib/server/permissions';
import { alignActiveOrg } from '$lib/server/orgs';
import type { PageServerLoad } from './$types';

type FileSource =
	| { kind: 'project' }
	| { kind: 'task'; taskId: string; taskTitle: string }
	| { kind: 'field'; fieldName: string; taskId: string | null; taskTitle: string | null };

export const load: PageServerLoad = async ({ params, locals, cookies }) => {
	if (!locals.user) error(401, 'Unauthorized');

	const [proj] = await db
		.select({ id: project.id, name: project.name, workspaceId: project.workspaceId })
		.from(project)
		.where(eq(project.id, params.id));
	if (!proj) error(404, 'Project not found');
	// ADR-019: inaccessible projects are indistinguishable from missing ones
	if (!(await canAccessProject(locals.user, params.id))) error(404, 'Project not found');

	// ADR-062 D4: keep the active org aligned to the project being viewed
	const projOrgId = proj.workspaceId ? await workspaceOrgId(proj.workspaceId) : null;
	alignActiveOrg(cookies, projOrgId);

	const rows = await db
		.select({
			id: file.id,
			taskId: file.taskId,
			fieldId: file.fieldId,
			filename: file.filename,
			mimeType: file.mimeType,
			size: file.size,
			createdAt: file.createdAt,
			createdBy: file.createdBy
		})
		.from(file)
		.where(eq(file.projectId, params.id))
		.orderBy(desc(file.createdAt));

	// Resolve attribution: referenced tasks, custom fields, and uploaders.
	const taskIds = [...new Set(rows.map((r) => r.taskId).filter((x): x is string => !!x))];
	const fieldIds = [...new Set(rows.map((r) => r.fieldId).filter((x): x is string => !!x))];
	const userIds = [...new Set(rows.map((r) => r.createdBy).filter((x): x is string => !!x))];

	const [taskRows, fieldRows, userRows] = await Promise.all([
		taskIds.length > 0
			? db.select({ id: task.id, title: task.title }).from(task).where(inArray(task.id, taskIds))
			: Promise.resolve([]),
		fieldIds.length > 0
			? db
					.select({ id: customField.id, name: customField.name })
					.from(customField)
					.where(inArray(customField.id, fieldIds))
			: Promise.resolve([]),
		userIds.length > 0
			? db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, userIds))
			: Promise.resolve([])
	]);

	const taskTitle = new Map(taskRows.map((t) => [t.id, t.title]));
	const fieldName = new Map(fieldRows.map((f) => [f.id, f.name]));
	const userName = new Map(userRows.map((u) => [u.id, u.name]));

	const files = rows.map((r) => {
		let source: FileSource;
		if (r.fieldId) {
			source = {
				kind: 'field',
				fieldName: fieldName.get(r.fieldId) ?? 'Custom field',
				taskId: r.taskId,
				taskTitle: r.taskId ? (taskTitle.get(r.taskId) ?? null) : null
			};
		} else if (r.taskId) {
			source = { kind: 'task', taskId: r.taskId, taskTitle: taskTitle.get(r.taskId) ?? 'Task' };
		} else {
			source = { kind: 'project' };
		}
		return {
			id: r.id,
			taskId: r.taskId,
			fieldId: r.fieldId,
			filename: r.filename,
			mimeType: r.mimeType,
			size: r.size,
			createdAt: r.createdAt,
			uploaderName: r.createdBy ? (userName.get(r.createdBy) ?? null) : null,
			source
		};
	});

	return {
		project: proj,
		files,
		perm: { canEdit: await canEditProject(locals.user, params.id) }
	};
};
