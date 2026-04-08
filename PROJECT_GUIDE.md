# Spotify MCP Server - Refactored Project Guide

## 📋 Overview

Your Spotify MCP Server project has been **refactored to be a production-ready MCP server package** instead of a collection of scripts. This means it's now properly designed to be consumed by AI assistants like Claude Desktop, Cursor, and VS Code.

## 🎯 What Changed

### Before (Mixed Structure)
```
spotify-mcp-server/
├── src/              # MCP server code
├── build/            # Compiled server
├── *.mjs files       # Random test scripts in root
└── README.md
```

### After (Clean Structure)
```
spotify-mcp-server/
├── src/              # Core MCP server code
├── build/            # Compiled server
├── examples/         # Organized example scripts
├── README.md         # MCP server documentation
├── REFACTORING.md    # Detailed refactoring info
└── package.json      # Production-ready metadata
```

## 📦 Key Improvements

### 1. **Package Configuration**
✅ `package.json` now includes:
- Proper description emphasizing MCP purpose
- License, repository, and bugs fields
- Correct `main` entry point
- Better scripts: `build`, `dev`, `auth`, `typecheck`
- Appropriate `files` array (excludes examples)
- Required Node.js version specification

### 2. **Code Organization**
✅ Test scripts moved to `examples/`:
- `test-now-playing.mjs`
- `build-and-play-playlist.mjs`
- `add-songs-to-playlist.mjs`
- `get-music-statistics.mjs`
- `check-playback-status.mjs`
- `enable-shuffle-v2.mjs`
- `skip-next.mjs`
- And more...

### 3. **Documentation**
✅ Two-tier documentation:
- **README.md**: MCP server setup and usage
- **examples/README.md**: Guide to example scripts
- **REFACTORING.md**: This refactoring summary

### 4. **Token Management**
✅ Enhanced `src/utils.ts` with:
- Automatic token refresh on expiration
- Better error handling
- No instance caching (ensures fresh tokens)

## 🚀 How to Use

### For Integration with AI Assistants

#### Claude Desktop
1. Build the server: `npm run build`
2. Add to `~/.config/claude/config.json`:
```json
{
  "mcpServers": {
    "spotify": {
      "command": "node",
      "args": ["/path/to/spotify-mcp-server/build/index.js"]
    }
  }
}
```
3. Restart Claude Desktop

#### Cursor
1. Build: `npm run build`
2. Open Cursor Settings (Cmd + Shift + J)
3. Go to MCP tab
4. Add: `node /path/to/spotify-mcp-server/build/index.js`

#### VS Code with Cline
1. Build: `npm run build`
2. Create/edit `cline_mcp_settings.json`:
```json
{
  "mcpServers": {
    "spotify": {
      "command": "node",
      "args": ["/path/to/spotify-mcp-server/build/index.js"],
      "autoApprove": ["getNowPlaying", "searchSpotify"]
    }
  }
}
```

### For Testing/Development

#### Run Examples
```bash
# Get now playing
node examples/test-now-playing.mjs

# Build and play a playlist
node examples/build-and-play-playlist.mjs

# Get music statistics
node examples/get-music-statistics.mjs

# And more...
```

#### Development Workflow
```bash
# Watch for TypeScript changes
npm run dev

# Type check
npm run typecheck

# Lint
npm run lint

# Lint with fixes
npm run lint:fix
```

## 📂 File Organization

### Core MCP Server (src/)
These files are compiled and distributed:
- `index.ts` - MCP server entry point
- `read.ts` - Search, get playlists, etc.
- `play.ts` - Playback control
- `albums.ts` - Album operations
- `auth.ts` - Authentication logic
- `utils.ts` - Utilities + token refresh
- `types.ts` - TypeScript types

### Build Output (build/)
Generated JavaScript - do NOT edit directly

### Examples (examples/)
For learning and testing - NOT distributed:
- Each script demonstrates a use case
- Can be adapted for your needs
- Run independently with Node.js

### Configuration
- `.gitignore` - Excludes sensitive files
- `package.json` - Project metadata
- `tsconfig.json` - TypeScript config
- `biome.jsonc` - Code formatting rules

## 🎮 Available Tools

The MCP server exposes these tools to AI assistants:

### Read Tools
- `searchSpotify` - Search tracks, albums, artists, playlists
- `getNowPlaying` - Get current track
- `getMyPlaylists` - Get user's playlists
- `getPlaylistTracks` - Get tracks in playlist
- `getRecentlyPlayed` - Get recently played
- `getUsersSavedTracks` - Get liked songs
- `getQueue` - Get playback queue

### Play Tools
- `playMusic` - Play track/album/artist/playlist
- `pausePlayback` - Pause
- `resumePlayback` - Resume
- `skipToNext` - Next track
- `skipToPrevious` - Previous track
- `addToQueue` - Add to queue

### Playlist Tools
- `createPlaylist` - Create new playlist
- `addTracksToPlaylist` - Add tracks

### Album Tools
- `getAlbums` - Get album info
- `getAlbumTracks` - Get album tracks
- `saveOrRemoveAlbumForUser` - Save/remove
- `checkUsersSavedAlbums` - Check if saved

## 🔐 Security

✅ Important security measures:
- `spotify-config.json` is git-ignored (contains secrets)
- Use `spotify-config.example.json` as template
- Tokens are automatically refreshed
- No credentials in distributed package

## 📊 Project Status

- ✅ MCP server ready
- ✅ Production-ready package
- ✅ Example scripts included
- ✅ Comprehensive documentation
- ✅ Proper project structure
- ✅ Token refresh working
- ✅ TypeScript strict mode
- ✅ Linting configured

## 🎓 Learning Resources

1. **README.md** - MCP server overview and setup
2. **examples/README.md** - How to run example scripts
3. **REFACTORING.md** - Detailed refactoring info
4. **examples/*.mjs** - Working code examples

## 🤔 Common Questions

### Q: Can I still run the test scripts?
**A:** Yes! They're in `examples/` folder. Run them with:
```bash
node examples/script-name.mjs
```

### Q: How do I integrate with Claude Desktop?
**A:** Build the project and add to Claude's config. See README.md for details.

### Q: Where are my Spotify credentials?
**A:** In `spotify-config.json` (git-ignored for security).

### Q: Can I publish this to npm?
**A:** Yes! The package.json is properly configured. The `files` field ensures only necessary files are included.

### Q: How do I develop/modify the code?
**A:** Edit files in `src/`, then run:
```bash
npm run dev        # Watch mode
npm run build      # Compile
npm run lint:fix   # Fix formatting
```

## 📞 Next Steps

1. **Verify the build**: `npm run build` (should complete without errors)
2. **Test an example**: `node examples/test-now-playing.mjs`
3. **Integrate**: Add to your MCP client (Claude, Cursor, etc.)
4. **Customize**: Modify tools in `src/` as needed

## ✨ Benefits

- ✅ **Clear Purpose**: This is an MCP server package, not a CLI tool
- ✅ **Professional**: Follows npm package best practices
- ✅ **Maintainable**: Well-organized, easy to modify
- ✅ **Documented**: Comprehensive guides included
- ✅ **Production Ready**: Proper error handling and security
- ✅ **User Friendly**: Easy setup and integration

---

For more details, see:
- `README.md` - Project overview and setup
- `examples/README.md` - Example scripts guide
- `REFACTORING.md` - Detailed changes made

