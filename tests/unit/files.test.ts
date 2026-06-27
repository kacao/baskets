import { describe, expect, it } from 'vitest';
import { formatBytes, fileKind, fileIcon, isPreviewableImage } from '$lib/files';

describe('formatBytes', () => {
	it('returns "0 B" for zero, negative, and non-finite', () => {
		expect(formatBytes(0)).toBe('0 B');
		expect(formatBytes(-5)).toBe('0 B');
		expect(formatBytes(NaN)).toBe('0 B');
		expect(formatBytes(Infinity)).toBe('0 B');
	});

	it('shows raw bytes with no decimals under 1 KB', () => {
		expect(formatBytes(512)).toBe('512 B');
		expect(formatBytes(1)).toBe('1 B');
	});

	it('shows one decimal in the single digits', () => {
		expect(formatBytes(1024)).toBe('1.0 KB');
		expect(formatBytes(1536)).toBe('1.5 KB');
		expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
	});

	it('drops decimals at ten or above', () => {
		expect(formatBytes(15 * 1024 * 1024)).toBe('15 MB');
	});
});

describe('isPreviewableImage', () => {
	it('is true only for raster images', () => {
		expect(isPreviewableImage('image/png')).toBe(true);
		expect(isPreviewableImage('image/jpeg')).toBe(true);
	});
	it('is false for svg, non-images, and nullish', () => {
		expect(isPreviewableImage('image/svg+xml')).toBe(false);
		expect(isPreviewableImage('text/plain')).toBe(false);
		expect(isPreviewableImage(null)).toBe(false);
		expect(isPreviewableImage(undefined)).toBe(false);
	});
});

describe('fileKind', () => {
	it('classifies images', () => {
		expect(fileKind('image/png')).toBe('image');
		expect(fileKind('image/svg+xml')).toBe('image');
	});
	it('classifies documents', () => {
		expect(fileKind('application/pdf')).toBe('document');
		expect(fileKind('text/plain')).toBe('document');
	});
	it('falls back to other', () => {
		expect(fileKind('application/octet-stream')).toBe('other');
		expect(fileKind('video/mp4')).toBe('other');
		expect(fileKind(null)).toBe('other');
		expect(fileKind(undefined)).toBe('other');
	});
});

describe('fileIcon', () => {
	it('maps common types to iconoir names', () => {
		expect(fileIcon('image/png')).toBe('media-image');
		expect(fileIcon('image/svg+xml')).toBe('media-image');
		expect(fileIcon('video/mp4')).toBe('media-video');
		expect(fileIcon('audio/mpeg')).toBe('sound-high');
		expect(fileIcon('application/pdf')).toBe('page');
	});
	it('falls back to a generic page icon for unknown/nullish', () => {
		expect(fileIcon(null)).toBe('multiple-pages-empty');
		expect(fileIcon('application/octet-stream')).toBe('multiple-pages-empty');
	});
});
