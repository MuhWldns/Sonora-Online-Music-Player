/**
 * Update service: installed-version read, GitHub Releases fetch, AsyncStorage
 * persistence, and the 6h throttle / single-flight network policy.
 *
 * Deliberately independent of api/client.ts: the update request must never
 * carry the YouTube cookie. Failures are silent and never stamp the
 * last-success timestamp.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';

import { normalizeRelease, type Dismissed, type ReleaseInfo, REPO } from './policy';

const LAST_CHECK_KEY = '@sonora/update/last-check';
const DISMISSED_KEY = '@sonora/update/dismissed';
export const CHECK_THROTTLE_MS = 6 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8000;

export interface UpdateSnapshot {
  release: ReleaseInfo | null;
  dismissed: Dismissed | null;
}

/** Embedded app.json version; null when missing or malformed (fail closed). */
export function getInstalledVersion(): string | null {
  const version = Constants.expoConfig?.version;
  return typeof version === 'string' && version.trim().length > 0 ? version.trim() : null;
}

async function readJson<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null; // corrupt or unreadable → treat as absent
  }
}

async function writeJson(key: string, value: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Persistence is best-effort; never let storage break startup.
  }
}

export async function loadSnapshot(): Promise<UpdateSnapshot> {
  const [lastCheck, dismissed] = await Promise.all([
    readJson<{ at: number; release: ReleaseInfo | null }>(LAST_CHECK_KEY),
    readJson<Dismissed>(DISMISSED_KEY),
  ]);
  return { release: lastCheck?.release ?? null, dismissed: dismissed ?? null };
}

export async function loadLastCheckedAt(): Promise<number> {
  const lastCheck = await readJson<{ at: number }>(LAST_CHECK_KEY);
  return typeof lastCheck?.at === 'number' ? lastCheck.at : 0;
}

async function saveRelease(release: ReleaseInfo | null, now: number): Promise<void> {
  await writeJson(LAST_CHECK_KEY, { at: now, release });
}

export async function saveDismissed(dismissed: Dismissed | null): Promise<void> {
  if (dismissed) await writeJson(DISMISSED_KEY, dismissed);
  else await AsyncStorage.removeItem(DISMISSED_KEY).catch(() => {});
}

/**
 * One in-flight fetch per process. Returns the normalized release, or null on
 * any failure/offline. Only a successful fetch stamps the throttle timestamp.
 */
let inFlight: Promise<ReleaseInfo | null> | null = null;

export function fetchLatestRelease(installed: string): Promise<ReleaseInfo | null> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
        signal: controller.signal,
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': `Sonora-Music/${installed}`,
          'X-GitHub-Api-Version': '2022-11-28',
        },
      });
      if (!res.ok) return null;
      const release = normalizeRelease(await res.json());
      if (release) await saveRelease(release, Date.now());
      return release;
    } catch {
      return null; // offline, timeout, abort, bad JSON
    } finally {
      clearTimeout(timer);
      inFlight = null;
    }
  })();
  return inFlight;
}
