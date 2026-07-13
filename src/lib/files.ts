// Client-safe file display helpers, shared by the project Files page and the "@"
// mention File rows. No server imports.

export type FileKind = 'image' | 'document' | 'other';

/** Human-readable byte size (1 KB = 1024 B). */
export function formatBytes(n: number): string {
	if (!Number.isFinite(n) || n <= 0) return '0 B';
	const units = ['B', 'KB', 'MB', 'GB', 'TB'];
	const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
	const v = n / Math.pow(1024, i);
	return `${i === 0 ? v : v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}

/** Whether a mime type is a previewable raster image (matches the GET /api/files inline rule). */
export function isPreviewableImage(mime: string | null | undefined): boolean {
	return !!mime && mime.startsWith('image/') && mime !== 'image/svg+xml';
}

const DOC_MIME =
	/(pdf|word|excel|spreadsheet|presentation|powerpoint|csv|text\/|json|zip|rtf|opendocument)/i;

/** Coarse category used by the Files page type filter. */
export function fileKind(mime: string | null | undefined): FileKind {
	if (!mime) return 'other';
	if (mime.startsWith('image/')) return 'image';
	if (DOC_MIME.test(mime)) return 'document';
	return 'other';
}

/** An iconoir glyph name for a file based on its mime type / extension. */
export function fileIcon(mime: string | null | undefined, name?: string | null): string {
	const m = mime ?? '';
	if (isPreviewableImage(m)) return 'media-image';
	if (m.startsWith('image/')) return 'media-image';
	if (m.startsWith('video/')) return 'media-video';
	if (m.startsWith('audio/')) return 'sound-high';
	if (m.includes('pdf')) return 'page';
	if (/(zip|compressed|tar|gzip|rar|7z)/i.test(m) || /\.(zip|tar|gz|rar|7z)$/i.test(name ?? ''))
		return 'archive';
	if (/(sheet|excel|csv)/i.test(m) || /\.(csv|xlsx?|ods)$/i.test(name ?? '')) return 'table';
	if (/(word|document|opendocument\.text|rtf|text\/)/i.test(m)) return 'page-edit';
	return 'multiple-pages-empty';
}
