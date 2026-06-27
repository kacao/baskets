// Lightweight themed tooltip as a Svelte action: `use:tooltip={'text'}` or
// `use:tooltip={{ text, placement, delay }}`. One shared floating element serves
// every tooltip (singleton) — no per-instance component cost. Shows on hover
// (mouse only) + keyboard focus, hides on leave/blur/click/Escape/scroll, flips
// to the opposite side when there's no room. Strips the host's native `title` so
// the OS tooltip never doubles up. See ADR: Cross-cutting (motion ≤200ms).

type Placement = 'top' | 'bottom';
type TooltipOptions = string | { text: string; placement?: Placement; delay?: number };

let tipEl: HTMLDivElement | null = null;
let showTimer: ReturnType<typeof setTimeout> | null = null;

function ensureEl(): HTMLDivElement {
	if (tipEl) return tipEl;
	const el = document.createElement('div');
	el.className = 'app-tooltip';
	el.setAttribute('role', 'tooltip');
	document.body.appendChild(el);
	tipEl = el;
	return el;
}

function position(node: HTMLElement, placement: Placement) {
	const el = ensureEl();
	const r = node.getBoundingClientRect();
	const tr = el.getBoundingClientRect();
	const gap = 8;
	const top =
		placement === 'top'
			? r.top - tr.height - gap < 4
				? r.bottom + gap // flip down
				: r.top - tr.height - gap
			: r.bottom + tr.height + gap > window.innerHeight - 4
				? r.top - tr.height - gap // flip up
				: r.bottom + gap;
	const left = Math.max(
		4,
		Math.min(r.left + r.width / 2 - tr.width / 2, window.innerWidth - tr.width - 4)
	);
	el.style.top = `${Math.round(top)}px`;
	el.style.left = `${Math.round(left)}px`;
}

function hideTip() {
	if (showTimer) clearTimeout(showTimer);
	showTimer = null;
	tipEl?.classList.remove('app-tooltip--visible');
	window.removeEventListener('scroll', hideTip, true);
}

export function tooltip(node: HTMLElement, options: TooltipOptions | null | undefined) {
	const normalize = (o: TooltipOptions | null | undefined) =>
		!o
			? { text: '', placement: 'top' as Placement, delay: 350 }
			: typeof o === 'string'
				? { text: o, placement: 'top' as Placement, delay: 350 }
				: { placement: 'top' as Placement, delay: 350, ...o };

	let opts = normalize(options);
	// adopt a pre-existing native title, then strip it so the OS tooltip doesn't double up
	if (!opts.text && node.getAttribute('title')) opts.text = node.getAttribute('title') ?? '';
	if (node.hasAttribute('title')) node.removeAttribute('title');

	const show = () => {
		if (!opts.text) return;
		if (showTimer) clearTimeout(showTimer);
		showTimer = setTimeout(() => {
			const el = ensureEl();
			el.textContent = opts.text;
			position(node, opts.placement);
			el.classList.add('app-tooltip--visible');
			window.addEventListener('scroll', hideTip, true);
		}, opts.delay);
	};

	const onEnter = (e: PointerEvent) => {
		if (e.pointerType && e.pointerType !== 'mouse') return; // skip touch/pen
		show();
	};
	const onFocus = () => show();
	const onKey = (e: KeyboardEvent) => {
		if (e.key === 'Escape') hideTip();
	};

	node.addEventListener('pointerenter', onEnter);
	node.addEventListener('pointerleave', hideTip);
	node.addEventListener('pointerdown', hideTip);
	node.addEventListener('focus', onFocus);
	node.addEventListener('blur', hideTip);
	node.addEventListener('keydown', onKey);

	return {
		update(next: TooltipOptions | null | undefined) {
			opts = normalize(next);
			if (node.hasAttribute('title')) node.removeAttribute('title');
			if (tipEl?.classList.contains('app-tooltip--visible')) {
				tipEl.textContent = opts.text;
				position(node, opts.placement);
			}
		},
		destroy() {
			node.removeEventListener('pointerenter', onEnter);
			node.removeEventListener('pointerleave', hideTip);
			node.removeEventListener('pointerdown', hideTip);
			node.removeEventListener('focus', onFocus);
			node.removeEventListener('blur', hideTip);
			node.removeEventListener('keydown', onKey);
			hideTip();
		}
	};
}
