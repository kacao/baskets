// Project sidebar sub-menu items (ADR-064). Client-safe single source of truth
// shared by the sidebar render, the REST `sidebarItems` validator, and tests.
// Visibility is per project: `project.sidebarItems` = JSON array of the SHOWN
// keys (null = default below, '[]' = none). Storing shown-not-hidden keys means
// items added in future releases default to hidden instead of appearing on
// every existing project.

export const PROJECT_NAV_ITEMS = [
	{ key: 'overview', label: 'Overview', icon: 'text-box', path: '/overview' },
	{ key: 'tasks', label: 'Tasks', icon: 'task-list', path: '' },
	{ key: 'milestones', label: 'Milestones', icon: 'triangle-flag', path: '/milestones' },
	{ key: 'statuses', label: 'Statuses', icon: 'circle', path: '/statuses' },
	{ key: 'labels', label: 'Labels', icon: 'label', path: '/labels' },
	{ key: 'custom-fields', label: 'Custom fields', icon: 'input-field', path: '/custom-fields' },
	{ key: 'locations', label: 'Locations', icon: 'map-pin', path: '/locations' },
	{ key: 'files', label: 'Files', icon: 'multiple-pages', path: '/files' },
	{ key: 'settings', label: 'Settings', icon: 'settings', path: '/settings' }
] as const;

export type ProjectNavKey = (typeof PROJECT_NAV_ITEMS)[number]['key'];

export const PROJECT_NAV_KEYS: ProjectNavKey[] = PROJECT_NAV_ITEMS.map((i) => i.key);

export const DEFAULT_SIDEBAR_ITEMS: ProjectNavKey[] = ['tasks', 'milestones'];

export function projectNavHref(projectId: string, item: { path: string }): string {
	return `/projects/${projectId}${item.path}`;
}

/** Decode a stored `project.sidebarItems` value into the shown keys, in
 *  canonical nav order. Tolerant: null/undefined = the default set, malformed
 *  JSON / non-arrays fall back to the default, unknown keys are dropped. */
export function parseSidebarItems(raw: string | null | undefined): ProjectNavKey[] {
	if (raw == null) return DEFAULT_SIDEBAR_ITEMS;
	try {
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return DEFAULT_SIDEBAR_ITEMS;
		const shown = new Set(parsed.filter((k): k is string => typeof k === 'string'));
		return PROJECT_NAV_KEYS.filter((k) => shown.has(k));
	} catch {
		return DEFAULT_SIDEBAR_ITEMS;
	}
}
