import { BotGuardClient } from 'bgutils-js/botguard';
import type { WebPoSignalOutput } from 'bgutils-js/shared-types';
import { buildURL, getHeaders, parseLooseJSON, USER_AGENT } from 'bgutils-js/utils';
import { WebPoMinter } from 'bgutils-js/webpo';
import { JSDOM } from 'jsdom';

import { CachedPoTokenProvider, type PoTokenProvider } from '../src/po-token.js';

const REQUEST_KEY = 'O43z0dpjhgX20SCx4KAo';
const TOKEN_TTL_MS = 5 * 60_000;

interface MinterState {
  minter: WebPoMinter;
  refreshAt: number;
  botGuard: BotGuardClient;
}

let minterState: MinterState | null = null;
let minterPending: Promise<MinterState> | null = null;

async function createMinter(): Promise<MinterState> {
  const dom = new JSDOM(' ', {
    url: 'https://www.youtube.com',
    referrer: 'https://www.youtube.com/',
    userAgent: USER_AGENT,
  });
  // BotGuard probes canvas entropy. JSDOM intentionally leaves getContext()
  // unimplemented unless the native `canvas` addon is installed; the VPS image
  // is Alpine and must stay free of native build dependencies. A deterministic
  // empty context is sufficient for the integrity VM and mirrors unsupported
  // browser canvas features without throwing.
  dom.window.HTMLCanvasElement.prototype.getContext = (() => ({})) as never;

  const pageResponse = await fetch('https://www.youtube.com', {
    headers: {
      accept: '*/*',
      'accept-language': 'en-US,en;q=0.7',
      'user-agent': USER_AGENT,
    },
  });
  if (!pageResponse.ok) throw new Error(`BotGuard page ${pageResponse.status}`);
  const pageHtml = await pageResponse.text();

  const ytConfig = pageHtml.match(/ytcfg\.set\(({.+?})\);/s)?.[1];
  if (!ytConfig) throw new Error('BotGuard ytcfg missing');
  (dom.window as unknown as { yt: { config_: unknown } }).yt = { config_: JSON.parse(ytConfig) };

  Object.assign(globalThis, {
    yt: (dom.window as unknown as { yt: unknown }).yt,
    window: dom.window,
    document: dom.window.document,
    location: dom.window.location,
    origin: dom.window.origin,
  });
  if (!('navigator' in globalThis)) {
    Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator });
  }

  const rawAttestation = pageHtml.match(/window\.ytAtN\(\s*({[\s\S]*?})\s*\)/)?.[1];
  if (!rawAttestation) throw new Error('BotGuard challenge missing');
  const parsed = parseLooseJSON(rawAttestation) as {
    R?: {
      bgChallenge?: {
        interpreterUrl?: { privateDoNotAccessOrElseTrustedResourceUrlWrappedValue?: string };
        program?: string;
        globalName?: string;
      };
    };
  };
  const challenge = parsed.R?.bgChallenge;
  const interpreterUrl = challenge?.interpreterUrl?.privateDoNotAccessOrElseTrustedResourceUrlWrappedValue;
  if (!challenge?.program || !challenge.globalName || !interpreterUrl)
    throw new Error('BotGuard challenge incomplete');

  const scriptResponse = await fetch(interpreterUrl.startsWith('//') ? `https:${interpreterUrl}` : interpreterUrl);
  if (!scriptResponse.ok) throw new Error(`BotGuard interpreter ${scriptResponse.status}`);
  new Function(await scriptResponse.text())();

  const botGuard = await BotGuardClient.create({
    program: challenge.program,
    globalName: challenge.globalName,
    globalObject: globalThis,
  });
  const webPoSignalOutput: WebPoSignalOutput = [];
  const botGuardResponse = await botGuard.snapshot({ webPoSignalOutput });
  const integrityResponse = await fetch(buildURL('GenerateIT', true), {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify([REQUEST_KEY, botGuardResponse]),
  });
  if (!integrityResponse.ok) throw new Error(`BotGuard integrity ${integrityResponse.status}`);
  const [integrityToken, estimatedTtlSecs, mintRefreshThreshold, websafeFallbackToken] =
    (await integrityResponse.json()) as [string, number, number, string];
  if (!integrityToken) throw new Error('BotGuard integrity token missing');

  const minter = await WebPoMinter.create(
    { integrityToken, estimatedTtlSecs, mintRefreshThreshold, websafeFallbackToken },
    webPoSignalOutput,
  );
  const refreshSecs = Math.max(60, mintRefreshThreshold || estimatedTtlSecs || 300);
  return { minter, botGuard, refreshAt: Date.now() + refreshSecs * 1000 };
}

async function getMinter(): Promise<WebPoMinter> {
  if (minterState && minterState.refreshAt > Date.now()) return minterState.minter;
  if (!minterPending) {
    minterPending = createMinter()
      .then(async (next) => {
        const previous = minterState;
        minterState = next;
        if (previous) await previous.botGuard.shutdown().catch(() => {});
        return next;
      })
      .finally(() => { minterPending = null; });
  }
  return (await minterPending).minter;
}

export function createNodePoTokenProvider(): PoTokenProvider {
  return new CachedPoTokenProvider(async (videoId) => {
    const minter = await getMinter();
    return minter.mintAsWebsafeString(videoId);
  }, TOKEN_TTL_MS);
}
