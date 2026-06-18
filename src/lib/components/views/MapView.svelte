<script lang="ts">
	import { onMount } from 'svelte';
	import { t } from '$lib/i18n';

	type Task = {
		id: string;
		parentId: string | null;
		title: string;
		locationId: string | null;
		location: string | null;
	};
	type Location = { id: string; title: string; latitude: number | null; longitude: number | null };

	let { tasks, locations }: { tasks: Task[]; locations: Location[] } = $props();

	let el: HTMLDivElement;
	let map: import('leaflet').Map | null = null;
	let L: typeof import('leaflet') | null = null;
	let markerLayer: import('leaflet').LayerGroup | null = null;

	type Point = { task: Task; lat: number; lng: number };
	const points = $derived(
		tasks
			.map((t): Point | null => {
				// prefer a picked Location; fall back to the legacy freeform "lat, lng"
				const loc = t.locationId ? locations.find((l) => l.id === t.locationId) : null;
				if (loc) return { task: t, lat: loc.latitude ?? NaN, lng: loc.longitude ?? NaN };
				if (t.location) {
					const [lat, lng] = t.location.split(',').map((v) => parseFloat(v.trim()));
					return { task: t, lat, lng };
				}
				return null;
			})
			.filter((p): p is Point => !!p && Number.isFinite(p.lat) && Number.isFinite(p.lng))
	);

	onMount(() => {
		let cancelled = false;
		(async () => {
			L = await import('leaflet');
			await import('leaflet/dist/leaflet.css');
			if (cancelled) return;

			map = L.map(el, { zoomControl: true, attributionControl: true });
			L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
				maxZoom: 19,
				attribution: '© OpenStreetMap contributors'
			}).addTo(map);
			markerLayer = L.layerGroup().addTo(map);
			renderMarkers();
		})();

		return () => {
			cancelled = true;
			map?.remove();
			map = null;
			L = null;
			markerLayer = null;
		};
	});

	function renderMarkers() {
		if (!L || !map || !markerLayer) return;
		markerLayer.clearLayers();
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
					.addTo(markerLayer)
					.bindPopup(node);
			}
		} else {
			map.setView([20, 0], 2);
		}
	}

	// rebuild markers whenever tasks/locations change after the map is ready
	$effect(() => {
		points;
		if (map) renderMarkers();
	});
</script>

{#if points.length === 0}
	<div class="alert" role="status">
		{$t('No tasks have a location yet. Pick a Location on a task to plot it here.')}
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
