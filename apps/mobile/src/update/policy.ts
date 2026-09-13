/**
 * Pure update policy: GitHub release normalization, URL safety, and the
 * suppress/prompt decision. No React Native imports, so it is unit-testable
 * under plain node and carries no device state of its own.
 */
import { isNewer, parseVersion } from './version';

export interface ReleaseInfo {
  /** tag_name without the leading `v`. */
  version: string;
  tag: string;
  /** Validated https://github.com/<REPO>/releases/... page URL. */
  pageUrl: string;
}

export type DismissMode = 'snooze' | 'skip';

export interface Dismissed {
  version: string;
  mode: DismissMode;
  at: number;
}

export const REPO = 'MuhWldns/Sonora-Online-Music-Player';
export const SNOOZE_MS = 3 * 24 * 60 * 60 * 1000;

/** Only the release pages of this exact repo, over https. */
export function isAllowedReleaseUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === 'https:' &&
      parsed.host === 'github.com' &&
      parsed.pathname.startsWith(`/${REPO}/releases/`)
    );
  } catch {
    return false;
  }
}

/** GitHub `releases/latest` payload → ReleaseInfo, or null when unusable.
 * Only the fields the prompt needs are kept; the release body is deliberately
 * discarded and shown on the official page instead. */
export function normalizeRelease(raw: unknown): ReleaseInfo | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r.draft === true || r.prerelease === true) return null;
  const tag = typeof r.tag_name === 'string' ? r.tag_name : '';
  const pageUrl = typeof r.html_url === 'string' ? r.html_url : '';
  if (!parseVersion(tag) || !isAllowedReleaseUrl(pageUrl)) return null;
  return { version: tag.replace(/^v/i, ''), tag, pageUrl };
}

/** True when this exact version should stay hidden right now. */
export function isSuppressed(
  dismissed: Dismissed | null,
  version: string,
  now: number,
): boolean {
  if (!dismissed || dismissed.version !== version) return false;
  if (dismissed.mode === 'skip') return true;
  return now < dismissed.at + SNOOZE_MS;
}

export type Decision = 'prompt' | 'available-hidden' | 'up-to-date' | 'unknown';

/** What the gate should show, given the installed version and remote release. */
export function decide(args: {
  installed: string;
  release: ReleaseInfo | null;
  dismissed: Dismissed | null;
  promptShownThisSession: boolean;
  now: number;
}): Decision {
  const { installed, release, dismissed, promptShownThisSession, now } = args;
  if (!release) return 'unknown';
  if (!isNewer(installed, release.version)) return 'up-to-date';
  if (isSuppressed(dismissed, release.version, now)) return 'available-hidden';
  if (promptShownThisSession) return 'available-hidden';
  return 'prompt';
}
