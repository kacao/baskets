// Client-side multi-select store for bulk actions on tables/lists. A $state-based
// set of task ids scoped to one ordered list of rows; supports plain toggle,
// shift/range select against the last-clicked anchor, select-all, and clear.
// The ordered id list is supplied per-call so range math reflects the view's
// current sort/filter without the store owning that data.

class Selection {
	#ids = $state<Set<string>>(new Set());
	#anchor: string | null = null;

	/** Reactive array of selected ids (stable for iteration in markup). */
	get ids(): string[] {
		return [...this.#ids];
	}

	/** Number of selected rows. */
	get size(): number {
		return this.#ids.size;
	}

	/** True if `id` is currently selected. */
	has(id: string): boolean {
		return this.#ids.has(id);
	}

	/** Toggle a single id and set it as the range anchor. */
	toggle(id: string) {
		const next = new Set(this.#ids);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		this.#ids = next;
		this.#anchor = id;
	}

	/** Explicitly select/deselect one id (anchor follows). */
	set(id: string, on: boolean) {
		const next = new Set(this.#ids);
		if (on) next.add(id);
		else next.delete(id);
		this.#ids = next;
		this.#anchor = id;
	}

	/**
	 * Range/shift select: selects every id between the anchor and `id` inclusive
	 * within `ordered`. Falls back to a plain toggle when there is no anchor or
	 * either endpoint is missing from the list.
	 */
	range(id: string, ordered: string[]) {
		if (!this.#anchor || this.#anchor === id) {
			this.toggle(id);
			return;
		}
		const a = ordered.indexOf(this.#anchor);
		const b = ordered.indexOf(id);
		if (a < 0 || b < 0) {
			this.toggle(id);
			return;
		}
		const [lo, hi] = a < b ? [a, b] : [b, a];
		const next = new Set(this.#ids);
		for (let i = lo; i <= hi; i++) next.add(ordered[i]);
		this.#ids = next;
		// keep anchor where it was so a subsequent shift-click re-ranges from it
	}

	/** Select every id in `ordered` (anchor unchanged). */
	selectAll(ordered: string[]) {
		this.#ids = new Set(ordered);
	}

	/** True when every id in `ordered` is selected (and there is at least one). */
	allSelected(ordered: string[]): boolean {
		return ordered.length > 0 && ordered.every((id) => this.#ids.has(id));
	}

	/** Drop any selected ids no longer present in `ordered` (e.g. after a delete). */
	prune(ordered: string[]) {
		const valid = new Set(ordered);
		let changed = false;
		const next = new Set<string>();
		for (const id of this.#ids) {
			if (valid.has(id)) next.add(id);
			else changed = true;
		}
		if (changed) this.#ids = next;
	}

	/** Clear the selection and the anchor. */
	clear() {
		if (this.#ids.size) this.#ids = new Set();
		this.#anchor = null;
	}
}

/** Shared singleton selection store. Call `.clear()` when leaving a view/project. */
export const selection = new Selection();

/** Factory for an isolated selection (e.g. tests or independent panes). */
export function createSelection() {
	return new Selection();
}
