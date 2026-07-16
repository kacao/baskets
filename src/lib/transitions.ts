import { cubicOut } from 'svelte/easing';
import type { TransitionConfig } from 'svelte/transition';

export const DUR_FAST = 100;
export const DUR = 150;
export const DUR_SLOW = 200;

/**
 * Popover / dropdown-menu transition: the same feel as the SidePane (Svelte's
 * `fly` — a small translate + fade, 150ms, cubicOut), just along Y since menus
 * open downward from their trigger, plus a subtle scale (0.96 → 1) so the menu
 * grows from its trigger corner (set `transform-origin` on the surface).
 * css-based, so it auto-respects prefers-reduced-motion.
 */
export function popover(
	_node: Element,
	{ duration = 150, y = 8 }: { duration?: number; y?: number } = {}
): TransitionConfig {
	return {
		duration,
		easing: cubicOut,
		css: (t) => `opacity: ${t}; transform: translateY(${(t - 1) * y}px) scale(${0.96 + 0.04 * t});`
	};
}
