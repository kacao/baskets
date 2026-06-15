// Enforces a single open SidePane across the whole app (ADR-025): panes are owned
// by independent components (a view's task pane, the project Customize/Milestones
// panes), so coordinate them here. When one opens it closes whichever was open
// before by calling that pane's own `onClose`. Keyed by a per-instance token so a
// pane re-registering itself (e.g. prop change) never closes itself.

let current: { id: object; close: () => void } | null = null;

export function openPane(id: object, close: () => void) {
	if (current && current.id !== id) current.close();
	current = { id, close };
}

export function closePane(id: object) {
	if (current?.id === id) current = null;
}
