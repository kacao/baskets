import { cubicOut } from 'svelte/easing';
import type { TransitionConfig } from 'svelte/transition';

/**
 * Popover / dropdown-menu transition: the same feel as the SidePane (Svelte's
 * `fly` — a small translate + fade, 150ms, cubicOut), just along Y since menus
 * open downward from their trigger. css-based, so it auto-respects
 * prefers-reduced-motion.
 */
export function popover(
	_node: Element,
	{ duration = 150, y = 8 }: { duration?: number; y?: number } = {}
): TransitionConfig {
	return {
		duration,
		easing: cubicOut,
		css: (t) => `opacity: ${t}; transform: translateY(${(t - 1) * y}px);`
	};
}
