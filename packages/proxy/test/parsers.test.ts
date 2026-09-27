import assert from 'node:assert/strict';
import test from 'node:test';

import { parseBrowseSections, parseLyricsBrowseId, parseLyricsResponse } from '../src/parsers.js';

test('parses playlist shelf items from a nested two-column browse response', () => {
  const sections = parseBrowseSections({
    contents: {
      twoColumnBrowseResultsRenderer: {
        secondaryContents: {
          sectionListRenderer: {
            contents: [
              {
                musicPlaylistShelfRenderer: {
                  playlistId: 'PLplaylist',
                  contents: [
                    {
                      musicResponsiveListItemRenderer: {
                        playlistItemData: { videoId: 'abcdefghijk' },
                        flexColumns: [
                          { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'Song A' }] } } },
                          { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'Artist A' }] } } },
                        ],
                      },
                    },
                  ],
                },
              },
            ],
          },
        },
      },
    },
  });

  assert.equal(sections.length, 1);
  assert.equal(sections[0].items[0].videoId, 'abcdefghijk');
  assert.equal(sections[0].items[0].title, 'Song A');
});

test('finds the lyrics browse endpoint from the watch-next tabbed renderer', () => {
  assert.equal(
    parseLyricsBrowseId({
      contents: {
        watchNextTabbedResultsRenderer: {
          tabs: [
            { tabRenderer: { title: 'Related', endpoint: { browseEndpoint: { browseId: 'MPTR1', browseEndpointContextSupportedConfigs: { browseEndpointContextMusicConfig: { pageType: 'MUSIC_PAGE_TYPE_TRACK_RELATED' } } } } } },
            { tabRenderer: { title: 'Lyrics', endpoint: { browseEndpoint: { browseId: 'MPLYlyrics', browseEndpointContextSupportedConfigs: { browseEndpointContextMusicConfig: { pageType: 'MUSIC_PAGE_TYPE_TRACK_LYRICS' } } } } } },
          ],
        },
      },
    }),
    'MPLYlyrics',
  );
});

test('parses available plain lyrics and attribution without HTML or timing', () => {
  assert.deepEqual(parseLyricsResponse({
    contents: {
      musicDescriptionShelfRenderer: {
        description: { runs: [{ text: 'First line\r\nSecond line\r\n\r\nFourth line' }] },
        footer: { runs: [{ text: 'Lyrics provided by Sonora Catalog' }] },
      },
    },
  }), {
    lyrics: {
      lines: [
        { text: 'First line' },
        { text: 'Second line' },
        { text: '' },
        { text: 'Fourth line' },
      ],
      synced: false,
      source: 'Lyrics provided by Sonora Catalog',
    },
  });
});

test('returns null for an unavailable lyrics message', () => {
  assert.deepEqual(parseLyricsResponse({ contents: { messageRenderer: { text: { runs: [{ text: 'Lyrics not available' }] } } } }), { lyrics: null });
});
