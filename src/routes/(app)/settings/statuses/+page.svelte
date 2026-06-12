<script lang="ts">
	import { enhance } from '$app/forms';

	let { data, form } = $props();
	let renaming = $state<string | null>(null);
</script>

<svelte:head><title>Statuses — Baskets</title></svelte:head>

<h2 style="margin-bottom: var(--sp-2);">Statuses</h2>
<p class="u-small u-muted" style="margin-bottom: var(--sp-4); max-width: 65ch;">
	App-wide statuses available to projects. Each project chooses which of these are eligible for
	its tasks (in the project’s Edit panel). The category drives behavior: “done” marks progress
	and completes sub-tasks.
</p>

{#if form?.message}
	<div class="alert alert--error" role="alert">{form.message}</div>
{/if}

<div class="card" style="max-width: 640px; margin-bottom: var(--sp-4);">
	{#each data.statuses as s (s.id)}
		<div class="row">
			{#if renaming === s.id}
				<form
					method="POST"
					action="?/rename"
					use:enhance={() =>
						({ update }) => {
							renaming = null;
							update();
						}}
					class="u-flex"
					style="flex: 1;"
				>
					<input type="hidden" name="id" value={s.id} />
					<input name="name" class="input" value={s.name} style="flex: 1;" required maxlength="40" />
					<button class="btn btn--sm btn--primary" type="submit">Save</button>
					<button class="btn btn--sm" type="button" onclick={() => (renaming = null)}>Cancel</button>
				</form>
			{:else}
				<span class="name">{s.name}</span>
				<span class="badge">{s.category}</span>
				{#if s.builtIn}
					<span class="badge">built-in</span>
				{/if}
				<span class="u-tiny u-muted">{s.inUse} task(s)</span>
				<span style="flex: 1;"></span>
				<button class="btn btn--sm" onclick={() => (renaming = s.id)}>Rename</button>
				{#if !s.builtIn}
					<form method="POST" action="?/delete" use:enhance>
						<input type="hidden" name="id" value={s.id} />
						<button class="btn btn--sm btn--danger" type="submit" disabled={s.inUse > 0}>
							Delete
						</button>
					</form>
				{/if}
			{/if}
		</div>
	{/each}
</div>

<div class="card" style="max-width: 640px;">
	<h4 style="margin-bottom: var(--sp-2);">New status</h4>
	<form method="POST" action="?/create" use:enhance class="u-flex" style="flex-wrap: wrap;">
		<input name="name" class="input" style="flex: 1; min-width: 160px;" placeholder="Status name…" required maxlength="40" />
		<select name="category" class="select" style="width: auto;">
			{#each data.categories as c (c)}
				<option value={c}>{c}</option>
			{/each}
		</select>
		<button class="btn btn--primary" type="submit">Add</button>
	</form>
</div>

<style>
	.row {
		display: flex;
		align-items: center;
		gap: var(--sp-2);
		padding: var(--sp-1) 0;
		border-bottom: 1px solid var(--color-border-subtle);
	}

	.row:last-child {
		border-bottom: none;
	}

	.name {
		font-weight: 500;
	}
</style>
