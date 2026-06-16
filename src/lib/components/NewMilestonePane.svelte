<script lang="ts">
	import { enhance } from '$app/forms';
	import SidePane from '$lib/components/SidePane.svelte';
	import { toast } from '$lib/toast.svelte';
	import { t } from '$lib/i18n';

	let { onClose }: { onClose: () => void } = $props();

	let name = $state('');
	let startDate = $state('');
	let targetDate = $state('');
	let createMore = $state(false);
	let nameEl = $state<HTMLInputElement | null>(null);
</script>

<SidePane title={$t('New milestone')} onClose={onClose} ariaLabel={$t('New milestone')}>
	<form
		method="POST"
		action="?/createMilestone"
		use:enhance={() =>
			async ({ result, update }) => {
				if (result.type === 'success') {
					toast($t('Milestone created'));
					await update({ reset: false });
					if (createMore) {
						name = '';
						startDate = '';
						targetDate = '';
						nameEl?.focus();
					} else {
						onClose();
					}
				} else {
					await update();
				}
			}}
	>
		<div class="field">
			<label class="label" for="nm-name">{$t('Name')}</label>
			<!-- svelte-ignore a11y_autofocus -->
			<input
				bind:this={nameEl}
				id="nm-name"
				name="name"
				class="input"
				bind:value={name}
				placeholder={$t('Milestone name…')}
				required
				autocomplete="off"
				autofocus
			/>
		</div>

		<div class="field">
			<label class="label" for="nm-start">{$t('Start date')}</label>
			<input id="nm-start" name="startDate" type="date" class="input" bind:value={startDate} />
		</div>

		<div class="field">
			<label class="label" for="nm-date">{$t('Target date')}</label>
			<input id="nm-date" name="targetDate" type="date" class="input" bind:value={targetDate} />
		</div>

		<label class="more">
			<input type="checkbox" bind:checked={createMore} />
			{$t('Create more')}
		</label>

		<div class="u-flex" style="margin-top: var(--sp-3);">
			<button class="btn btn-primary" type="submit">{$t('Create')}</button>
			<button class="btn" type="button" onclick={onClose}>{$t('Cancel')}</button>
		</div>
	</form>
</SidePane>

<style>
	.field {
		margin-bottom: var(--sp-3);
	}

	.field .input {
		width: 100%;
	}

	.more {
		display: flex;
		align-items: center;
		gap: var(--sp-1);
		font-size: 13px;
		color: var(--color-fg);
		cursor: pointer;
		user-select: none;
	}
</style>
