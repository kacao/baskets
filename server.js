// Production server (ADR-026). adapter-node's default `build/index.js` has no
// WebSocket upgrade hook, so we run our own thin http.Server that delegates HTTP
// to the generated SvelteKit `handler` and attaches the realtime /ws transport
// to the same server. Run with `npm start` (see package.json) after `npm run build`.
import http from 'node:http';
import { handler } from './build/handler.js';
import { attachRealtime } from './src/lib/server/realtime/attach.js';

const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || '0.0.0.0';

const server = http.createServer((req, res) => {
	handler(req, res, () => {
		res.statusCode = 404;
		res.end('Not found');
	});
});

attachRealtime(server);

server.listen(port, host, () => {
	console.log(`Baskets listening on http://${host}:${port}`);
});
