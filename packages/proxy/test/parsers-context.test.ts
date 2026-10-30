import assert from 'node:assert/strict';
import test from 'node:test';

import {
  extractContinuation,
  parseEntityHeader,
  parseArtistPageShelves,
  parseListItem,
} from '../src/parsers.js';

const listItem = (overrides: Record<string, unknown> = {}) => ({
  playlistItemData: { videoId: 'abcdefghijk' },
  flexColumns: [
    { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'Song A' }] } } },
    { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'Artist A' }] } } },
  ],
  ...overrides,
});

test('parseListItem reads setVideoId from the renderer level', () => {
  const item = parseListItem(listItem({ setVideoId: 'AE-renderer-1' }) as never);
  assert.equal(item?.videoId, 'abcdefghijk');
  assert.equal(item?.setVideoId, 'AE-renderer-1');
});

test('parseListItem falls back to setVideoId inside playlistItemData', () => {
  const item = parseListItem(
    listItem({ playlistItemData: { videoId: 'abcdefghijk', setVideoId: 'AE-nested-2' } }) as never,
  );
  assert.equal(item?.setVideoId, 'AE-nested-2');
});

test('parseListItem omits setVideoId when no renderer or item-level value exists', () => {
  const item = parseListItem(listItem() as never);
  assert.equal('setVideoId' in (item ?? {}), false);
});

test('parseListItem reads the feedback token from the item menu', () => {
  const item = parseListItem(
    listItem({
      menu: {
        menuRenderer: {
          items: [
            { menuNavigationItemRenderer: { text: { runs: [{ text: 'Start radio' }] } } },
            {
              menuServiceItemRenderer: {
                serviceEndpoint: { feedbackEndpoint: { token: 'ABQIA-feedback-token' } },
              },
            },
          ],
        },
      },
    }) as never,
  );
  assert.equal(item?.feedbackToken, 'ABQIA-feedback-token');
});

test('extractContinuation finds the token inside continuationItemRenderer', () => {
  assert.equal(
    extractContinuation({
      contents: [{ musicResponsiveListItemRenderer: { playlistItemData: { videoId: 'abcdefghijk' } } }],
      continuationItemRenderer: {
        continuationEndpoint: { continuationCommand: { token: 'cont-page-2' } },
      },
    }),
    'cont-page-2',
  );
});

test('extractContinuation finds the token inside musicShelfContinuation', () => {
  assert.equal(
    extractContinuation({
      musicShelfRenderer: {
        contents: [{ musicShelfContinuation: { token: 'shelf-page-2' } }],
      },
    }),
    'shelf-page-2',
  );
});

test('extractContinuation returns undefined when no token exists', () => {
  assert.equal(extractContinuation({ contents: [{ musicShelfRenderer: { contents: [] } }] }), undefined);
});

test('parseEntityHeader reads album title, subtitle, thumbnail and backing playlist id', () => {
  const header = parseEntityHeader({
    contents: {
      twoColumnBrowseResultsRenderer: {
        header: {
          musicDetailHeaderRenderer: {
            title: { runs: [{ text: 'Album Test' }] },
            subtitle: { runs: [{ text: 'Artist X' }, { text: ' • ' }, { text: '2020' }] },
            thumbnail: {
              musicThumbnailRenderer: {
                thumbnail: { thumbnails: [{ url: 'https://example.com/album-w120.jpg', width: 120 }] },
              },
            },
            buttons: [
              {
                musicPlayButtonRenderer: {
                  playNavigationEndpoint: { watchEndpoint: { playlistId: 'OLAK5uy_kKk_test' } },
                },
              },
            ],
          },
        },
      },
    },
  });

  assert.deepEqual(header, {
    title: 'Album Test',
    subtitle: 'Artist X • 2020',
    thumbnail: 'https://example.com/album-w120.jpg',
    playlistId: 'OLAK5uy_kKk_test',
  });
});

test('parseEntityHeader returns undefined when no known header renderer exists', () => {
  assert.equal(parseEntityHeader({ contents: { sectionListRenderer: { contents: [] } } }), undefined);
});

const artistPage = (overrides: Record<string, unknown> = {}) => ({
  contents: {
    sectionListRenderer: {
      contents: [
        {
          musicShelfRenderer: {
            title: { runs: [{ text: 'Songs' }] },
            contents: [
              {
                musicResponsiveListItemRenderer: {
                  playlistItemData: { videoId: 'abcdefghijk' },
                  flexColumns: [
                    { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'Song 1' }] } } },
                  ],
                },
              },
            ],
            moreContentButton: {
              buttonRenderer: { navigationEndpoint: { watchPlaylistEndpoint: { playlistId: 'PLsongs-all' } } },
            },
          },
        },
        {
          musicCarouselShelfRenderer: {
            header: { musicCarouselShelfBasicHeaderRenderer: { title: { runs: [{ text: 'Albums' }] } } },
            contents: [
              {
                musicTwoRowItemRenderer: {
                  navigationEndpoint: { browseEndpoint: { browseId: 'MPREalbum1' } },
                  title: { runs: [{ text: 'Album 1' }] },
                  thumbnailRenderer: {
                    musicThumbnailRenderer: {
                      thumbnail: { thumbnails: [{ url: 'https://example.com/album-1.jpg', width: 200 }] },
                    },
                  },
                },
              },
            ],
            moreContentButton: {
              buttonRenderer: {
                navigationEndpoint: { browseEndpoint: { browseId: 'UCartist1', params: 'ggMCIgI%3D' } },
              },
            },
          },
        },
      ],
    },
  },
  ...overrides,
});

test('parseArtistPageShelves pairs shelf More links and picks the first songs shelf playlist', () => {
  const shelves = parseArtistPageShelves(artistPage());

  assert.equal(shelves.sections.length, 2);
  assert.equal(shelves.sections[0]?.title, 'Songs');
  assert.deepEqual(shelves.sections[0]?.more, { playlistId: 'PLsongs-all' });
  assert.equal(shelves.sections[1]?.title, 'Albums');
  assert.deepEqual(shelves.sections[1]?.more, { browseId: 'UCartist1', params: 'ggMCIgI%3D' });
  assert.equal(shelves.songsPlaylistId, 'PLsongs-all');
  assert.equal(shelves.songsContinuation, undefined);
});

test('parseArtistPageShelves falls back to the response continuation without a songs playlist link', () => {
  const page = artistPage({
    contents: {
      sectionListRenderer: {
        contents: [
          {
            musicShelfRenderer: {
              title: { runs: [{ text: 'Songs' }] },
              contents: [
                {
                  musicResponsiveListItemRenderer: {
                    playlistItemData: { videoId: 'bcdefghijkl' },
                    flexColumns: [
                      { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'Song 2' }] } } },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    },
    continuationItemRenderer: { endpoint: { continuationCommand: { token: 'songs-page-2' } } },
  });

  const shelves = parseArtistPageShelves(page);
  assert.equal(shelves.songsPlaylistId, undefined);
  assert.equal(shelves.songsContinuation, 'songs-page-2');
});
