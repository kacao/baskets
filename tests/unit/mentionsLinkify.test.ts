import { describe, expect, it } from 'vitest';
import { linkify, type TextPiece } from '$lib/mentions';

const links = (pieces: TextPiece[]) => pieces.filter((p) => p.type === 'link');

describe('linkify happy path', () => {
	it('returns an empty array for an empty string', () => {
		expect(linkify('')).toEqual([]);
	});

	it('returns a single text piece when there are no links', () => {
		expect(linkify('just some plain words')).toEqual([
			{ type: 'text', text: 'just some plain words' }
		]);
	});

	it('detects an http URL with the URL as its href', () => {
		expect(linkify('http://example.com')).toEqual([
			{ type: 'link', text: 'http://example.com', href: 'http://example.com' }
		]);
	});

	it('detects an https URL with the URL as its href', () => {
		expect(linkify('https://example.com/path')).toEqual([
			{ type: 'link', text: 'https://example.com/path', href: 'https://example.com/path' }
		]);
	});

	it('prefixes a bare www. host with an https:// href while keeping the visible text bare', () => {
		expect(linkify('www.example.com')).toEqual([
			{ type: 'link', text: 'www.example.com', href: 'https://www.example.com' }
		]);
	});

	it('turns an email address into a mailto: href', () => {
		expect(linkify('me@example.com')).toEqual([
			{ type: 'link', text: 'me@example.com', href: 'mailto:me@example.com' }
		]);
	});
});

describe('linkify trailing punctuation', () => {
	it('pushes a trailing period out of the link into a following text piece', () => {
		expect(linkify('see https://example.com.')).toEqual([
			{ type: 'text', text: 'see ' },
			{ type: 'link', text: 'https://example.com', href: 'https://example.com' },
			{ type: 'text', text: '.' }
		]);
	});

	it('pushes a trailing comma out of the link', () => {
		expect(linkify('https://example.com, next')).toEqual([
			{ type: 'link', text: 'https://example.com', href: 'https://example.com' },
			{ type: 'text', text: ',' },
			{ type: 'text', text: ' next' }
		]);
	});

	it('trims a trailing paren that has no opening paren in the URL', () => {
		expect(linkify('(https://example.com)')).toEqual([
			{ type: 'text', text: '(' },
			{ type: 'link', text: 'https://example.com', href: 'https://example.com' },
			{ type: 'text', text: ')' }
		]);
	});

	it('trims multiple consecutive trailing punctuation characters', () => {
		expect(linkify('https://example.com?!')).toEqual([
			{ type: 'link', text: 'https://example.com', href: 'https://example.com' },
			{ type: 'text', text: '?!' }
		]);
	});
});

describe('linkify balanced parentheses', () => {
	it('keeps a closing paren that balances an opening paren inside the URL', () => {
		const url = 'https://en.wikipedia.org/wiki/Mercury_(disambiguation)';
		expect(linkify(url)).toEqual([{ type: 'link', text: url, href: url }]);
	});

	it('keeps the balanced closing paren but still trims a sentence period after it', () => {
		const url = 'https://en.wikipedia.org/wiki/Mercury_(disambiguation)';
		expect(linkify(`${url}.`)).toEqual([
			{ type: 'link', text: url, href: url },
			{ type: 'text', text: '.' }
		]);
	});
});

describe('linkify href safety', () => {
	it('never produces a javascript: or data: href, only http/https/mailto', () => {
		const pieces = linkify(
			'plain http://a.com and www.b.com and c@d.com javascript:alert(1) data:text/html'
		);
		for (const link of links(pieces)) {
			expect(link.href).toMatch(/^(https?:|mailto:)/);
		}
		expect(links(pieces).some((l) => /^javascript:/i.test(l.href))).toBe(false);
		expect(links(pieces).some((l) => /^data:/i.test(l.href))).toBe(false);
	});
});

describe('linkify ordering', () => {
	it('preserves order as text, link, text when a link is interleaved with text', () => {
		expect(linkify('before https://example.com after')).toEqual([
			{ type: 'text', text: 'before ' },
			{ type: 'link', text: 'https://example.com', href: 'https://example.com' },
			{ type: 'text', text: ' after' }
		]);
	});
});
