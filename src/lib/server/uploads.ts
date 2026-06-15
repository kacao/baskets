import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { db } from './db';
import { file } from './db/schema';

/** Local disk root for uploaded files (gitignored, created on demand). */
export const UPLOADS_DIR = env.UPLOADS_DIR ?? './data/uploads';

// Extensions never accepted — executables AND active markup (SVG/HTML/XML can
// carry <script>; served from our own origin they'd be stored XSS).
export const BLOCKED_EXT = new Set([
	'exe', 'sh', 'bat', 'cmd', 'com', 'msi', 'dll', 'scr', 'jar', 'app',
	'svg', 'svgz', 'html', 'htm', 'xhtml', 'xml', 'mhtml', 'js', 'mjs'
]);

// Server-derived Content-Type allowlist (we do NOT trust the client's blob.type).
// Anything not listed is stored + served as application/octet-stream.
const EXT_MIME: Record<string, string> = {
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	gif: 'image/gif',
	webp: 'image/webp',
	avif: 'image/avif',
	bmp: 'image/bmp',
	pdf: 'application/pdf',
	txt: 'text/plain',
	md: 'text/plain',
	csv: 'text/csv',
	json: 'application/json',
	zip: 'application/zip',
	doc: 'application/msword',
	docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
	xls: 'application/vnd.ms-excel',
	xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
	ppt: 'application/vnd.ms-powerpoint',
	pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
	mp4: 'video/mp4',
	mov: 'video/quicktime',
	mp3: 'audio/mpeg',
	wav: 'audio/wav'
};

/** Server-trusted MIME from a filename extension (never the client's claim). */
export const mimeForExt = (ext: string) =>
	EXT_MIME[ext.toLowerCase().replace(/^\./, '')] ?? 'application/octet-stream';

export const filePath = (storagePath: string) => join(UPLOADS_DIR, storagePath);

/**
 * Remove all files belonging to a custom field: unlink each from disk (best
 * effort) and delete the rows. Call before deleting a files-type field — the
 * FK only nulls `file.fieldId`, so without this the bytes + rows would orphan.
 */
export async function deleteFilesForField(fieldId: string) {
	const rows = await db.select().from(file).where(eq(file.fieldId, fieldId));
	for (const f of rows) {
		try {
			await unlink(filePath(f.storagePath));
		} catch {
			// already gone — fine
		}
	}
	if (rows.length > 0) await db.delete(file).where(eq(file.fieldId, fieldId));
}
