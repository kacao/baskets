<script lang="ts">
	// A contenteditable rich editor with inline "@" reference pills (ADR-047). Unlike
	// a <textarea> (which can only show raw text), this renders each mention as an
	// atomic, clickable pill WHILE editing — the Notion/Linear behaviour. The stored
	// value is still the plain-text token format `@[label](kind:id)`: the DOM is
	// serialized to that on every input, and re-rendered from it on external changes.
	// Caret anchoring uses the native Selection API (no mirror-div needed).
	import { tick } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import Icon from '$lib/components/Icon.svelte';
	import { t } from '$lib/i18n';
	import {
		buildToken,
		parseMentions,
		detectQuery,
		MENTION_KINDS,
		type Mention,
		type MentionKind
	} from '$lib/mentions';

	let {
		value = $bindable(''),
		name,
		id,
		rows = 4,
		placeholder = '',
		ariaLabel,
		disabled = false,
		class: klass = '',
		onblur,
		onkeydown,
		onSelectTask,
		projectId,
		canEditProject = false,
		excludeTaskId,
		tasks = [],
		locations = [],
		files = [],
		projects = [],
		people = []
	}: {
		value?: string;
		name?: string;
		id?: string;
		rows?: number;
		placeholder?: string;
		ariaLabel?: string;
		disabled?: boolean;
		class?: string;
		onblur?: (e: FocusEvent & { currentTarget: HTMLElement }) => void;
		onkeydown?: (e: KeyboardEvent & { currentTarget: HTMLElement }) => void;
		onSelectTask?: (id: string) => void;
		projectId?: string;
		canEditProject?: boolean;
		excludeTaskId?: string;
		tasks?: { id: string; title: string }[];
		locations?: { id: string; title: string; address?: string | null }[];
		files?: { id: string; filename: string; mimeType?: string }[];
		projects?: { id: string; name: string }[];
		people?: { id: string; name: string | null; email?: string | null }[];
	} = $props();

	const KIND_LABEL: Record<MentionKind, string> = {
		task: 'Task',
		location: 'Location',
		file: 'File',
		project: 'Project',
		person: 'Person'
	};
	const KIND_ICON: Record<MentionKind, string> = {
		task: 'task-list',
		location: 'map-pin',
		file: 'page',
		project: 'folder',
		person: 'user'
	};
	const PER_KIND = 6;

	type Cand = Mention & { sub?: string | null };
	type Entry = { type: 'cand'; cand: Cand } | { type: 'create'; kind: MentionKind };

	let editor = $state<HTMLElement | null>(null);
	let menuEl = $state<HTMLElement | null>(null);
	let fileInput = $state<HTMLInputElement | null>(null);

	let open = $state(false);
	let query = $state('');
	let activeKind = $state<MentionKind | null>(null);
	let activeIndex = $state(0);
	let coords = $state<{ top: number; left: number; height: number } | null>(null);
	let busy = $state(false);

	// the value last read from / written to the DOM, so an EXTERNAL value change
	// re-renders the DOM but our own input edits don't (which would kill the caret)
	let lastValue = '';
	// the "@query" being typed, captured for pill insertion
	let anchorNode: Text | null = null;
	let anchorStart = 0;

	function resolveLabel(kind: MentionKind, refId: string): string | null {
		switch (kind) {
			case 'task':
				return tasks.find((x) => x.id === refId)?.title ?? null;
			case 'location':
				return locations.find((x) => x.id === refId)?.title ?? null;
			case 'file':
				return files.find((x) => x.id === refId)?.filename ?? null;
			case 'project':
				return projects.find((x) => x.id === refId)?.name ?? null;
			case 'person':
				return people.find((x) => x.id === refId)?.name ?? null;
		}
	}

	function makePill(m: Mention): HTMLElement {
		const el = document.createElement('span');
		el.className = `cm-pill cm-${m.kind}`;
		el.contentEditable = 'false';
		el.dataset.token = buildToken(m);
		el.dataset.kind = m.kind;
		el.dataset.refid = m.id;
		const label = resolveLabel(m.kind, m.id) ?? m.label;
		const k = document.createElement('span');
		k.className = 'cm-pill-kind';
		k.textContent = KIND_LABEL[m.kind];
		const l = document.createElement('span');
		l.className = 'cm-pill-label';
		l.textContent = label;
		el.append(k, l);
		el.title = label;
		return el;
	}

	function buildNodes(text: string): Node[] {
		const out: Node[] = [];
		for (const seg of parseMentions(text)) {
			if (seg.type === 'text') {
				if (seg.text) out.push(document.createTextNode(seg.text));
			} else {
				out.push(makePill(seg));
			}
		}
		return out;
	}

	function render() {
		if (!editor) return;
		editor.replaceChildren(...buildNodes(value));
	}

	// DOM → plain-text-with-tokens. Pills emit their stored token; <br>/blocks → newlines.
	function serialize(root: Node): string {
		let out = '';
		root.childNodes.forEach((node) => {
			if (node.nodeType === Node.TEXT_NODE) out += node.textContent ?? '';
			else if (node.nodeName === 'BR') out += '\n';
			else if (node instanceof HTMLElement && node.dataset.token) out += node.dataset.token;
			else if (node instanceof HTMLElement) {
				if (out && !out.endsWith('\n')) out += '\n';
				out += serialize(node);
			}
		});
		return out;
	}

	$effect(() => {
		if (value !== lastValue) {
			lastValue = value;
			render();
		}
	});

	// ---- candidate list (same model as the textarea picker) ----
	function matches(hay: string | null | undefined, q: string) {
		return (hay ?? '').toLowerCase().includes(q);
	}
	function kindCands(kind: MentionKind, q: string): Cand[] {
		let list: Cand[] = [];
		switch (kind) {
			case 'task':
				list = tasks
					.filter((x) => x.id !== excludeTaskId)
					.map((x) => ({ kind, id: x.id, label: x.title }));
				break;
			case 'location':
				list = locations.map((x) => ({ kind, id: x.id, label: x.title, sub: x.address }));
				break;
			case 'file':
				list = files.map((x) => ({ kind, id: x.id, label: x.filename, sub: x.mimeType }));
				break;
			case 'project':
				list = projects.map((x) => ({ kind, id: x.id, label: x.name }));
				break;
			case 'person':
				list = people.map((x) => ({ kind, id: x.id, label: x.name ?? 'Unknown', sub: x.email }));
				break;
		}
		if (q) list = list.filter((c) => matches(c.label, q) || matches(c.sub, q));
		return list.slice(0, activeKind ? PER_KIND * 3 : PER_KIND);
	}
	const cands = $derived.by<Cand[]>(() => {
		const q = query.trim().toLowerCase();
		const kinds = activeKind ? [activeKind] : MENTION_KINDS;
		return kinds.flatMap((k) => kindCands(k, q));
	});
	const createKinds = $derived.by<MentionKind[]>(() => {
		const q = query.trim();
		if (!q) return [];
		const kinds = activeKind ? [activeKind] : (['task', 'location', 'file'] as MentionKind[]);
		return kinds.filter((k) => {
			if (k === 'project' || k === 'person') return false;
			if ((k === 'location' || k === 'file') && !canEditProject) return false;
			return !cands.some((c) => c.kind === k && c.label.toLowerCase() === q.toLowerCase());
		});
	});
	const entries = $derived.by<Entry[]>(() => [
		...cands.map((c) => ({ type: 'cand', cand: c }) as Entry),
		...createKinds.map((k) => ({ type: 'create', kind: k }) as Entry)
	]);
	$effect(() => {
		if (activeIndex >= entries.length) activeIndex = Math.max(0, entries.length - 1);
	});

	// ---- caret + "@" detection ----
	function caretInfo(): { node: Text; offset: number } | null {
		const sel = window.getSelection();
		if (!sel || sel.rangeCount === 0) return null;
		const node = sel.anchorNode;
		if (!node || !editor || !editor.contains(node) || node.nodeType !== Node.TEXT_NODE) return null;
		return { node: node as Text, offset: sel.anchorOffset };
	}

	function updateCoords() {
		const sel = window.getSelection();
		if (!sel || sel.rangeCount === 0) return;
		const range = sel.getRangeAt(0).cloneRange();
		range.collapse(true);
		let rect = range.getBoundingClientRect();
		if (rect.top === 0 && rect.left === 0 && editor) rect = editor.getBoundingClientRect();
		coords = { top: rect.top, left: rect.left, height: rect.height || 18 };
	}

	async function detect() {
		const info = caretInfo();
		if (!info) {
			if (open) closeMenu();
			return;
		}
		const before = (info.node.textContent ?? '').slice(0, info.offset);
		const hit = detectQuery(before, before.length);
		if (hit) {
			const wasOpen = open;
			query = hit.query;
			anchorNode = info.node;
			anchorStart = hit.start;
			open = true;
			if (!wasOpen) activeIndex = 0;
			await tick();
			updateCoords();
		} else if (open) {
			closeMenu();
		}
	}

	function onInput() {
		if (!editor) return;
		const v = serialize(editor);
		lastValue = v;
		value = v;
		void detect();
	}

	function closeMenu() {
		open = false;
		query = '';
		activeKind = null;
		activeIndex = 0;
		anchorNode = null;
	}

	function insert(cand: Cand) {
		const node = anchorNode;
		if (!node || !node.parentNode) {
			closeMenu();
			return;
		}
		const text = node.textContent ?? '';
		let end = anchorStart + 1;
		while (end < text.length && !/\s/.test(text[end]) && text[end] !== '@') end++;
		const before = text.slice(0, anchorStart);
		const after = text.slice(end);
		const parent = node.parentNode;
		const pill = makePill(cand);
		const afterNode = document.createTextNode(' ' + after);
		const beforeNode = document.createTextNode(before);
		parent.replaceChild(afterNode, node);
		parent.insertBefore(pill, afterNode);
		parent.insertBefore(beforeNode, pill);
		const sel = window.getSelection();
		const range = document.createRange();
		range.setStart(afterNode, 1); // just past the inserted space
		range.collapse(true);
		sel?.removeAllRanges();
		sel?.addRange(range);
		closeMenu();
		onInput();
		editor?.focus();
	}

	async function createTask(title: string) {
		if (!projectId) return;
		busy = true;
		try {
			const res = await fetch('/api/tasks', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ projectId, title })
			});
			if (!res.ok) return;
			const { task } = await res.json();
			insert({ kind: 'task', id: task.id, label: task.title });
			void invalidateAll();
		} finally {
			busy = false;
		}
	}

	async function createLocation(title: string) {
		if (!projectId) return;
		busy = true;
		try {
			const res = await fetch(`/api/projects/${projectId}/locations`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ title })
			});
			if (!res.ok) return;
			const { location } = await res.json();
			insert({ kind: 'location', id: location.id, label: location.title });
			void invalidateAll();
		} finally {
			busy = false;
		}
	}

	function startUpload() {
		fileInput?.click();
	}
	async function onFileChosen(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file || !projectId) return;
		busy = true;
		try {
			const fd = new FormData();
			fd.append('file', file);
			const res = await fetch(`/api/projects/${projectId}/files`, { method: 'POST', body: fd });
			if (!res.ok) return;
			const { file: f } = await res.json();
			insert({ kind: 'file', id: f.id, label: f.filename });
			void invalidateAll();
		} finally {
			busy = false;
		}
	}

	function runCreate(kind: MentionKind) {
		const q = query.trim();
		if (kind === 'task') void createTask(q);
		else if (kind === 'location') void createLocation(q);
		else if (kind === 'file') startUpload();
	}

	function choose() {
		const entry = entries[activeIndex];
		if (!entry) return;
		if (entry.type === 'cand') insert(entry.cand);
		else runCreate(entry.kind);
	}

	function insertNewline() {
		const sel = window.getSelection();
		if (!sel || sel.rangeCount === 0) return;
		const range = sel.getRangeAt(0);
		range.deleteContents();
		const nl = document.createTextNode('\n');
		range.insertNode(nl);
		range.setStartAfter(nl);
		range.collapse(true);
		sel.removeAllRanges();
		sel.addRange(range);
		onInput();
	}

	function handleKeydown(e: KeyboardEvent & { currentTarget: HTMLElement }) {
		if (open) {
			if (e.key === 'Escape') {
				e.preventDefault();
				e.stopPropagation();
				closeMenu();
				return;
			}
			if (e.key === 'ArrowDown') {
				e.preventDefault();
				if (entries.length) activeIndex = (activeIndex + 1) % entries.length;
				return;
			}
			if (e.key === 'ArrowUp') {
				e.preventDefault();
				if (entries.length) activeIndex = (activeIndex - 1 + entries.length) % entries.length;
				return;
			}
			if ((e.key === 'Enter' && !e.metaKey && !e.ctrlKey) || e.key === 'Tab') {
				if (entries.length) {
					e.preventDefault();
					choose();
					return;
				}
			}
			// Cmd/Ctrl+Enter and others fall through to the host
		}
		if (e.key === 'Enter' && !open && !e.metaKey && !e.ctrlKey) {
			// keep newlines as '\n' text (not browser <div>/<br>) so serialization is stable
			e.preventDefault();
			insertNewline();
			return;
		}
		onkeydown?.(e);
	}

	function handleBlur(e: FocusEvent & { currentTarget: HTMLElement }) {
		if (open) return; // don't auto-save while the picker is open
		onblur?.(e);
	}

	function onPaste(e: ClipboardEvent) {
		e.preventDefault();
		const text = e.clipboardData?.getData('text/plain') ?? '';
		const sel = window.getSelection();
		if (!sel || sel.rangeCount === 0) return;
		const range = sel.getRangeAt(0);
		range.deleteContents();
		const node = document.createTextNode(text);
		range.insertNode(node);
		range.setStartAfter(node);
		range.collapse(true);
		sel.removeAllRanges();
		sel.addRange(range);
		onInput();
	}

	// pills are clickable: task → open the pane, project/file → open in a new tab
	function onEditorClick(e: MouseEvent) {
		const pill = (e.target as HTMLElement).closest?.('.cm-pill') as HTMLElement | null;
		if (!pill) return;
		const kind = pill.dataset.kind as MentionKind | undefined;
		const refId = pill.dataset.refid;
		if (!kind || !refId) return;
		if (kind === 'task' && onSelectTask) {
			e.preventDefault();
			onSelectTask(refId);
		} else if (kind === 'project') {
			e.preventDefault();
			window.open(`/projects/${refId}`, '_blank', 'noopener');
		} else if (kind === 'file') {
			e.preventDefault();
			window.open(`/api/files/${refId}`, '_blank', 'noopener');
		}
	}

	function onWindowClick(e: MouseEvent) {
		if (!open) return;
		const target = e.target as Node;
		if (menuEl?.contains(target) || editor?.contains(target)) return;
		closeMenu();
	}

	function setKind(k: MentionKind | null) {
		activeKind = k;
		activeIndex = 0;
		editor?.focus();
	}

	function floatMenu(node: HTMLElement, c: { top: number; left: number; height: number } | null) {
		document.body.appendChild(node);
		let cur = c;
		const place = () => {
			if (!cur) return;
			const pw = node.offsetWidth;
			const ph = node.offsetHeight;
			const vw = window.innerWidth;
			const vh = window.innerHeight;
			let top = cur.top + cur.height + 4;
			if (top + ph > vh - 8 && cur.top - ph - 4 > 8) top = cur.top - ph - 4;
			const left = Math.max(8, Math.min(cur.left, vw - pw - 8));
			node.style.top = `${Math.max(8, top)}px`;
			node.style.left = `${left}px`;
		};
		place();
		window.addEventListener('scroll', place, true);
		window.addEventListener('resize', place);
		return {
			update(next: { top: number; left: number; height: number } | null) {
				cur = next;
				place();
			},
			destroy() {
				window.removeEventListener('scroll', place, true);
				window.removeEventListener('resize', place);
				node.remove();
			}
		};
	}
