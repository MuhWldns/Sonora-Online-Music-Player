/// <reference types="node" />

/**
 * Entry VPS / Docker — Node runtime.
 * youtubei.js platform build Node, cache in-memory.
 */
import { serve } from '@hono/node-server';

import { MemoryCache } from '../src/cache.js';
import { createApp } from '../src/index.js';
import { Innertube, Platform } from 'youtubei.js';

// youtubei.js v18 tidak membawa interpreter JS sendiri — wajib disediakan
// untuk decipher stream URL. Di Node: Function constructor.
Platform.shim.eval = async (data) => new Function(data.output)();
const app = createApp({ Innertube, cache: new MemoryCache() });


const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[yt-proxy] listening on http://0.0.0.0:${info.port}`);
});
