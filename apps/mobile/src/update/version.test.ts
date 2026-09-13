import assert from 'node:assert/strict';
import test from 'node:test';

import { compareVersions, isNewer, parseVersion } from './version';

test('parses stable and v-prefixed versions', () => {
  assert.deepEqual(parseVersion('1.3.1'), { major: 1, minor: 3, patch: 1, prerelease: [] });
  assert.deepEqual(parseVersion('v1.3.1'), { major: 1, minor: 3, patch: 1, prerelease: [] });
  assert.deepEqual(parseVersion('  v2.0.0  '), { major: 2, minor: 0, patch: 0, prerelease: [] });
  assert.deepEqual(parseVersion('0.0.0'), { major: 0, minor: 0, patch: 0, prerelease: [] });
});

test('rejects malformed input instead of coercing it', () => {
  for (const bad of ['', '1', '1.2', 'v', 'latest', '1.2.x', '1.2.3.4', '1.2.3-', 'x1.2.3']) {
    assert.equal(parseVersion(bad), null, bad);
  }
  assert.equal(compareVersions('1.2.3', 'not-a-version'), null);
  assert.equal(compareVersions('bad', '1.2.3'), null);
  assert.equal(isNewer('1.2.3', 'garbage'), false);
});

test('rejects leading zeros in core and numeric prerelease identifiers', () => {
  for (const bad of ['01.2.3', '1.02.3', '1.2.03', '00.0.0', '1.0.0-01', '1.0.0-rc.01']) {
    assert.equal(parseVersion(bad), null, bad);
  }
  // Literal zero stays valid, and a zero identifier is fine.
  assert.ok(parseVersion('0.0.0'));
  assert.deepEqual(parseVersion('1.0.0-0'), {
    major: 1,
    minor: 0,
    patch: 0,
    prerelease: [0],
  });
  assert.deepEqual(parseVersion('1.0.0-rc.0'), {
    major: 1,
    minor: 0,
    patch: 0,
    prerelease: ['rc', 0],
  });
});

test('rejects values that cannot be compared exactly', () => {
  assert.equal(parseVersion('9007199254740993.0.0'), null); // > Number.MAX_SAFE_INTEGER
  assert.equal(parseVersion('1.0.0-9007199254740993'), null);
  assert.ok(parseVersion('9007199254740991.0.0')); // MAX_SAFE_INTEGER still accepted
});

test('compares numeric identifiers in order', () => {
  assert.equal(compareVersions('1.2.3', '1.2.3'), 0);
  assert.equal(compareVersions('1.2.4', '1.2.3'), 1);
  assert.equal(compareVersions('1.3.0', '1.2.9'), 1);
  assert.equal(compareVersions('2.0.0', '1.99.99'), 1);
  assert.equal(compareVersions('1.2.3', '1.10.0'), -1);
  assert.equal(compareVersions('0.0.0', '0.0.1'), -1);
  assert.equal(isNewer('1.3.1', '1.3.2'), true);
  assert.equal(isNewer('1.3.1', '1.3.1'), false);
  assert.equal(isNewer('1.3.1', '1.2.0'), false);
});

test('ranks prerelease below its release', () => {
  assert.equal(compareVersions('1.4.0-rc.1', '1.4.0'), -1);
  assert.equal(compareVersions('1.4.0', '1.4.0-rc.1'), 1);
  assert.equal(compareVersions('1.4.0-alpha', '1.4.0-beta'), -1);
  assert.equal(compareVersions('1.4.0-rc.2', '1.4.0-rc.10'), -1);
  assert.equal(compareVersions('1.4.0-1', '1.4.0-alpha'), -1); // numeric < alphanumeric
  assert.equal(compareVersions('1.4.0-alpha', '1.4.0-alpha.1'), -1); // shorter list ranks lower
  // A newer prerelease still outranks an older release.
  assert.equal(isNewer('1.3.1', '1.4.0-rc.1'), true);
});

test('orders numeric prerelease identifiers numerically', () => {
  assert.equal(compareVersions('1.0.0-0', '1.0.0-1'), -1);
  assert.equal(compareVersions('1.0.0-2', '1.0.0-10'), -1);
  assert.equal(compareVersions('1.0.0-10', '1.0.0-9'), 1);
  assert.equal(compareVersions('1.0.0-1.2', '1.0.0-1.10'), -1);
  assert.equal(compareVersions('1.0.0-1', '1.0.0-1'), 0);
});

test('ignores build metadata for ordering', () => {
  assert.equal(compareVersions('1.2.3+aaa', '1.2.3+zzz'), 0);
  assert.equal(compareVersions('1.2.3+1', '1.2.3'), 0);
  assert.equal(isNewer('1.2.3', '1.2.3+build.7'), false);
});
