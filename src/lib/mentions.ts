// Inline "@" reference tokens (ADR: mention references). A reference is stored
// inside the existing plain-text columns (task.description / comment.body /
// project.description) as `@[label](kind:id)` — no schema change. `label` is the
// denormalized display name at insert time (a fallback when the entity is gone);
// `id` is the entity id (for `person` it is the user id). Client + server safe:
// this module touches no DOM and no server-only imports.

export type MentionKind = 'task' | 'location' | 'file' | 'project' | 'person';

export const MENTION_KINDS: MentionKind[] = ['task', 'location', 'file', 'project', 'person'];

export type Mention = { kind: MentionKind; id: string; label: string };

export type MentionSegment = { type: 'text'; text: string } | ({ type: 'mention' } & Mention);

// label: anything but ']' ; id: anything but ')'. Tolerant by design — a half-typed
// token simply doesn't match and renders as plain text.
const TOKEN_RE = /@\[([^\]]*)\]\((task|location|file|project|person):([^)]+)\)/g;

/** Serialize a mention to its inline token form. Strips characters that would break the token. */
export function buildToken(m: Mention): string {
	const label = (m.label ?? '').replace(/\]/g, '').replace(/[\r\n]+/g, ' ').trim() || m.kind;
	const id = String(m.id).replace(/\)/g, '');
	return `@[${label}](${m.kind}:${id})`;
}

/** Split text into ordered text / mention segments for rendering. Never throws. */
export function parseMentions(text: string | null | undefined): MentionSegment[] {
	const out: MentionSegment[] = [];
	if (!text) return out;
	let last = 0;
	TOKEN_RE.lastIndex = 0;
	let m: RegExpExecArray | null;
	while ((m = TOKEN_RE.exec(text))) {
		if (m.index > last) out.push({ type: 'text', text: text.slice(last, m.index) });
		out.push({ type: 'mention', kind: m[2] as MentionKind, id: m[3], label: m[1] });
		last = m.index + m[0].length;
	}
	if (last < text.length) out.push({ type: 'text', text: text.slice(last) });
	return out;
}

/** Every reference contained in the text (deduplication is the caller's job). */
export function extractRefs(text: string | null | undefined): Mention[] {
	const refs: Mention[] = [];
	if (!text) return refs;
	TOKEN_RE.lastIndex = 0;
	let m: RegExpExecArray | null;
	while ((m = TOKEN_RE.exec(text))) {
		refs.push({ kind: m[2] as MentionKind, id: m[3], label: m[1] });
	}
	return refs;
}

export type TextPiece = { type: 'text'; text: string } | { type: 'link'; text: string; href: string };

// http(s):// URLs, bare www.… hosts, and email addresses. Deliberately limited to
// these so a rendered href can only ever be http(s)/mailto — never javascript: etc.
const LINK_RE = /(https?:\/\/[^\s<]+|www\.[^\s<]+|[^\s<@]+@[^\s<@]+\.[^\s<@]{2,})/gi;
// trailing punctuation that's almost never part of the URL/email itself
const TRAIL_RE = /[.,;:!?)\]}'"»…]+$/;

/**
 * Split plain text into text + auto-detected link pieces (the Notion/Linear
 * behaviour: bare URLs in text render as clickable links). Render-only — the
 * stored text is never rewritten. Trailing sentence punctuation is pushed back
 * out of the link; a closing ')' is kept only when it balances a '(' inside.
 */
export function linkify(text: string): TextPiece[] {
	const out: TextPiece[] = [];
	if (!text) return out;
	let last = 0;
	LINK_RE.lastIndex = 0;
	let m: RegExpExecArray | null;
	while ((m = LINK_RE.exec(text))) {
		let raw = m[0];
		const start = m.index;
		const full = m[0].length;
		let trail = '';
		const tm = raw.match(TRAIL_RE);
		if (tm) {
			let cut = tm[0];
			// keep one ')' if the URL opens a '(' that isn't otherwise closed
			if (
				cut.startsWith(')') &&
				(raw.slice(0, -cut.length).match(/\(/g)?.length ?? 0) >
					(raw.slice(0, -cut.length).match(/\)/g)?.length ?? 0)
			) {
				cut = cut.slice(1);
			}
			if (cut) {
				raw = raw.slice(0, raw.length - cut.length);
				trail = cut;
			}
		}
		if (!raw) continue;
		if (start > last) out.push({ type: 'text', text: text.slice(last, start) });
		const isEmail = /^[^\s<@]+@[^\s<@]+$/.test(raw);
		const href = isEmail ? `mailto:${raw}` : raw.startsWith('www.') ? `https://${raw}` : raw;
		out.push({ type: 'link', text: raw, href });
		if (trail) out.push({ type: 'text', text: trail });
		last = start + full;
	}
	if (last < text.length) out.push({ type: 'text', text: text.slice(last) });
	return out;
}

export type MentionQuery = { query: string; start: number };

/**
 * Detect an active "@query" immediately to the left of the caret in a textarea
 * value. Returns the typed query (text after '@', no whitespace) and the index of
 * the '@'. The '@' must sit at the start of the text or after whitespace/'(' so we
 * don't fire inside email addresses or mid-word handles. Returns null when there
 * is no active mention query at the caret.
 */
export function detectQuery(value: string, caret: number): MentionQuery | null {
	let i = caret - 1;
	while (i >= 0) {
		const ch = value[i];
		if (ch === '@') {
			const before = i === 0 ? '' : value[i - 1];
			if (i === 0 || /[\s(]/.test(before)) {
				const query = value.slice(i + 1, caret);
				if (!/[\s@\]]/.test(query) && query.length <= 40) return { query, start: i };
			}
			return null;
		}
		if (/\s/.test(ch)) return null; // hit whitespace before an '@' → not in a query
		if (caret - i > 60) return null; // bail on pathologically long scans
		i--;
	}
	return null;
}
