import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mergePlays, favoriteAlbum, encryptState, decryptState, collectRecent } from '../scripts/sync-spotify.mjs';
const now = Date.parse('2026-10-10T12:00:00Z');
function item(id, at, album = 'a', type = 'album') {
  return { played_at: new Date(at).toISOString(), track: { id, album: { id: album, name: `Album ${album}`, album_type: type, artists: [{ name: 'Artist' }] } } };
}
test('overlapping polls deduplicate; repeat listens count; rolling week expires', () => {
  const first = mergePlays([], [item('t', now - 1000), item('t', now - 2000), item('old', now - 8 * 86400000)], now);
  assert.equal(first.length, 2);
  const merged = mergePlays(first, [item('t', now - 1000), item('new', now - 3000, 'b')], now);
  assert.equal(merged.length, 3);
  assert.equal(favoriteAlbum(merged).id, 'a');
  assert.equal(mergePlays(merged, [], now + 8 * 86400000).length, 0);
});
test('ties use recency; singles and compilations are excluded', () => {
  const plays = mergePlays([], [item('one', now - 100, 'a'), item('two', now - 50, 'b'),
    item('s1', now - 2, 's', 'single'), item('s2', now - 1, 's', 'single'), item('c', now - 3, 'c', 'compilation')], now);
  assert.equal(favoriteAlbum(plays).id, 'b');
  assert.equal(favoriteAlbum([]), null);
});
test('local tracks, missing albums and invalid timestamps are ignored', () => {
  assert.equal(mergePlays([], [{ played_at: 'bad' }, { played_at: new Date(now).toISOString(), track: { id: 'a' } }], now).length, 0);
});
test('encrypted cache round trip; tampering and wrong keys rejected', () => {
  const key = randomBytes(32).toString('base64');
  const state = { refreshToken: 'private-token', plays: [{ key: 'private-history' }] };
  const encrypted = encryptState(state, key);
  assert(!encrypted.includes('private-token'));
  assert.deepEqual(decryptState(encrypted, key), state);
  assert.throws(() => decryptState(encrypted, randomBytes(32).toString('base64')));
  const corrupted = JSON.parse(encrypted); const data = Buffer.from(corrupted.data, 'base64'); data[0] ^= 1; corrupted.data = data.toString('base64');
  assert.throws(() => decryptState(JSON.stringify(corrupted), key));
});
test('collects more than 50 tracks with decreasing before cursor', async () => {
  const calls = [];
  const fetcher = async url => {
    calls.push(new URL(url));
    return { ok: true, json: async () => ({ items: calls.length === 1
      ? Array.from({ length: 50 }, (_, i) => item(`t${i}`, now - (i + 1) * 1000))
      : [item('older', now - 51000)] }) };
  };
  const result = await collectRecent('test-token', now - 100000, fetcher);
  assert.equal(result.length, 51); assert.equal(calls.length, 2);
  assert.equal(calls[1].searchParams.get('before'), String(now - 50000));
});
test('API failures abort rather than return partial history', async () => {
  await assert.rejects(collectRecent('test', now, async () => ({ ok: false, status: 429 })), /Rate limited/);
});
test('repeated history pages abort rather than loop forever', async () => {
  const items = Array.from({ length: 50 }, (_, i) => item(`t${i}`, now - i * 1000));
  await assert.rejects(collectRecent('test', now - 100000, async () => ({ ok: true, json: async () => ({ items }) })), /stopped advancing/);
});
