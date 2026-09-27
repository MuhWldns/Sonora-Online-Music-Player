import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeBrowseId } from '../src/index.js';
import { endpointInfo } from '../src/parsers.js';

test('normalizeBrowseId prefixes PL and RD and OLAK playlists with VL', () => {
  assert.equal(normalizeBrowseId('PL12345'), 'VLPL12345');
  assert.equal(normalizeBrowseId('RDAMVMabc123'), 'VLRDAMVMabc123');
  assert.equal(normalizeBrowseId('RDTMAKdef456'), 'VLRDTMAKdef456');
  assert.equal(normalizeBrowseId('RDAMPLghi789'), 'VLRDAMPLghi789');
  assert.equal(normalizeBrowseId('RDCLAKjkl012'), 'VLRDCLAKjkl012');
  assert.equal(normalizeBrowseId('OLAK5uy_test'), 'VLOLAK5uy_test');
});

test('normalizeBrowseId does not duplicate VL prefix if already present', () => {
  assert.equal(normalizeBrowseId('VLPL12345'), 'VLPL12345');
  assert.equal(normalizeBrowseId('VLRDAMVMabc123'), 'VLRDAMVMabc123');
  assert.equal(normalizeBrowseId('VLOLAK5uy_test'), 'VLOLAK5uy_test');
});

test('normalizeBrowseId leaves non-playlist browseIds unchanged', () => {
  assert.equal(normalizeBrowseId('MPREb_album'), 'MPREb_album');
  assert.equal(normalizeBrowseId('UC1234567890'), 'UC1234567890');
});

test('endpointInfo categorizes RD browseId as playlist', () => {
  assert.deepEqual(endpointInfo({ browseEndpoint: { browseId: 'RDTMAK_supermix' } }), {
    browseId: 'RDTMAK_supermix',
    browseType: 'playlist',
  });
  assert.deepEqual(endpointInfo({ browseEndpoint: { browseId: 'RDAMVM_songradio' } }), {
    browseId: 'RDAMVM_songradio',
    browseType: 'playlist',
  });
});
