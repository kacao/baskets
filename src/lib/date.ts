export function fmtDate(d: Date | string | null): string | null {
	if (!d) return null;
	return new Date(d).toISOString().slice(0, 10);
}

export function fmtDateShort(d: Date | string | null): string | null {
	if (!d) return null;
	return new Date(d).toISOString().slice(5, 10);
}
