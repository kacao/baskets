import { json } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { file, task } from '$lib/server/db/schema';
import { apiError } from '$lib/server/api';
import { canAccessProject, canEditProject } from '$lib/server/permissions';
import { broadcastProjectChange } from '$lib/server/realtime/hub';
import { UPLOADS_DIR, filePath, BLOCKED_EXT, mimeForExt } from '$lib/server/uploads';
import type { RequestHandler } from './$types';

const MAX_SIZE = 10 * 1024 * 1024; // 10 MB

// List a task's directly-attached files (taskId set, no fieldId — these are the
// photo/document capture attachments, distinct from files-type custom field values).
export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const [t] = await db
		.select({ projectId: task.projectId })
		.from(task)
		.where(eq(task.id, params.id));
	if (!t) return apiError(404, 'Not found');
	if (!(await canAccessProject(locals.user, t.projectId))) return apiError(404, 'Not found');

	const rows = await db
		.select({
			id: file.id,
			taskId: file.taskId,
			fieldId: file.fieldId,
			filename: file.filename,
			mimeType: file.mimeType,
			size: file.size
		})
		.from(file)
		.where(eq(file.taskId, params.id));
	// only the directly-attached ones (custom-field files carry a fieldId)
	return json({ files: rows.filter((r) => !r.fieldId) });
};

// Attach a file DIRECTLY to a task (no custom field). Multipart: file. The
// project is derived from the task — never client-supplied (no cross-project trust).
export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const [t] = await db
		.select({ projectId: task.projectId })
		.from(task)
		.where(eq(task.id, params.id));
	if (!t) return apiError(404, 'Not found');
	if (!(await canEditProject(locals.user, t.projectId))) return apiError(404, 'Not found');

	const form = await request.formData();
	const blob = form.get('file');
	if (!(blob instanceof File)) return apiError(400, 'No file provided');
	if (blob.size === 0) return apiError(400, 'Empty file');
	if (blob.size > MAX_SIZE) return apiError(413, 'File too large (max 10 MB)');

	const ext = extname(blob.name).toLowerCase();
	if (BLOCKED_EXT.has(ext.replace('.', ''))) return apiError(415, 'File type not allowed');

	const id = randomUUID();
	const safeExt = /^\.[a-z0-9]{1,8}$/.test(ext) ? ext : '';
	const rel = `${t.projectId}/${id}${safeExt}`;
	const filename = (blob.name || 'file').slice(0, 255);
	// server-derived from extension — never the client-claimed blob.type
	const mimeType = mimeForExt(ext);
	await mkdir(join(UPLOADS_DIR, t.projectId), { recursive: true });
	await writeFile(filePath(rel), Buffer.from(await blob.arrayBuffer()));

	await db.insert(file).values({
		id,
		projectId: t.projectId,
		fieldId: null,
		taskId: params.id,
		filename,
		mimeType,
		size: blob.size,
		storagePath: rel,
		createdBy: locals.user.id,
		createdAt: new Date()
	});
	broadcastProjectChange(t.projectId, locals.user.id);
	return json({ file: { id, taskId: params.id, fieldId: null, filename, mimeType, size: blob.size } }, { status: 201 });
};
