// Receives an access token over stdin; emits only the featured album, never history.
import { collectRecent, mergePlays, favoriteAlbum } from './sync-spotify.mjs';
try {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  const { accessToken } = JSON.parse(input);
  if (!accessToken) throw new Error('Missing Spotify access token.');
  const now = Date.now();
  const items = await collectRecent(accessToken, now - 7 * 86400000);
  const selected = favoriteAlbum(mergePlays([], items, now));
  const album = selected && { name: selected.name, artists: selected.artists, url: selected.url };
  process.stdout.write(JSON.stringify({ album, updatedAt: new Date(now).toISOString() }));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
