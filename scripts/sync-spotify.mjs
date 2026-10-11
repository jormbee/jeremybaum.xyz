import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

const WEEK = 7 * 86400000;
export function mergePlays(previous, items, now) {
  const unique = new Map(previous.filter(p => p.at > now - WEEK && p.at <= now).map(p => [p.key, p]));
  for (const item of items) {
    const at = Date.parse(item.played_at), track = item.track, album = track?.album;
    if (!Number.isFinite(at) || at <= now - WEEK || at > now || !track?.id || !album?.id || !album.name) continue;
    const key = `${at}:${track.id}`;
    unique.set(key, { key, at, album: { id: album.id, name: album.name,
      artists: (album.artists || []).map(a => a.name).filter(Boolean),
      type: album.album_type, url: `https://open.spotify.com/album/${encodeURIComponent(album.id)}` } });
  }
  return [...unique.values()].sort((a, b) => a.at - b.at);
}
export function favoriteAlbum(plays) {
  const counts = new Map();
  for (const play of plays) {
    // Singles and compilations should not masquerade as a favorite album.
    if (play.album.type !== 'album') continue;
    const entry = counts.get(play.album.id) || { album: play.album, count: 0, latest: 0 };
    entry.count++; entry.latest = Math.max(entry.latest, play.at); counts.set(play.album.id, entry);
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || b.latest - a.latest || a.album.id.localeCompare(b.album.id))[0]?.album || null;
}
function keyBytes(key) {
  const bytes = Buffer.from(key, 'base64');
  if (bytes.length !== 32) throw new Error('SPOTIFY_STATE_KEY must contain a base64-encoded 32-byte key.');
  return bytes;
}
export function encryptState(state, key) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', keyBytes(key), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(state)), cipher.final()]);
  return JSON.stringify({ v: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: encrypted.toString('base64') });
}
export function decryptState(text, key) {
  const envelope = JSON.parse(text);
  if (envelope.v !== 1) throw new Error('Unsupported Spotify state version.');
  const decipher = createDecipheriv('aes-256-gcm', keyBytes(key), Buffer.from(envelope.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()]).toString());
}
async function readOptional(path, fallback) {
  try { return await readFile(path, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return fallback; throw e; }
}
export async function collectRecent(token, since, fetcher = fetch) {
  const items = [];
  let before;
  for (let page = 0; page < 200; page++) {
    const url = new URL('https://api.spotify.com/v1/me/player/recently-played');
    url.searchParams.set('limit', '50');
    if (before) url.searchParams.set('before', String(before));
    const response = await fetcher(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`Spotify history request failed (${response.status}). ${response.status === 429 ? 'Rate limited; the next run will retry.' : 'Check app access and authorization.'}`);
    const body = await response.json();
    if (!Array.isArray(body.items)) throw new Error('Unexpected Spotify history response.');
    items.push(...body.items);
    if (!body.items.length) return items;
    const oldest = Math.min(...body.items.map(p => Date.parse(p.played_at)));
    if (!Number.isFinite(oldest)) throw new Error('Invalid Spotify playback timestamp.');
    if (oldest <= since || body.items.length < 50) return items;
    if (before && oldest >= before) throw new Error('Spotify history pagination stopped advancing.');
    before = oldest;
  }
  throw new Error('Spotify history exceeded the pagination limit; refusing to publish a partial update.');
}
export async function main() {
  const env = process.env;
  for (const name of ['SPOTIFY_CLIENT_ID', 'SPOTIFY_CLIENT_SECRET', 'SPOTIFY_REFRESH_TOKEN', 'SPOTIFY_STATE_KEY']) {
    if (!env[name]) throw new Error(`Missing ${name}. Run scripts/setup-spotify.py first.`);
  }
  const statePath = '.spotify-private/state.enc', publicPath = 'data/listening.json';
  const fingerprint = createHash('sha256').update(env.SPOTIFY_REFRESH_TOKEN).digest('hex');
  const encrypted = await readOptional(statePath, null);
  let state = encrypted ? decryptState(encrypted, env.SPOTIFY_STATE_KEY) : { plays: [] };
  // A newly authorized token supersedes any rotated token from the old authorization.
  const refresh = state.tokenFingerprint === fingerprint ? state.refreshToken : env.SPOTIFY_REFRESH_TOKEN;
  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST', signal: AbortSignal.timeout(30000),
    headers: { Authorization: `Basic ${Buffer.from(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refresh || env.SPOTIFY_REFRESH_TOKEN })
  });
  if (!response.ok) throw new Error(`Spotify authorization failed (${response.status}). Re-run scripts/setup-spotify.py if authorization expired.`);
  const token = await response.json();
  if (!token.access_token) throw new Error('Spotify returned no access token.');
  const now = Date.now();
  const since = Math.max(now - WEEK, (state.lastCollectedAt || now - WEEK) - 3600000);
  const items = await collectRecent(token.access_token, since);
  state = { ...state, plays: mergePlays(state.plays || [], items, now), lastCollectedAt: now,
    refreshToken: token.refresh_token || refresh || env.SPOTIFY_REFRESH_TOKEN, tokenFingerprint: fingerprint };
  await mkdir(dirname(statePath), { recursive: true });
  await writeFile(statePath, encryptState(state, env.SPOTIFY_STATE_KEY), { mode: 0o600 });
  const previous = JSON.parse(await readOptional(publicPath, '{"album":null,"updatedAt":null}'));
  const due = !previous.updatedAt || now - Date.parse(previous.updatedAt) >= 3 * 86400000 || env.FORCE_PUBLISH === 'true';
  if (due) {
    const album = favoriteAlbum(state.plays);
    // Only the featured album is public: no tracks, individual timestamps, or counts.
    const output = { album: album && { name: album.name, artists: album.artists, url: album.url }, updatedAt: new Date(now).toISOString() };
    await mkdir(dirname(publicPath), { recursive: true });
    await writeFile(publicPath, JSON.stringify(output, null, 2) + '\n');
  }
  console.log(due ? 'Collected history and refreshed the featured album.' : 'Collected history; featured album refresh is not due.');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
