import assert from 'node:assert/strict';
import test from 'node:test';

import { parseBrowseSections } from './parsers.js';

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
