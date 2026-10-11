# Spotify listening album

This setup collects available listening history hourly and publishes the album with
most track plays over the rolling past seven days every three days. Repeat plays
count; ties favor the most recently played album. Spotify album IDs are kept
separate (deluxe editions are separate albums). Singles and compilations are excluded.
It counts track plays, not completed album listens or listening minutes.

## Authorize once

1. Create an app at https://developer.spotify.com/dashboard with Web API selected.
   Website: https://jeremybaum.xyz
   Redirect URI: http://127.0.0.1:8888/callback (exact spelling).
2. With Node 22+, Python 3, and authenticated GitHub CLI installed, run:
   `python3 scripts/setup-spotify.py`
3. Enter the Client ID and Client Secret at the hidden prompts. Open the printed
   Spotify URL and authorize `user-read-recently-played`. Return to the terminal.

The helper verifies access and creates these repository Actions secrets:
SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, SPOTIFY_REFRESH_TOKEN, SPOTIFY_STATE_KEY.
Secrets are sent through stdin to `gh secret set`, never printed or written to disk.
The existing encryption key is preserved when reauthorizing.

## Activate later, when ready to publish the local changes

Nothing runs before these local files are committed and pushed to main.
The hourly workflow will make future bot commits to `data/listening.json` only.

1. Review and push the website changes, scripts, workflows, data/listening.json,
   .gitignore, and docs. Do not add `.spotify-private` or any credentials.
2. In https://github.com/jormbee/jeremybaum.xyz/settings/pages set Source to
   **GitHub Actions**. The currently deployed site is not changed by this local setup.
3. Run **Update Spotify album** manually in the Actions tab with publish_now checked.
4. Confirm both **Update Spotify album** and **Deploy website** succeed.

The deployment workflow handles normal pushes and is called after Spotify publishes a changed result. This
avoids the GitHub limitation that commits using GITHUB_TOKEN do not trigger normal
push workflows or legacy Pages builds. Only public website assets are deployed.
No personal access token is needed. Main must allow the workflow token to push;
branch protections may require adjusting the update strategy.

## History, privacy, and limitations

The repo is public. The history and any rotated refresh token are AES-256-GCM
encrypted before storage in GitHub Actions cache. The encryption key is an Actions
secret. Never rotate it casually: existing cached state then cannot be decrypted.
No raw listening history is committed, uploaded as plaintext, or printed in logs.
Only featured album title, artists, Spotify link, and update time are public.

Spotify allows 50 items per page and before/after pagination. The collector pages
back through available history, merges overlapping results, and retains seven days.
Spotify may not supply the entire historical period, scheduled runs can be delayed,
and caches can be evicted. The initial week can be incomplete. This is a best-effort
favorite from observed plays, not a guaranteed complete listening audit.

Public repo schedules may be disabled after 60 days without repository activity.
Hourly collection is independent of the three-day display refresh; workflow_dispatch
can force a display refresh. No album plays yields null. The website hides the listening sentence on errors, absent data, or data older than 14 days.

Spotify development apps currently require the app owner to have Premium.
Refresh tokens expire after six months; rerun the helper when reauthorization is
needed. API/authentication failures fail the Action without overwriting the last
public result. Check GitHub Actions failure notifications for your account.

## Checks

`node --test tests/spotify.test.mjs`
`node --check script.js`

Official references:
- https://developer.spotify.com/documentation/web-api/reference/get-recently-played
- https://developer.spotify.com/documentation/web-api/concepts/redirect_uri
- https://developer.spotify.com/documentation/web-api/tutorials/refreshing-tokens

## Local preview with your actual Spotify data

Run `python3 scripts/setup-spotify.py --local-test` from this repository.
Enter the hidden Client ID and Client Secret, open the authorization URL, and approve.
Then open http://127.0.0.1:8765. Use `--port 8766` if that preview port is occupied.
The OAuth callback is still http://127.0.0.1:8888/callback.

This mode does not require GitHub CLI, change GitHub secrets, write credentials or
history to disk, or change data/listening.json. The selected album is served from
memory over the existing website, using the same collector and ranking as the Action.
Only public website assets are served; .git, scripts, and encrypted state are blocked.
Ctrl+C stops the preview. Each new local test requires authorization again.
The first preview uses available recent Spotify history, so a full week's history
is not guaranteed. To save secrets as well, rerun without --local-test.
