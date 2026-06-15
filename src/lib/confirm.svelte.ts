// App-wide centered confirm dialog (mirrors the toast primitive). `confirmDialog(msg)`
// returns a Promise<boolean>; <ConfirmModal> (mounted once in the app shell) renders
// the request. Replaces the browser-native confirm() so the dialog is page-centered
// and theme-consistent. Strings are passed already-translated by the caller.
type ConfirmReq = {
	id: number;
	message: string;
	confirmLabel: string;
	cancelLabel: string;
	danger: boolean;
	resolve: (ok: boolean) => void;
};

let seq = 0;
export const confirmState = $state<{ current: ConfirmReq | null }>({ current: null });

export function confirmDialog(
	message: string,
	opts?: { confirmLabel?: string; cancelLabel?: string; danger?: boolean }
): Promise<boolean> {
	// resolve any dialog already open (treat as cancelled) before opening a new one
	confirmState.current?.resolve(false);
	return new Promise((resolve) => {
		confirmState.current = {
			id: ++seq,
			message,
			confirmLabel: opts?.confirmLabel ?? 'Confirm',
			cancelLabel: opts?.cancelLabel ?? 'Cancel',
			danger: opts?.danger ?? false,
			resolve
		};
	});
}

export function answerConfirm(ok: boolean) {
	const req = confirmState.current;
	if (!req) return;
	confirmState.current = null;
	req.resolve(ok);
}
