![Spotify logo](https://upload.wikimedia.org/wikipedia/commons/8/84/Spotify_icon.svg)

# Spotify MCP Server

A lightweight [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server for Spotify playback control, library access, album lookup, and playlist management.

The current server implementation is a **stdio MCP server** named `spotify-controller` that registers **31 tools** from the source files in `src/`:

- `src/read.ts` — 11 read/library tools
- `src/play.ts` — 12 playback + creation tools
- `src/albums.ts` — 4 album tools
- `src/playlist.ts` — 4 playlist tools

It is intended to be used by MCP-compatible clients such as Claude Desktop, Cursor, VS Code extensions, and custom MCP hosts.

## Contents

- [What the current server does](#what-the-current-server-does)
- [Quick start](#quick-start)
- [Spotify app setup](#spotify-app-setup)
- [Configuration and authentication](#configuration-and-authentication)
- [Tool reference](#tool-reference)
  - [Read and library tools](#read-and-library-tools)
  - [Playback and creation tools](#playback-and-creation-tools)
  - [Album tools](#album-tools)
  - [Playlist tools](#playlist-tools)
- [MCP client integration](#mcp-client-integration)
- [Examples](#examples)
- [Development](#development)
- [Project structure](#project-structure)
- [Security notes](#security-notes)

## What the current server does

The source code currently exposes tools for:

- Searching Spotify for tracks, albums, artists, and playlists
- Inspecting the current playback state, queue, devices, playlists, albums, and library
- Playing tracks, albums, artists, and playlists
- Pausing, resuming, skipping, queueing, and controlling volume/shuffle/repeat
- Creating playlists and adding/removing/reordering tracks
- Saving or removing tracks and albums from the user's library

Implementation details verified from `src/index.ts` and `src/utils.ts`:

- Transport: `StdioServerTransport`
- Server name: `spotify-controller`
- Version: `1.0.0`
- Tool calls are logged to `stderr`, not `stdout`
- Sensitive fields such as tokens and secrets are redacted in logs
- Access tokens are automatically refreshed when expired

## Quick start

### 1. Install dependencies

```bash
npm install
```

### 2. Create `spotify-config.json`

```bash
cp spotify-config.example.json spotify-config.json
```

Then edit `spotify-config.json` with your Spotify app credentials.

### 3. Authenticate

```bash
npm run auth
```

This script builds the project first, opens the Spotify authorization flow, and writes tokens back into `spotify-config.json`.

### 4. Build the server

```bash
npm run build
```

### 5. Run or integrate the MCP server

```bash
npm start
```

Or point your MCP client at:

```text
/absolute/path/to/spotify-mcp-server/build/index.js
```

## Spotify app setup

1. Go to the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard/)
2. Create an app
3. Copy the app's **Client ID** and **Client Secret**
4. Add a redirect URI such as:

```text
http://127.0.0.1:8888/callback
```

Important: the authentication helper in `src/utils.ts` requires the redirect host to be `localhost` or `127.0.0.1`.

## Configuration and authentication

The server reads configuration from the repository root file:

```text
spotify-config.json
```

Minimum required fields before authentication:

```json
{
  "clientId": "your-client-id",
  "clientSecret": "your-client-secret",
  "redirectUri": "http://127.0.0.1:8888/callback"
}
```

After `npm run auth`, the file will also contain token fields like these:

```json
{
  "clientId": "your-client-id",
  "clientSecret": "your-client-secret",
  "redirectUri": "http://127.0.0.1:8888/callback",
  "accessToken": "...",
  "refreshToken": "...",
  "expiresAt": 1760000000000
}
```

Notes based on the current source:

- If the token is expired, the server refreshes it automatically.
- If refresh fails, you need to run `npm run auth` again.
- If no user token is present, the utility falls back to client-credentials auth. Some catalog operations can still work, but user playback, playlist, and library tools require user authorization.

## Tool reference

## Read and library tools

Defined in `src/read.ts`.

| Tool | Purpose | Key parameters |
| --- | --- | --- |
| `searchSpotify` | Search tracks, albums, artists, or playlists | `query`, `type`, `limit?` |
| `getNowPlaying` | Show current track, device, volume, shuffle, and repeat status | none |
| `getMyPlaylists` | List the current user's playlists | `limit?` |
| `getPlaylistTracks` | List tracks in a playlist with pagination | `playlistId`, `limit?`, `offset?` |
| `getRecentlyPlayed` | Show recently played tracks | `limit?` |
| `getUsersSavedTracks` | List tracks from Liked Songs | `limit?`, `offset?` |
| `saveUsersSavedTracks` | Save one or more tracks to Liked Songs | `trackIds` (max 40) |
| `saveNowPlayingToLikedSongs` | Save the currently playing track to Liked Songs | none |
| `removeUsersSavedTracks` | Remove one or more tracks from Liked Songs | `trackIds` (max 40) |
| `getQueue` | Show the currently playing item and upcoming queue | `limit?` |
| `getAvailableDevices` | List available Spotify Connect devices | none |

Behavior notes from the source:

- `searchSpotify` supports `track`, `album`, `artist`, and `playlist`.
- `getQueue` defaults to showing up to 10 upcoming items.
- `getPlaylistTracks` and `getUsersSavedTracks` support pagination via `offset`.
- `saveUsersSavedTracks` and `removeUsersSavedTracks` call the Spotify Web API directly and cap requests at 40 IDs.

## Playback and creation tools

Defined in `src/play.ts`.

| Tool | Purpose | Key parameters |
| --- | --- | --- |
| `playMusic` | Start playback for a track, album, artist, or playlist | `uri?` or `type` + `id`, `deviceId?` |
| `pausePlayback` | Pause playback | `deviceId?` |
| `resumePlayback` | Resume playback | `deviceId?` |
| `skipToNext` | Skip forward and return updated track info | `deviceId?` |
| `skipToPrevious` | Skip backward and return updated track info | `deviceId?` |
| `createPlaylist` | Create a new playlist | `name`, `description?`, `public?` |
| `addTracksToPlaylist` | Add tracks to a playlist | `playlistId`, `trackIds`, `position?` |
| `addToQueue` | Add an item to the playback queue | `uri?` or `type` + `id`, `deviceId?` |
| `setVolume` | Set exact playback volume | `volumePercent`, `deviceId?` |
| `adjustVolume` | Change volume relative to the current level | `adjustment`, `deviceId?` |
| `setShuffle` | Enable or disable shuffle | `state`, `deviceId?` |
| `setRepeat` | Set repeat mode | `state`, `deviceId?` |

Behavior notes from the source:

- `playMusic` requires either a full Spotify `uri` or both `type` and `id`.
- When `playMusic` starts an album, it first tries to turn shuffle off so album playback stays in order.
- `skipToNext` and `skipToPrevious` wait briefly, then fetch the new playback state and return detailed track/device info.
- `setVolume`, `adjustVolume`, `setShuffle`, and `setRepeat` are marked as requiring Spotify Premium.
- `adjustVolume` reads the current playback device first, then clamps the new volume to the `0-100` range.

## Album tools

Defined in `src/albums.ts`.

| Tool | Purpose | Key parameters |
| --- | --- | --- |
| `getAlbums` | Get one or more albums by Spotify ID | `albumIds` (string or string[]) |
| `getAlbumTracks` | List tracks for an album | `albumId`, `limit?`, `offset?` |
| `saveOrRemoveAlbumForUser` | Save or remove albums from the user's library | `albumIds`, `action` |
| `checkUsersSavedAlbums` | Check whether albums are saved | `albumIds` |

Behavior notes from the source:

- `getAlbums` accepts either a single album ID or up to 20 IDs.
- `saveOrRemoveAlbumForUser` accepts `action: "save" | "remove"`.
- Album save/check operations are capped at 20 IDs per request.

## Playlist tools

Defined in `src/playlist.ts`.

| Tool | Purpose | Key parameters |
| --- | --- | --- |
| `getPlaylist` | Get playlist metadata, owner, description, and URL | `playlistId` |
| `updatePlaylist` | Update playlist name, description, visibility, or collaboration mode | `playlistId`, `name?`, `description?`, `public?`, `collaborative?` |
| `removeTracksFromPlaylist` | Remove one or more tracks from a playlist | `playlistId`, `trackIds`, `snapshotId?` |
| `reorderPlaylistItems` | Move tracks within a playlist | `playlistId`, `rangeStart`, `insertBefore`, `rangeLength?`, `snapshotId?` |

Behavior notes from the source:

- `updatePlaylist` returns an error if no updatable fields are provided.
- `removeTracksFromPlaylist` supports up to 100 track IDs per request.
- `reorderPlaylistItems` uses zero-based positions for both `rangeStart` and `insertBefore`.

## MCP client integration

The server runs over stdio, so MCP clients should invoke the built entrypoint with Node.

### Claude Desktop

Example server definition:

```json
{
  "mcpServers": {
    "spotify": {
      "command": "node",
      "args": ["/absolute/path/to/spotify-mcp-server/build/index.js"]
    }
  }
}
```

### Cursor

Example command:

```bash
node /absolute/path/to/spotify-mcp-server/build/index.js
```

### VS Code / Cline-style config

```json
{
  "mcpServers": {
    "spotify": {
      "command": "node",
      "args": ["/absolute/path/to/spotify-mcp-server/build/index.js"],
      "autoApprove": ["getNowPlaying", "searchSpotify"]
    }
  }
}
```

## Examples

The `examples/` directory contains standalone scripts that use the compiled `build/` output directly, so build first:

```bash
npm run build
```

Current example files:

- `examples/test-now-playing.mjs`
- `examples/build-and-play-playlist.mjs`
- `examples/add-songs-to-playlist.mjs`
- `examples/get-music-statistics.mjs`
- `examples/check-playback-status.mjs`
- `examples/enable-shuffle-v2.mjs`
- `examples/skip-next.mjs`
- `examples/next-and-shuffle.mjs`

There is also a `examples/run-skip.mjs` file in the repository, but it is currently empty.

For commands and walkthroughs, see `examples/README.md`.

## Development

Available npm scripts from `package.json`:

```bash
npm run build
npm run dev
npm run auth
npm run typecheck
npm run lint
npm run lint:fix
npm start
npm run token:status
npm run token:check
npm run token:refresh
npm run token:help
```

What they do:

- `npm run build` — compile TypeScript to `build/`
- `npm run dev` — watch/compile with TypeScript
- `npm run auth` — compile and run the browser-based Spotify auth flow
- `npm run typecheck` — run TypeScript without emitting files
- `npm run lint` / `npm run lint:fix` — run Biome checks
- `npm start` — start the built MCP server
- `npm run token:status`, `token:check`, `token:refresh`, `token:help` — token utility commands exposed by `package.json` via `build/token-cli.js`

## Project structure

```text
spotify-mcp-server/
├── src/
│   ├── index.ts       # MCP server entry point and tool registration
│   ├── read.ts        # Search, playback state, library, queue, devices
│   ├── play.ts        # Playback controls, playlist creation, queue, volume
│   ├── albums.ts      # Album lookup and save/remove operations
│   ├── playlist.ts    # Playlist metadata/update/remove/reorder operations
│   ├── auth.ts        # CLI entrypoint for authentication
│   ├── utils.ts       # Spotify config loading, auth, token refresh, helpers
│   └── types.ts       # Shared TypeScript types
├── examples/          # Standalone example scripts
├── build/             # Compiled JavaScript output
├── spotify-config.example.json
├── package.json
└── README.md
```

## Security notes

- `spotify-config.json` contains your client secret and user tokens.
- The repository's `.gitignore` excludes `spotify-config.json`.
- Do not commit real Spotify credentials or tokens.
- The server logs redact sensitive-looking fields before writing diagnostic data.

## Example interactions

- _"What's playing right now?"_
- _"Show my available Spotify devices."_
- _"Play this album on my MacBook and turn shuffle off."_
- _"Add these tracks to my workout playlist."_
- _"Save the current song to my Liked Songs."_
- _"Move the first two songs in this playlist to the end."_

## License

MIT

