/**
 * Validate a `?redirect=` param as a same-origin relative path (ADR-062 W3).
 * Returns the path only when it is a safe in-app destination; otherwise null.
 *
 * Rules: must start with a single `/` (a relative path), and the second char
 * must not be `/` or `\` — `//evil.com` / `/\evil.com` are protocol-relative
 * URLs browsers resolve cross-origin (open-redirect vector). Control chars,
 * space, and DEL are rejected (CRLF- or space-smuggled targets). Shared by the
 * (auth) layout guard (server) and the login/register pages (client) so both
 * agree on what's safe.
 */
export function safeRedirect(param: string | null | undefined): string | null {
	if (!param) return null;
	if (param[0] !== '/') return null;
	if (param[1] === '/' || param[1] === '\\') return null;
	for (let i = 0; i < param.length; i++) {
		const code = param.charCodeAt(i);
		if (code <= 0x20 || code === 0x7f) return null;
	}
	return param;
}
