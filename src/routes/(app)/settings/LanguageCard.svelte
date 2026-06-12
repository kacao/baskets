<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { LOCALES, locale, t, type Locale } from '$lib/i18n';

	async function setLocale(code: Locale) {
		document.cookie = `locale=${code}; path=/; max-age=31536000; samesite=lax`;
		locale.set(code);
		await invalidateAll();
	}
</script>

<div class="card" style="max-width: 560px; margin-top: var(--sp-4);">
	<h4 style="margin-bottom: var(--sp-2);">{$t('Language')}</h4>
	<div class="u-flex">
		{#each LOCALES as l (l.code)}
			<button
				class="btn btn--sm"
				class:btn--primary={$locale === l.code}
				onclick={() => setLocale(l.code)}
			>
				{l.label}
			</button>
		{/each}
	</div>
</div>
