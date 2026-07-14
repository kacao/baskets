import { describe, expect, it } from 'vitest';
import { safeRedirect } from '$lib/safeRedirect';

// ADR-062 W3 — the `?redirect=` validator guarding the (auth) layout + login/
// register. It must accept only same-origin relative paths and reject every
// open-redirect / smuggling vector.

describe('safeRedirect — accepts safe in-app relative paths', () => {
	it.each([
		['/invite/abc', '/invite/abc'],
		['/projects', '/projects'],
		['/projects?task=1&x=2', '/projects?task=1&x=2'],
		['/', '/'],
		['/a/b/c#frag', '/a/b/c#frag']
	])('%s → %s', (input, expected) => {
		expect(safeRedirect(input)).toBe(expected);
	});
});

describe('safeRedirect — rejects unsafe targets (→ null)', () => {
	it.each([
		null,
		undefined,
		'',
		'//evil.com', // protocol-relative → cross-origin
		'///evil.com',
		'/\\evil.com', // backslash protocol-relative (browsers normalize \\ → //)
		'\\/evil.com', // does not start with '/'
		'http://evil.com', // absolute
		'https://evil.com',
		'HTTPS://evil.com',
		'javascript:alert(1)', // scheme, not a path
		'mailto:x@y.z',
		'evil.com', // no leading slash
		'/foo bar', // space (0x20) is rejected
		'/foo\tbar', // tab (control char)
		'/foo\nbar', // newline (CRLF smuggling)
		'/foo\rbar',
		'/foo\x00bar', // NUL
		'/foo\x7fbar' // DEL
	])('%o → null', (input) => {
		expect(safeRedirect(input as string | null | undefined)).toBeNull();
	});
});
