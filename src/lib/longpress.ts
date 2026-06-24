// Touch long-press → fires `onLongpress({clientX, clientY})`, the mobile equivalent of
// a right-click. Pair it with an existing `oncontextmenu` (mouse) on the same element:
// both call the same handler. No-op for mouse/pen (those use the native context menu).
//
// Cancels if the finger moves past a small threshold (so it never fights a scroll/drag).
// After firing it briefly swallows a trailing synthetic `click` so a window
// click-to-dismiss handler can't instantly close the menu it opens — but that swallow
// SELF-REMOVES after a short window, because many touch browsers (iOS Safari) emit no
// click after a long-press lift, which would otherwise strand the listener and eat the
// user's first real tap on the menu.

export interface LongpressOptions {
	onLongpress: (point: { clientX: number; clientY: number }) => void;
	duration?: number;
	moveTolerance?: number;
}

type LongpressArg = LongpressOptions | ((point: { clientX: number; clientY: number }) => void);

function normalize(arg: LongpressArg): LongpressOptions {
	return typeof arg === 'function' ? { onLongpress: arg } : arg;
}

export function longpress(node: HTMLElement, arg: LongpressArg) {
	let opts = normalize(arg);
	let timer: ReturnType<typeof setTimeout> | null = null;
	let startX = 0;
	let startY = 0;
	let fired = false;
	let removeSwallow: (() => void) | null = null;

	const clear = () => {
		if (timer) clearTimeout(timer);
		timer = null;
	};

	// swallow the next click for a short window, then self-remove (a missing trailing
	// click must not strand the listener and eat a later genuine tap).
	function swallowNextClick() {
		removeSwallow?.();
		const onClick = (ev: Event) => {
			ev.stopPropagation();
			ev.preventDefault();
			done();
		};
		const t = setTimeout(() => done(), 500);
		const done = () => {
			clearTimeout(t);
			window.removeEventListener('click', onClick, true);
			removeSwallow = null;
		};
		window.addEventListener('click', onClick, true);
		removeSwallow = done;
	}

	function onTouchStart(e: TouchEvent) {
		if (e.touches.length !== 1) return clear();
		fired = false;
		startX = e.touches[0].clientX;
		startY = e.touches[0].clientY;
		clear();
		timer = setTimeout(() => {
			timer = null;
			fired = true;
			navigator.vibrate?.(10);
			swallowNextClick();
			opts.onLongpress({ clientX: startX, clientY: startY });
		}, opts.duration ?? 450);
	}

	function onTouchMove(e: TouchEvent) {
		if (!timer) return;
		const t = e.touches[0];
		if (Math.hypot(t.clientX - startX, t.clientY - startY) > (opts.moveTolerance ?? 10)) clear();
	}

	function onTouchEnd() {
		clear();
		fired = false;
	}

	// long-press also triggers the OS callout/selection on iOS — suppress while pressing
	function onContextMenu(e: Event) {
		if (fired) e.preventDefault();
	}

	node.addEventListener('touchstart', onTouchStart, { passive: true });
	node.addEventListener('touchmove', onTouchMove, { passive: true });
	node.addEventListener('touchend', onTouchEnd);
	node.addEventListener('touchcancel', onTouchEnd);
	node.addEventListener('contextmenu', onContextMenu);

	return {
		update(next: LongpressArg) {
			opts = normalize(next);
		},
		destroy() {
			clear();
			removeSwallow?.();
			node.removeEventListener('touchstart', onTouchStart);
			node.removeEventListener('touchmove', onTouchMove);
			node.removeEventListener('touchend', onTouchEnd);
			node.removeEventListener('touchcancel', onTouchEnd);
			node.removeEventListener('contextmenu', onContextMenu);
		}
	};
}