</script>

<svelte:window onclick={onWindowClick} />

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
	bind:this={editor}
	{id}
	class="cm {klass}"
	class:cm-empty={!value}
	contenteditable={!disabled}
	role="textbox"
	tabindex="0"
	aria-multiline="true"
	aria-label={ariaLabel}
	data-placeholder={placeholder}
	style="min-height: {rows * 1.5}em"
	oninput={onInput}
	onkeydown={handleKeydown}
	onblur={handleBlur}
	onpaste={onPaste}
	onclick={onEditorClick}
></div>

{#if name}<input type="hidden" {name} {value} />{/if}
<input
	type="file"
	bind:this={fileInput}
	onchange={onFileChosen}
	style="display:none"
	tabindex="-1"
	aria-hidden="true"
/>

{#if open && coords}
	<div class="mmenu" role="listbox" bind:this={menuEl} use:floatMenu={coords}>
		<input
			class="mmenu-search"
			placeholder={$t('Search…')}
			bind:value={query}
			onkeydown={(e) => {
				if (e.key === 'Escape') {
					e.preventDefault();
					closeMenu();
					editor?.focus();
				} else if (e.key === 'ArrowDown') {
					e.preventDefault();
					if (entries.length) activeIndex = (activeIndex + 1) % entries.length;
				} else if (e.key === 'ArrowUp') {
					e.preventDefault();
					if (entries.length) activeIndex = (activeIndex - 1 + entries.length) % entries.length;
				} else if (e.key === 'Enter') {
					e.preventDefault();
					choose();
				}
			}}
		/>
		<div class="mmenu-pills">
			<button type="button" class="pill" class:on={activeKind === null} onclick={() => setKind(null)}>
				{$t('All')}
			</button>
			{#each MENTION_KINDS as k (k)}
				<button type="button" class="pill" class:on={activeKind === k} onclick={() => setKind(k)}>
					{$t(KIND_LABEL[k])}
				</button>
			{/each}
		</div>
		<div class="mmenu-list">
			{#each entries as entry, i (entry.type === 'cand' ? entry.cand.kind + entry.cand.id : 'create-' + entry.kind)}
				{#if entry.type === 'cand'}
					<button
						type="button"
						class="opt"
						class:active={i === activeIndex}
						onpointerdown={(e) => e.preventDefault()}
						onclick={() => insert(entry.cand)}
					>
						<Icon name={KIND_ICON[entry.cand.kind]} size={13} />
						<span class="opt-label">{entry.cand.label}</span>
						{#if entry.cand.sub}<span class="opt-sub">{entry.cand.sub}</span>{/if}
						<span class="opt-kind">{$t(KIND_LABEL[entry.cand.kind])}</span>
					</button>
				{:else}
					<button
						type="button"
						class="opt opt--create"
						class:active={i === activeIndex}
						disabled={busy}
						onpointerdown={(e) => e.preventDefault()}
						onclick={() => runCreate(entry.kind)}
					>
						<Icon name={entry.kind === 'file' ? 'cloud-upload' : 'plus'} size={13} />
						<span class="opt-label">
							{#if entry.kind === 'file'}
								{$t('Upload a file…')}
							{:else}
								{$t('Create {kind} "{q}"', { kind: $t(KIND_LABEL[entry.kind]), q: query.trim() })}
							{/if}
						</span>
					</button>
				{/if}
			{:else}
				<p class="mmenu-empty">{$t('No matches')}</p>
			{/each}
		</div>
	</div>
{/if}

<style>
	.cm {
		width: 100%;
		box-sizing: border-box;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		cursor: text;
	}
	.cm:focus {
		outline: none;
	}
	.cm-empty::before {
		content: attr(data-placeholder);
		color: var(--color-muted);
		pointer-events: none;
	}

	/* inline mention pill: [ kind | label ] */
	.cm :global(.cm-pill) {
		display: inline-flex;
		align-items: center;
		vertical-align: baseline;
		margin: 0 1px;
		border-radius: 5px;
		border: 1px solid var(--color-border-subtle);
		overflow: hidden;
		font-size: 0.9em;
		line-height: 1.4;
		cursor: pointer;
		user-select: none;
		-webkit-user-select: none;
		white-space: nowrap;
		max-width: 100%;
	}
	.cm :global(.cm-pill-kind) {
		padding: 0 5px;
		background: var(--color-surface-muted);
		color: var(--color-muted);
		font-size: 0.85em;
		text-transform: capitalize;
	}
	.cm :global(.cm-pill-label) {
		padding: 0 6px;
		color: var(--color-primary, #2563eb);
		background: color-mix(in srgb, var(--color-primary, #2563eb) 10%, transparent);
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.cm :global(.cm-pill:hover .cm-pill-label) {
		background: color-mix(in srgb, var(--color-primary, #2563eb) 18%, transparent);
	}

	.mmenu {
		position: fixed;
		top: 0;
		left: 0;
		z-index: 60;
		width: 300px;
		max-width: calc(100vw - 16px);
		max-height: min(340px, 60vh);
		display: flex;
		flex-direction: column;
		background: var(--color-base-100);
		border: 1px solid var(--color-base-300);
		border-radius: var(--radius-box, 0.5rem);
		box-shadow:
			0 1px 2px rgb(0 0 0 / 0.06),
			0 8px 24px rgb(0 0 0 / 0.12);
		padding: 4px;
		overflow: hidden;
	}
	.mmenu-search {
		width: 100%;
		border: none;
		border-bottom: 1px solid var(--color-border-subtle);
		background: transparent;
		padding: 6px 6px 7px;
		font-size: 13px;
		color: var(--color-fg);
	}
	.mmenu-pills {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		padding: 6px 2px;
	}
	.pill {
		border: 1px solid var(--color-border-subtle);
		background: var(--color-bg);
		color: var(--color-muted);
		border-radius: 999px;
		font-size: 11px;
		line-height: 1.3;
		padding: 2px 9px;
		cursor: pointer;
	}
	.pill.on {
		border-color: var(--color-primary, #2563eb);
		color: var(--color-primary, #2563eb);
		background: color-mix(in srgb, var(--color-primary, #2563eb) 10%, transparent);
	}
	.mmenu-list {
		overflow-y: auto;
		overscroll-behavior: contain;
	}
	.opt {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		text-align: left;
		border: none;
		background: none;
		color: var(--color-fg);
		font-size: 13px;
		padding: 6px 8px;
		border-radius: 6px;
		cursor: pointer;
	}
	.opt.active,
	.opt:hover {
		background: var(--color-surface-muted);
	}
	.opt :global(svg) {
		flex: 0 0 auto;
		color: var(--color-muted);
	}
	.opt-label {
		flex: 0 1 auto;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.opt-sub {
		flex: 1 1 auto;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--color-muted);
		font-size: 11px;
	}
	.opt-kind {
		flex: 0 0 auto;
		margin-left: auto;
		color: var(--color-muted);
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.opt--create {
		color: var(--color-primary, #2563eb);
	}
	.opt--create :global(svg) {
		color: var(--color-primary, #2563eb);
	}
	.opt--create .opt-label {
		white-space: normal;
	}
	.opt:disabled {
		opacity: 0.6;
		cursor: default;
	}
	.mmenu-empty {
		color: var(--color-muted);
		font-size: 12px;
		padding: 8px;
		margin: 0;
	}
</style>
