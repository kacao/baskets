<script lang="ts">
	// Render plain text that may contain bare URLs (auto-linked, Notion/Linear-style)
	// and "@" reference tokens (interactive chips). NEVER uses {@html} — links/chips
	// are real Svelte elements, labels are interpolated (no stored-XSS); auto-linked
	// hrefs are restricted to http(s)/mailto. Dangling references degrade to a muted,
	// non-interactive label.
	import { parseMentions, linkify, type MentionKind } from '$lib/mentions';
	import Icon from '$lib/components/Icon.svelte';
	import { tooltip } from '$lib/tooltip';

	let {
		text,
		tasks = [],
		locations = [],
		files = [],
		projects = [],
		people = [],
		onSelectTask,
		class: klass = ''
	}: {
		text: string | null | undefined;
		tasks?: { id: string; title: string }[];
		locations?: { id: string; title: string; address?: string | null }[];
		files?: { id: string; filename: string; mimeType?: string }[];
		projects?: { id: string; name: string }[];
		people?: { id: string; name: string | null; email?: string | null }[];
		onSelectTask?: (id: string) => void;
		class?: string;
	} = $props();

	const segs = $derived(parseMentions(text ?? ''));

	const ICONS: Record<MentionKind, string> = {
		task: 'task-list',
		location: 'map-pin',
		file: 'page',
		project: 'folder',
		person: 'user'
	};

	function resolve(kind: MentionKind, id: string): { label: string | null; sub?: string | null } {
		switch (kind) {
			case 'task':
				return { label: tasks.find((x) => x.id === id)?.title ?? null };
			case 'location': {
				const l = locations.find((x) => x.id === id);
				return { label: l?.title ?? null, sub: l?.address };
			}
			case 'file':
				return { label: files.find((x) => x.id === id)?.filename ?? null };
			case 'project':
				return { label: projects.find((x) => x.id === id)?.name ?? null };
			case 'person': {
				const u = people.find((x) => x.id === id);
				return { label: u?.name ?? null, sub: u?.email };
			}
		}
	}
</script>

<span class="rich {klass}"
	>{#each segs as s, i (i)}{#if s.type === 'text'}{#each linkify(s.text) as p, j (j)}{#if p.type === 'link'}<a
					class="rt-link"
					href={p.href}
					target="_blank"
					rel="noopener noreferrer">{p.text}</a
				>{:else}<span class="rt-text">{p.text}</span>{/if}{/each}{:else}{@const r =
				resolve(s.kind, s.id)}{@const label = r.label ?? s.label}{@const missing =
				r.label == null}{#if s.kind === 'task' && onSelectTask && !missing}<button
					type="button"
					class="mention"
					use:tooltip={r.sub || undefined}
					onclick={() => onSelectTask?.(s.id)}><Icon name={ICONS.task} size={11} />{label}</button
				>{:else if s.kind === 'file' && !missing}<a
					class="mention"
					href="/api/files/{s.id}"
					target="_blank"
					rel="noopener"><Icon name={ICONS.file} size={11} />{label}</a
				>{:else if s.kind === 'project' && !missing}<a class="mention" href="/projects/{s.id}"
					><Icon name={ICONS.project} size={11} />{label}</a
				>{:else}<span class="mention" class:missing use:tooltip={r.sub || undefined}
					><Icon name={ICONS[s.kind]} size={11} />{label}</span
				>{/if}{/if}{/each}</span
>

<style>
	.rich {
		overflow-wrap: anywhere;
		text-wrap: pretty;
	}
	.rt-text {
		white-space: pre-wrap;
	}
	.rt-link {
		color: var(--color-primary, #2563eb);
		text-decoration: underline;
		text-underline-offset: 2px;
		overflow-wrap: anywhere;
	}
	.rt-link:hover {
		text-decoration: none;
	}
	.mention {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		vertical-align: baseline;
		padding: 0 5px 0 4px;
		border-radius: 5px;
		border: none;
		background: color-mix(in srgb, var(--color-primary, #2563eb) 12%, transparent);
		color: var(--color-primary, #2563eb);
		font: inherit;
		font-weight: 500;
		line-height: 1.35;
		cursor: pointer;
		text-decoration: none;
		max-width: 100%;
	}
	a.mention,
	span.mention {
		cursor: pointer;
	}
	.mention :global(svg) {
		flex: 0 0 auto;
		opacity: 0.8;
	}
	.mention:hover {
		background: color-mix(in srgb, var(--color-primary, #2563eb) 20%, transparent);
	}
	.mention.missing {
		background: var(--color-surface-muted);
		color: var(--color-muted);
		cursor: default;
		text-decoration: line-through;
	}
	.mention.missing:hover {
		background: var(--color-surface-muted);
	}
	button.mention:disabled {
		cursor: default;
	}
</style>
