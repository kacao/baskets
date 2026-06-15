// Tiny app-wide toast primitive (ADR-027). `toast(msg)` pushes a transient
// notice; <Toaster> renders the live list. No deps, auto-dismiss.
type Toast = { id: number; message: string };

let seq = 0;
export const toasts = $state<Toast[]>([]);

export function toast(message: string, ms = 2800) {
	const id = ++seq;
	toasts.push({ id, message });
	setTimeout(() => dismiss(id), ms);
}

export function dismiss(id: number) {
	const i = toasts.findIndex((t) => t.id === id);
	if (i >= 0) toasts.splice(i, 1);
}
