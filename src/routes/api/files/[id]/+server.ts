import { json } from '@sveltejs/kit';
import { readFile, unlink } from 'node:fs/promises';
import { and, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { file, taskCustomValue } from '$lib/server/db/schema';
import { apiError } from '$lib/server/api';
import { canAccessProject } from '$lib/server/permissions';
import { broadcastProjectChange } from '$lib/server/realtime/hub';
import { filePath } from '$lib/server/uploads';
import type { RequestHandler } from './$types';

// Stream a file — the ONLY way bytes leave the server. Access-gated (404 when
// the project is inaccessible, ADR-019). storagePath is never exposed.
export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');
	const [f] = await db.select().from(file).where(eq(file.id, params.id));
	if (!f) return apiError(404, 'Not found');
	if (!(await canAccessProject(locals.user, f.projectId))) return apiError(404, 'Not found');

	let bytes: Buffer;
	try {
		bytes = await readFile(filePath(f.storagePath));
	} catch {
		return apiError(404, 'Not found');
	}
	// only raster images inline; SVG is never stored (blocked on upload) but guard anyway.
	const inline = f.mimeType.startsWith('image/') && f.mimeType !== 'image/svg+xml';
	const disposition = inline ? 'inline' : 'attachment';
	return new Response(new Uint8Array(bytes), {
		headers: {
			'Content-Type': f.mimeType,
			'Content-Length': String(f.size),
			'Content-Disposition': `${disposition}; filename*=UTF-8''${encodeURIComponent(f.filename)}`,
			// stop MIME sniffing + neutralize any active content served from our origin
			'X-Content-Type-Options': 'nosniff',
			'Content-Security-Policy': "sandbox; default-src 'none'"
		}
	});
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return apiError(401, 'Unauthorized');
	const [f] = await db.select().from(file).where(eq(file.id, params.id));
	if (!f) return apiError(404, 'Not found');
	if (!(await canAccessProject(locals.user, f.projectId))) return apiError(404, 'Not found');

	// strip this fileId from any value array of its field
	if (f.fieldId) {
		const rows = await db.select().from(taskCustomValue).where(eq(taskCustomValue.fieldId, f.fieldId));
		for (const r of rows) {
			let ids: string[] = [];
			try {
				const v = JSON.parse(r.value);
				if (Array.isArray(v)) ids = v.map(String);
			} catch {
				continue;
			}
			if (!ids.includes(f.id)) continue;
			const next = ids.filter((x) => x !== f.id);
			if (next.length === 0)
				await db
					.delete(taskCustomValue)
					.where(and(eq(taskCustomValue.taskId, r.taskId), eq(taskCustomValue.fieldId, r.fieldId)));
			else
				await db
					.update(taskCustomValue)
					.set({ value: JSON.stringify(next) })
					.where(and(eq(taskCustomValue.taskId, r.taskId), eq(taskCustomValue.fieldId, r.fieldId)));
		}
	}

	await db.delete(file).where(eq(file.id, params.id));
	try {
		await unlink(filePath(f.storagePath));
	} catch {
		// already gone — fine
	}
	broadcastProjectChange(f.projectId, locals.user.id);
	return json({ success: true });
};
