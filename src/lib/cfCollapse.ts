// Per-container collapse state for multi-value custom fields, persisted in
// localStorage so a field's expanded/collapsed choice survives re-opening its
// container. `scope` is the container id (a task id or a project id), so the
// same field collapses independently on each task / project it appears on.
const key = (scope: string, fieldId: string) => `cfCollapse:${scope}:${fieldId}`;

/** Stored collapse state for (scope, field), or `fallback` if never toggled. */
export function loadCollapsed(scope: string, fieldId: string, fallback: boolean): boolean {
	if (typeof localStorage === 'undefined') return fallback;
	try {
		const v = localStorage.getItem(key(scope, fieldId));
		return v === null ? fallback : v === '1';
	} catch {
		return fallback;
	}
}

/** Persist collapse state for (scope, field). */
export function storeCollapsed(scope: string, fieldId: string, collapsed: boolean): void {
	try {
		localStorage.setItem(key(scope, fieldId), collapsed ? '1' : '0');
	} catch {
		/* localStorage unavailable (SSR / private mode) — non-fatal */
	}
}
