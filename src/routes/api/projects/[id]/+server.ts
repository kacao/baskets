import { json } from '@sveltejs/kit';
import { asc, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import {
	customField,
	customFieldOption,
	location,
	milestone,
	project,
	task,
	view
} from '$lib/server/db/schema';
import { apiError, readJson, optionalString, ApiValidationError } from '$lib/server/api';
import { broadcastProjectChange } from '$lib/server/realtime/hub';
import { notifyMentions } from '$lib/server/mentions';
import { canAccessProject, canEditProject } from '$lib/server/permissions';
import { deleteFilesForProject } from '$lib/server/uploads';
import { listProjectStatuses, listStatuses, listWorkspaceStatuses } from '$lib/server/statuses';
import { ICON_NAMES } from '$lib/heroiconNames';
import { PROJECT_NAV_KEYS } from '$lib/projectNav';
import {
	customValuesByTask,
	listCustomFieldOptions,
	listProjectCustomFields
} from '$lib/server/customFields';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const [proj] = await db.select().from(project).where(eq(project.id, params.id));
	if (!proj) return apiError(404, 'Project not found');
	// ADR-019: inaccessible projects are indistinguishable from missing ones
	if (!(await canAccessProject(locals.user, params.id))) return apiError(404, 'Project not found');

	const [tasks, views, milestones, locations, statuses] = await Promise.all([
		db
			.select()
			.from(task)
			.where(eq(task.projectId, params.id))
			.orderBy(asc(task.position), asc(task.createdAt)),
		db
			.select()
			.from(view)
			.where(eq(view.projectId, params.id))
			.orderBy(asc(view.position), asc(view.createdAt)),
		db
			.select()
			.from(milestone)
			.where(eq(milestone.projectId, params.id))
			.orderBy(asc(milestone.position), asc(milestone.createdAt)),
		db
			.select()
			.from(location)
			.where(eq(location.projectId, params.id))
			.orderBy(asc(location.position), asc(location.title)),
		listProjectStatuses(params.id)
	]);

	const customFields = await listProjectCustomFields(params.id);
	const [customFieldOptions, valuesByTask] = await Promise.all([
		listCustomFieldOptions(customFields.map((f) => f.id)),
		customValuesByTask(
			params.id,
			tasks.map((t) => t.id)
		)
	]);
	// attach each task's decoded custom-field value map
	const tasksWithCf = tasks.map((t) => ({ ...t, customFields: valuesByTask[t.id] ?? {} }));

	return json({
		project: proj,
		tasks: tasksWithCf,
		views,
		milestones,
		locations,
		statuses,
		customFields,
		customFieldOptions
	});
};

