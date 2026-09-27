import assert from 'node:assert/strict';
import test from 'node:test';

import type { ParsedSection } from '../../api/types';
import type { RecentlyPlayed } from '../../storage/recentlyPlayed';
import {
  buildAutomixPlaylists,
  extractMixPlaylists,
  isMixShelfTitle,
} from './mixPlaylists';

test('isMixShelfTitle matches mix keywords case-insensitively', () => {
  assert.equal(isMixShelfTitle('Mixed for you'), true);
  assert.equal(isMixShelfTitle('mixed for you'), true);
  assert.equal(isMixShelfTitle('Campuran untuk Anda'), true);
  assert.equal(isMixShelfTitle('campuran untuk anda'), true);
  assert.equal(isMixShelfTitle('My Supermix'), true);
  assert.equal(isMixShelfTitle('Chill Mix'), true);
  assert.equal(isMixShelfTitle('Energy Mix'), true);
  assert.equal(isMixShelfTitle('Quick picks'), false);
  assert.equal(isMixShelfTitle('Listen again'), false);
  assert.equal(isMixShelfTitle('Similar to Coldplay'), false);
  assert.equal(isMixShelfTitle(''), false);
});

test('extractMixPlaylists extracts playlist items from matching mix shelves and dedupes', () => {
  const sections: ParsedSection[] = [
    {
      title: 'Quick picks',
      items: [
        { type: 'song', title: 'Song 1', videoId: 'v1', thumbnail: null },
      ],
    },
    {
      title: 'Mixed for you',
      items: [
        { type: 'playlist', title: 'My Supermix', playlistId: 'RDTMAK_super', thumbnail: 'thumb1' },
        { type: 'playlist', title: 'Chill Mix', browseId: 'VLRDTMAK_chill', thumbnail: 'thumb2' },
        { type: 'song', title: 'Should be ignored', videoId: 'v2', thumbnail: null },
      ],
    },
    {
      title: 'Campuran untuk Anda',
      items: [
        // Duplicate playlistId should be deduped
        { type: 'playlist', title: 'My Supermix Dup', playlistId: 'RDTMAK_super', thumbnail: 'thumb1' },
        { type: 'playlist', title: 'Focus Mix', playlistId: 'RDTMAK_focus', thumbnail: 'thumb3' },
      ],
    },
  ];

  const result = extractMixPlaylists(sections);
  assert.equal(result.length, 3);
  assert.equal(result[0].title, 'My Supermix');
  assert.equal(result[0].playlistId, 'RDTMAK_super');
  assert.equal(result[1].title, 'Chill Mix');
  assert.equal(result[1].browseId, 'VLRDTMAK_chill');
  assert.equal(result[2].title, 'Focus Mix');
  assert.equal(result[2].playlistId, 'RDTMAK_focus');
});

test('buildAutomixPlaylists generates track automixes and artist radios from recent history', () => {
  const recent: RecentlyPlayed[] = [
    {
      videoId: 'v1',
      title: 'Fix You',
      artist: 'Coldplay',
      thumbnail: 'thumb_v1',
      playedAt: 1000,
    },
    {
      videoId: 'v2',
      title: 'Yellow',
      artist: 'Coldplay',
      thumbnail: 'thumb_v2',
      playedAt: 900,
    },
    {
      videoId: 'v3',
      title: 'Something Just Like This',
      artist: 'The Chainsmokers',
      thumbnail: 'thumb_v3',
      playedAt: 800,
    },
    // Duplicate videoId
    {
      videoId: 'v1',
      title: 'Fix You',
      artist: 'Coldplay',
      thumbnail: 'thumb_v1',
      playedAt: 700,
    },
  ];

  const result = buildAutomixPlaylists(recent);

  // 3 distinct tracks: Fix You, Yellow, Something Just Like This
  // 2 distinct artists: Coldplay, The Chainsmokers
  assert.equal(result.length, 5);

  // Check track mixes
  assert.deepEqual(result[0], {
    type: 'playlist',
    title: 'Mix Fix You',
    subtitle: 'Radio • Berdasarkan Coldplay',
    thumbnail: 'thumb_v1',
    playlistId: 'RDAMVMv1',
  });
  assert.deepEqual(result[1], {
    type: 'playlist',
    title: 'Mix Yellow',
    subtitle: 'Radio • Berdasarkan Coldplay',
    thumbnail: 'thumb_v2',
    playlistId: 'RDAMVMv2',
  });
  assert.deepEqual(result[2], {
    type: 'playlist',
    title: 'Mix Something Just Like This',
    subtitle: 'Radio • Berdasarkan The Chainsmokers',
    thumbnail: 'thumb_v3',
    playlistId: 'RDAMVMv3',
  });

  // Check artist radios
  assert.deepEqual(result[3], {
    type: 'playlist',
    title: 'Radio Coldplay',
    subtitle: 'Mix artis • Dibuat untuk Anda',
    thumbnail: 'thumb_v1',
    playlistId: 'RDAMVMv1',
  });
  assert.deepEqual(result[4], {
    type: 'playlist',
    title: 'Radio The Chainsmokers',
    subtitle: 'Mix artis • Dibuat untuk Anda',
    thumbnail: 'thumb_v3',
    playlistId: 'RDAMVMv3',
  });
});

test('buildAutomixPlaylists handles empty recent list', () => {
  assert.deepEqual(buildAutomixPlaylists([]), []);
});

test('buildAutomixPlaylists handles tracks without artist', () => {
  const recent: RecentlyPlayed[] = [
    {
      videoId: 'v_no_artist',
      title: 'Unknown Track',
      artist: '',
      thumbnail: null,
      playedAt: 500,
    },
  ];

  const result = buildAutomixPlaylists(recent);
  assert.equal(result.length, 1);
  assert.equal(result[0].title, 'Mix Unknown Track');
  assert.equal(result[0].subtitle, 'Radio');
  assert.equal(result[0].playlistId, 'RDAMVMv_no_artist');
});
