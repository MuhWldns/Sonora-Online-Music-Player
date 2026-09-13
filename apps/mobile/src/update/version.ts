/**
 * Strict stable-semver parse/compare for the update check. Pure, dependency-free.
 *
 * `releases/latest` never returns drafts or prereleases, but a malformed or
 * unexpected `tag_name` must never crash the app or trigger a false prompt:
 * every failure path returns null/false and the caller stays silent.
 *
 * Strictness beyond the semver grammar is deliberate: leading zeros in core or
 * numeric prerelease identifiers, and any value outside the safe-integer range,
 * are rejected so two versions can always be compared exactly.
 */

/** Numeric prerelease identifiers are stored as numbers, others as strings. */
export type PrereleaseIdentifier = number | string;

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  /** Empty for a release; identifiers for a prerelease (e.g. `rc.1`). */
  prerelease: PrereleaseIdentifier[];
}

// v?MAJOR.MINOR.PATCH with optional -prerelease and +build. Build metadata is
// captured but intentionally ignored for ordering (semver rule 10).
const SEMVER_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

/** Non-negative decimal integer with no leading zeros, exactly representable. */
function parseNumericId(raw: string): number | null {
  if (raw.length === 0) return null;
  if (raw.length > 1 && raw.startsWith('0')) return null; // 01, 00 — not semver
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

/** Parse `v?MAJOR.MINOR.PATCH[-pre][+build]`; null when malformed. */
export function parseVersion(input: string): ParsedVersion | null {
  if (typeof input !== 'string') return null;
  const match = SEMVER_RE.exec(input.trim());
  if (!match) return null;
  const [, majorRaw, minorRaw, patchRaw, preRaw] = match;

  const major = parseNumericId(majorRaw);
  const minor = parseNumericId(minorRaw);
  const patch = parseNumericId(patchRaw);
  if (major === null || minor === null || patch === null) return null;

  const prerelease: PrereleaseIdentifier[] = [];
  if (preRaw) {
    for (const id of preRaw.split('.')) {
      if (id.length === 0) return null;
      if (/^\d+$/.test(id)) {
        const numeric = parseNumericId(id);
        if (numeric === null) return null;
        prerelease.push(numeric);
      } else {
        prerelease.push(id);
      }
    }
  }
  return { major, minor, patch, prerelease };
}

function compareIdentifier(
  a: PrereleaseIdentifier,
  b: PrereleaseIdentifier,
): -1 | 0 | 1 {
  const aNumeric = typeof a === 'number';
  const bNumeric = typeof b === 'number';
  if (aNumeric && bNumeric) return a === b ? 0 : a > b ? 1 : -1;
  if (aNumeric) return -1; // numeric identifiers rank below alphanumeric
  if (bNumeric) return 1;
  return a === b ? 0 : a > b ? 1 : -1;
}

function comparePrerelease(
  a: PrereleaseIdentifier[],
  b: PrereleaseIdentifier[],
): -1 | 0 | 1 {
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1; // release outranks prerelease
  if (b.length === 0) return -1;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    const result = compareIdentifier(a[i], b[i]);
    if (result !== 0) return result;
  }
  if (a.length === b.length) return 0;
  return a.length > b.length ? 1 : -1;
}

/** -1 | 0 | 1, or null when either side is malformed (caller must stay silent). */
export function compareVersions(a: string, b: string): -1 | 0 | 1 | null {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return null;
  if (pa.major !== pb.major) return pa.major > pb.major ? 1 : -1;
  if (pa.minor !== pb.minor) return pa.minor > pb.minor ? 1 : -1;
  if (pa.patch !== pb.patch) return pa.patch > pb.patch ? 1 : -1;
  return comparePrerelease(pa.prerelease, pb.prerelease);
}

/** True only when `remote` is a strictly newer, well-formed version. */
export function isNewer(installed: string, remote: string): boolean {
  return compareVersions(remote, installed) === 1;
}