export const PATCH: RequestHandler = async ({ request, params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const [proj] = await db.select().from(project).where(eq(project.id, params.id));
	if (!proj) return apiError(404, 'Project not found');
	// ADR-019: don't confirm existence to users who can't edit — 404, not 403
	if (!(await canAccessProject(locals.user, params.id))) return apiError(404, 'Project not found');
	if (!(await canEditProject(locals.user, params.id)))
		return apiError(403, 'No edit permission on this project');

	const body = await readJson(request);
	if (!body) return apiError(400, 'Invalid JSON body');

	const updates: Partial<typeof project.$inferInsert> = {};

	if (body.name !== undefined) {
		const name = typeof body.name === 'string' ? body.name.trim() : '';
		if (!name) return apiError(400, 'name cannot be empty');
		if (name.length > 120) return apiError(400, 'name too long (max 120)');
		updates.name = name;
	}

	if (body.description !== undefined) {
		try {
			updates.description = optionalString(body.description, 'description');
		} catch (err) {
			if (err instanceof ApiValidationError) return apiError(400, err.message);
			throw err;
		}
	}

	if (body.pinned !== undefined) {
		if (typeof body.pinned !== 'boolean') return apiError(400, 'pinned must be a boolean');
		updates.pinned = body.pinned;
	}

	if (body.icon !== undefined) {
		// emoji / legacy glyph (≤8 chars) or `iconoir:<name>` (validated); null/'' clears it
		if (body.icon === null) {
			updates.icon = null;
		} else if (typeof body.icon !== 'string') {
			return apiError(400, 'icon must be a string or null');
		} else {
			const raw = body.icon.trim();
			if (raw.startsWith('iconoir:')) {
				if (!ICON_NAMES.includes(raw.slice(8))) return apiError(400, 'Unknown icon');
				updates.icon = raw;
			} else {
				updates.icon = raw.slice(0, 8) || null;
			}
		}
	}

	if (body.statusId !== undefined) {
		// validate against defaults + this project's workspace statuses (no FK), like setProjectStatus
		if (body.statusId === null || body.statusId === '') {
			updates.statusId = null;
		} else if (typeof body.statusId !== 'string') {
			return apiError(400, 'statusId must be a string or null');
		} else {
			const options = [
				...(await listStatuses()),
				...(proj.workspaceId ? await listWorkspaceStatuses(proj.workspaceId) : [])
			];
			if (!options.some((s) => s.id === body.statusId))
				return apiError(400, 'Status not available to this project');
			updates.statusId = body.statusId;
		}
	}

	if (body.statusDisplay !== undefined) {
		if (
			typeof body.statusDisplay !== 'string' ||
			!['text', 'icon', 'text-icon'].includes(body.statusDisplay)
		)
			return apiError(400, 'Invalid status display');
		updates.statusDisplay = body.statusDisplay;
	}

	// Ordered list of project-entity custom-field ids shown as header chips. null clears
	// (back to "show all with a value"); foreign/unknown ids are dropped.
	if (body.chipFields !== undefined) {
		if (body.chipFields === null) {
			updates.chipFields = null;
		} else if (
			!Array.isArray(body.chipFields) ||
			body.chipFields.some((x) => typeof x !== 'string')
		) {
			return apiError(400, 'chipFields must be an array of field ids or null');
		} else {
			const projFieldIds = new Set(
				(await listProjectCustomFields(params.id))
					.filter((f) => (f.entity ?? 'task') === 'project')
					.map((f) => f.id)
			);
			const clean = [...new Set(body.chipFields as string[])].filter((id) => projFieldIds.has(id));
			updates.chipFields = JSON.stringify(clean);
		}
	}

	// Sidebar sub-items shown for this project (ADR-064). null clears back to the
	// default (Tasks + Milestones); unknown keys are dropped, canonical order kept.
	if (body.sidebarItems !== undefined) {
		if (body.sidebarItems === null) {
			updates.sidebarItems = null;
		} else if (
			!Array.isArray(body.sidebarItems) ||
			body.sidebarItems.some((x) => typeof x !== 'string')
		) {
			return apiError(400, 'sidebarItems must be an array of item keys or null');
		} else {
			const shown = new Set(body.sidebarItems as string[]);
			updates.sidebarItems = JSON.stringify(PROJECT_NAV_KEYS.filter((k) => shown.has(k)));
		}
	}

	if (body.startDate !== undefined) {
		if (body.startDate === null || body.startDate === '') {
			updates.startDate = null;
		} else if (typeof body.startDate !== 'string') {
			return apiError(400, 'startDate must be a date string or null');
		} else {
			const d = new Date(body.startDate.trim() + 'T00:00:00');
			if (Number.isNaN(d.getTime())) return apiError(400, 'Invalid startDate');
			updates.startDate = d;
		}
	}

	if (body.dueDate !== undefined) {
		if (body.dueDate === null || body.dueDate === '') {
			updates.dueDate = null;
		} else if (typeof body.dueDate !== 'string') {
			return apiError(400, 'dueDate must be a date string or null');
		} else {
			const d = new Date(body.dueDate.trim() + 'T00:00:00');
			if (Number.isNaN(d.getTime())) return apiError(400, 'Invalid dueDate');
			updates.dueDate = d;
		}
	}

	if (Object.keys(updates).length === 0) return apiError(400, 'No fields to update');

	const [updated] = await db
		.update(project)
		.set({ ...updates, updatedAt: new Date() })
		.where(eq(project.id, params.id))
		.returning();

	// mention notifications on a description change (mirrors the updateProject form action)
	if (updates.description !== undefined) {
		void notifyMentions({
			text: updates.description,
			prevText: proj.description,
			actorId: locals.user.id,
			actorName: locals.user.name,
			projectId: params.id,
			contextLabel: `the project "${updated.name}"`
		});
	}
	broadcastProjectChange(params.id, locals.user.id);
	return json({ project: updated });
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const [proj] = await db.select().from(project).where(eq(project.id, params.id));
	if (!proj) return apiError(404, 'Project not found');
	// ADR-019: don't confirm existence to users who can't edit — 404, not 403
	if (!(await canAccessProject(locals.user, params.id))) return apiError(404, 'Project not found');
	if (!(await canEditProject(locals.user, params.id)))
		return apiError(403, 'No edit permission on this project');

	await deleteFilesForProject(params.id);
	await db.delete(project).where(eq(project.id, params.id));
	broadcastProjectChange(params.id, locals.user.id);
	return new Response(null, { status: 204 });
};
