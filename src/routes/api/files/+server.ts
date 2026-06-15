import { json } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { customField, file, task } from '$lib/server/db/schema';
import { apiError } from '$lib/server/api';
import { canAccessProject } from '$lib/server/permissions';
import { broadcastProjectChange } from '$lib/server/realtime/hub';
import { UPLOADS_DIR, filePath, BLOCKED_EXT, mimeForExt } from '$lib/server/uploads';
import type { RequestHandler } from './$types';

const MAX_SIZE = 10 * 1024 * 1024; // 10 MB

// Upload a file for a `files`-type custom field. Multipart: fieldId, optional
// taskId, file. The project is derived from the field (no cross-project trust).
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');

	const form = await request.formData();
	const fieldId = String(form.get('fieldId') ?? '');
	const taskId = String(form.get('taskId') ?? '') || null;
	const blob = form.get('file');
	if (!(blob instanceof File)) return apiError(400, 'No file provided');

	const [f] = await db.select().from(customField).where(eq(customField.id, fieldId));
	if (!f || f.type !== 'files') return apiError(400, 'Not a files field');
	if (!(await canAccessProject(locals.user, f.projectId))) return apiError(404, 'Not found');

	// an attached task must belong to the SAME project as the field (no cross-project link)
	if (taskId) {
		const [t] = await db.select({ projectId: task.projectId }).from(task).where(eq(task.id, taskId));
		if (!t || t.projectId !== f.projectId) return apiError(400, 'Invalid task');
	}

	if (blob.size === 0) return apiError(400, 'Empty file');
	if (blob.size > MAX_SIZE) return apiError(413, 'File too large (max 10 MB)');
	const ext = extname(blob.name).toLowerCase();
	if (BLOCKED_EXT.has(ext.replace('.', ''))) return apiError(415, 'File type not allowed');

	const id = randomUUID();
	const safeExt = /^\.[a-z0-9]{1,8}$/.test(ext) ? ext : '';
	const rel = `${f.projectId}/${id}${safeExt}`;
	const filename = (blob.name || 'file').slice(0, 255);
	// server-derived from extension — never the client-claimed blob.type
	const mimeType = mimeForExt(ext);
	await mkdir(join(UPLOADS_DIR, f.projectId), { recursive: true });
	await writeFile(filePath(rel), Buffer.from(await blob.arrayBuffer()));

	await db.insert(file).values({
		id,
		projectId: f.projectId,
		fieldId,
		taskId,
		filename,
		mimeType,
		size: blob.size,
		storagePath: rel,
		createdBy: locals.user.id,
		createdAt: new Date()
	});
	broadcastProjectChange(f.projectId, locals.user.id);
	return json({ file: { id, filename, mimeType, size: blob.size } }, { status: 201 });
};
