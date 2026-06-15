import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, type Plugin, type PreviewServer, type ViteDevServer } from 'vite';
import { attachRealtime } from './src/lib/server/realtime/attach.js';

// Realtime (ADR-026): attach the /ws upgrade handler to the dev and preview
// servers. Production attaches the same handler in server.js.
const realtime: Plugin = {
	name: 'baskets-realtime',
	configureServer(server: ViteDevServer) {
		attachRealtime(server.httpServer);
	},
	configurePreviewServer(server: PreviewServer) {
		attachRealtime(server.httpServer);
	}
};

export default defineConfig({
	plugins: [tailwindcss(), sveltekit(), realtime]
});
