import { describe, expect, it } from 'vitest';
import {
	parseMentions,
	buildToken,
	extractRefs,
	detectQuery,
	linkify,
	type Mention
} from '$lib/mentions';

describe('parseMentions', () => {
	it('returns nothing for empty/null', () => {
		expect(parseMentions('')).toEqual([]);
		expect(parseMentions(null)).toEqual([]);
		expect(parseMentions(undefined)).toEqual([]);
	});

	it('returns a single text segment for plain text', () => {
		expect(parseMentions('hello world')).toEqual([{ type: 'text', text: 'hello world' }]);
	});

	it('splits text around a token', () => {
		const segs = parseMentions('see @[Fix login](task:t1) now');
		expect(segs).toEqual([
			{ type: 'text', text: 'see ' },
			{ type: 'mention', kind: 'task', id: 't1', label: 'Fix login' },
			{ type: 'text', text: ' now' }
		]);
	});

	it('handles adjacent tokens with no text between', () => {
		const segs = parseMentions('@[A](task:1)@[B](person:u2)');
		expect(segs).toEqual([
			{ type: 'mention', kind: 'task', id: '1', label: 'A' },
			{ type: 'mention', kind: 'person', id: 'u2', label: 'B' }
		]);
	});

	it('leaves a half-typed/broken token as plain text', () => {
		expect(parseMentions('@[label](person:')).toEqual([{ type: 'text', text: '@[label](person:' }]);
	});
});

describe('buildToken', () => {
	it('serializes a mention', () => {
		expect(buildToken({ kind: 'task', id: 't1', label: 'Demolition' })).toBe(
			'@[Demolition](task:t1)'
		);
	});

	it('strips characters that would break the token', () => {
		expect(buildToken({ kind: 'task', id: 'a)b', label: 'we]ird\nname' })).toBe(
			'@[weird name](task:ab)'
		);
	});

	it('falls back to the kind when the label is empty', () => {
		expect(buildToken({ kind: 'file', id: 'f1', label: '' })).toBe('@[file](file:f1)');
	});

	it('round-trips through parseMentions', () => {
		const m: Mention = { kind: 'project', id: 'p-9', label: 'Demo Site' };
		const segs = parseMentions(`x ${buildToken(m)} y`);
		expect(segs[1]).toEqual({ type: 'mention', ...m });
	});
});

describe('extractRefs', () => {
	it('returns every reference', () => {
		const refs = extractRefs('@[A](task:1) and @[B](person:u2) and @[C](file:f3)');
		expect(refs).toEqual([
			{ kind: 'task', id: '1', label: 'A' },
			{ kind: 'person', id: 'u2', label: 'B' },
			{ kind: 'file', id: 'f3', label: 'C' }
		]);
	});
	it('returns [] for text with no refs', () => {
		expect(extractRefs('nothing here')).toEqual([]);
	});
});

describe('detectQuery', () => {
	it('fires at the start of the text', () => {
		expect(detectQuery('@foo', 4)).toEqual({ query: 'foo', start: 0 });
	});
	it('fires after whitespace', () => {
		expect(detectQuery('hi @ab', 6)).toEqual({ query: 'ab', start: 3 });
	});
	it('fires after an opening paren', () => {
		expect(detectQuery('(@x', 3)).toEqual({ query: 'x', start: 1 });
	});
	it('fires with an empty query right after @', () => {
		expect(detectQuery('@', 1)).toEqual({ query: '', start: 0 });
	});
	it('does NOT fire mid-word (e.g. an email/handle)', () => {
		expect(detectQuery('foo@bar', 7)).toBeNull();
	});
	it('does NOT fire once the query contains whitespace', () => {
		expect(detectQuery('@a b', 4)).toBeNull();
	});
});

describe('linkify', () => {
	it('returns plain text untouched', () => {
		expect(linkify('just text')).toEqual([{ type: 'text', text: 'just text' }]);
	});

	it('links an http(s) URL surrounded by text', () => {
		expect(linkify('see https://x.com here')).toEqual([
			{ type: 'text', text: 'see ' },
			{ type: 'link', text: 'https://x.com', href: 'https://x.com' },
			{ type: 'text', text: ' here' }
		]);
	});

	it('pushes trailing sentence punctuation out of the link', () => {
		expect(linkify('docs at https://x.com.')).toEqual([
			{ type: 'text', text: 'docs at ' },
			{ type: 'link', text: 'https://x.com', href: 'https://x.com' },
			{ type: 'text', text: '.' }
		]);
	});

	it('keeps a closing paren that balances one inside the URL', () => {
		const url = 'https://en.wikipedia.org/wiki/Foo_(bar)';
		expect(linkify(url)).toEqual([{ type: 'link', text: url, href: url }]);
	});

	it('upgrades a bare www. host to https', () => {
		expect(linkify('www.example.com')).toEqual([
			{ type: 'link', text: 'www.example.com', href: 'https://www.example.com' }
		]);
	});

	it('links an email as mailto', () => {
		expect(linkify('ping me@test.com')).toEqual([
			{ type: 'text', text: 'ping ' },
			{ type: 'link', text: 'me@test.com', href: 'mailto:me@test.com' }
		]);
	});

	it('does NOT link a javascript: scheme (XSS guard)', () => {
		expect(linkify('javascript:alert(1)')).toEqual([{ type: 'text', text: 'javascript:alert(1)' }]);
	});

	it('does NOT link a data: URL', () => {
		const s = 'data:text/html,<script>x</script>';
		expect(linkify(s).every((p) => p.type === 'text')).toBe(true);
	});

	it('never emits an href outside http(s)/mailto', () => {
		const inputs = [
			'javascript:alert(1)',
			'data:text/html,x',
			'vbscript:msgbox',
			'file:///etc/passwd'
		];
		for (const s of inputs) {
			for (const piece of linkify(s)) {
				if (piece.type === 'link') {
					expect(piece.href).toMatch(/^(https?:|mailto:)/);
				}
			}
		}
	});
});
