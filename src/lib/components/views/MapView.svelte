<script lang="ts">
	import { onMount } from 'svelte';
	import { t } from '$lib/i18n';

	type Task = {
		id: string;
		parentId: string | null;
		title: string;
		location: string | null;
	};

	let { tasks }: { tasks: Task[] } = $props();

	let el: HTMLDivElement;
	let map: import('leaflet').Map | null = null;

	const points = $derived(
		tasks
			.filter((t) => t.location)
			.map((t) => {
				const [lat, lng] = t.location!.split(',').map((v) => parseFloat(v.trim()));
				return { task: t, lat, lng };
			})
			.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
	);

	onMount(() => {
		let cancelled = false;
		(async () => {
			const L = await import('leaflet');
			await import('leaflet/dist/leaflet.css');
			if (cancelled) return;

			map = L.map(el, { zoomControl: true, attributionControl: true });
			L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
				maxZoom: 19,
				attribution: '© OpenStreetMap contributors'
			}).addTo(map);

			if (points.length > 0) {
				const bounds = L.latLngBounds(points.map((p) => [p.lat, p.lng] as [number, number]));
				map.fitBounds(bounds.pad(0.4), { maxZoom: 12 });
				for (const p of points) {
					// bindPopup renders HTML — pass a text node so task titles can't inject markup
					const node = document.createElement('div');
					node.textContent = p.task.title;
					L.circleMarker([p.lat, p.lng], {
						radius: 7,
						color: '#0a0a0a',
						weight: 1,
						fillColor: '#0a0a0a',
						fillOpacity: 0.9
					})
						.addTo(map)
						.bindPopup(node);
				}
			} else {
				map.setView([20, 0], 2);
			}
		})();

		return () => {
			cancelled = true;
			map?.remove();
			map = null;
		};
	});
</script>

{#if points.length === 0}
	<div class="alert" role="status">
		{$t('No tasks have a location yet. Set “Location (lat, lng)” in a task’s edit form to plot it here.')}
	</div>
{/if}
<div class="map" bind:this={el}></div>

<style>
	.map {
		height: 480px;
		border: 1px solid var(--color-border-subtle);
	}

	/* Leaflet popups inherit app fonts; keep geometry flat */
	.map :global(.leaflet-popup-content-wrapper),
	.map :global(.leaflet-bar a) {
		border-radius: 0;
		box-shadow: none;
		font-family: var(--font-body);
	}
</style>
