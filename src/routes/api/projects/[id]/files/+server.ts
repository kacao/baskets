import { json } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import { desc, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { file } from '$lib/server/db/schema';
import { apiError } from '$lib/server/api';
import { canAccessProject, canEditProject } from '$lib/server/permissions';
import { broadcastProjectChange } from '$lib/server/realtime/hub';
import { UPLOADS_DIR, filePath, BLOCKED_EXT, mimeForExt } from '$lib/server/uploads';
import type { RequestHandler } from './$types';

const MAX_SIZE = 10 * 1024 * 1024; // 10 MB

// List every file belonging to a project (across tasks, custom fields, and the
// project itself). Access-gated (404 when inaccessible, ADR-019). storagePath
// is NEVER returned.
export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');
	if (!(await canAccessProject(locals.user, params.id))) return apiError(404, 'Not found');

	const files = await db
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

	return json({ files });
};

// Upload a project-level file (not tied to a task or custom field). Multipart:
// file. The project is taken from the route — editing is required.
export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');
	if (!(await canAccessProject(locals.user, params.id))) return apiError(404, 'Not found');
	if (!(await canEditProject(locals.user, params.id))) return apiError(403, 'Forbidden');

	const form = await request.formData();
	const blob = form.get('file');
	if (!(blob instanceof File) || blob.size === 0) return apiError(400, 'No file provided');
	if (blob.size > MAX_SIZE) return apiError(413, 'File too large (max 10 MB)');
	const ext = extname(blob.name).toLowerCase();
	if (BLOCKED_EXT.has(ext.replace('.', ''))) return apiError(415, 'File type not allowed');

	const id = randomUUID();
	const safeExt = /^\.[a-z0-9]{1,8}$/.test(ext) ? ext : '';
	const rel = `${params.id}/${id}${safeExt}`;
	const filename = (blob.name || 'file').slice(0, 255);
	// server-derived from extension — never the client-claimed blob.type
	const mimeType = mimeForExt(ext);
	await mkdir(join(UPLOADS_DIR, params.id), { recursive: true });
	await mkdir(dirname(filePath(rel)), { recursive: true });
	await writeFile(filePath(rel), Buffer.from(await blob.arrayBuffer()));

	await db.insert(file).values({
		id,
		projectId: params.id,
		taskId: null,
		fieldId: null,
		filename,
		mimeType,
		size: blob.size,
		storagePath: rel,
		createdBy: locals.user.id,
		createdAt: new Date()
	});
	broadcastProjectChange(params.id, locals.user.id);
	return json({ file: { id, filename, mimeType, size: blob.size } }, { status: 201 });
};
