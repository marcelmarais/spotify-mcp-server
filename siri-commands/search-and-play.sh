#!/bin/bash
cd ~/studies/spotify-mcp-server

NODE_PATH=$(ls -t /Users/dienert/.nvm/versions/node/*/bin/node 2>/dev/null | head -1)
[ -z "$NODE_PATH" ] && NODE_PATH=$(command -v node 2>/dev/null)

QUERY="$1"
TYPE="${2:-all}"

if [ -z "$QUERY" ]; then
  echo "Nenhuma música especificada"
  exit 1
fi

# Free-text mode: try DJ voice commands (pause, next, moods, surprise...)
# before treating the text as a music search
if [ "$TYPE" = "all" ]; then
  "$(dirname "$0")/dj-dispatch.sh" "$QUERY" && exit 0
fi

# Open Spotify if not running
if ! pgrep -x "Spotify" > /dev/null; then
  open -a Spotify
  sleep 4
fi

# Lowercase (Spotify search is case-insensitive; BSD sed has no /i flag)
# and strip leading command words ("toca", "play", ...) so they don't
# pollute the search query
CLEAN_QUERY=$(printf '%s' "$QUERY" | tr '[:upper:]' '[:lower:]' | sed -E 's/^(toca|tocar|toque|play|coloca|colocar|bota|botar|poe|põe)[[:space:]]+((a|o)[[:space:]]+)?((musica|música|som|faixa)[[:space:]]+)?//')

# Parse patterns
PARSED_QUERY="$CLEAN_QUERY"
if echo "$CLEAN_QUERY" | grep -q " by \| from \| - \| de \| do \| da "; then
  SONG=$(echo "$CLEAN_QUERY" | sed -E 's/(.+) (by|from|de|do|da|-) (.+)/\1/' | xargs)
  ARTIST=$(echo "$CLEAN_QUERY" | sed -E 's/(.+) (by|from|de|do|da|-) (.+)/\3/' | xargs)
  if [ -n "$SONG" ] && [ -n "$ARTIST" ]; then
    PARSED_QUERY="track:${SONG} artist:${ARTIST}"
    TYPE="track"
  fi
fi

QUERY_ESCAPED=$(echo "$PARSED_QUERY" | sed 's/"/\\"/g')

$NODE_PATH -e "
const { spawn } = require('child_process');
const server = spawn('$NODE_PATH', ['build/index.js'], { stdio: ['pipe', 'pipe', 'pipe'] });
let buffer = '', id = 1, foundId = null, foundType = null, artistId = null;
let songStarted = false, outputDone = false;
const searchType = '${TYPE}';
const types = searchType === 'all' ? ['track', 'artist', 'album', 'playlist'] : [searchType];
let currentTypeIndex = 0;

const send = (method, params = {}) => {
  server.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: id++, method, params }) + '\n');
};

const finish = (msg) => {
  if (outputDone) return;
  outputDone = true;
  process.stdout.write(msg + '\n', () => {
    server.kill();
    process.exit(0);
  });
};

const searchNext = () => {
  if (currentTypeIndex < types.length && !foundId) {
    send('tools/call', {
      name: 'searchSpotify',
      arguments: { query: \"${QUERY_ESCAPED}\", type: types[currentTypeIndex], limit: 1 }
    });
    currentTypeIndex++;
  } else if (!foundId) {
    finish('Não encontrei essa música');
  }
};

server.stdout.on('data', (data) => {
  buffer += data.toString();
  const lines = buffer.split('\n');
  buffer = lines.pop();
  for (const line of lines) {
    if (line.trim()) {
      try {
        const r = JSON.parse(line);
        if (r.result?.content?.[0]?.text) {
          const text = r.result.content[0].text;
          const match = text.match(/ID: ([a-zA-Z0-9]+)/);

          if (match && !foundId) {
            foundId = match[1];
            if (text.includes('type: track')) foundType = 'track';
            else if (text.includes('type: artist')) foundType = 'artist';
            else if (text.includes('type: album')) foundType = 'album';
            else if (text.includes('type: playlist')) foundType = 'playlist';
            else foundType = types[currentTypeIndex - 1];

            const infoMatch = text.match(/\\d+\\.\\s*\"([^\"]+)\"\\s*by\\s*([^(]+)/);
            if (infoMatch) {
              global.foundSong = infoMatch[1].trim();
              global.foundArtist = infoMatch[2].trim();
            }

            // First enable shuffle for continuous play
            send('tools/call', {
              name: 'setShuffle',
              arguments: { state: true }
            });
          } else if (text.includes('No ') && text.includes('results found')) {
            searchNext();
          } else if (text.includes('Shuffle enabled') && !songStarted) {
            // Now search for the artist to get their ID
            if (global.foundArtist) {
              send('tools/call', {
                name: 'searchSpotify',
                arguments: { query: global.foundArtist, type: 'artist', limit: 1 }
              });
            } else {
              // No artist info, play the found item directly
              send('tools/call', {
                name: 'playMusic',
                arguments: { type: foundType || 'track', id: foundId }
              });
            }
          } else if (text.includes('type: artist') && foundId && !songStarted) {
            // Found artist, extract ID
            const artistMatch = text.match(/ID: ([a-zA-Z0-9]+)/);
            if (artistMatch) {
              artistId = artistMatch[1];
              // Play the artist (which with shuffle gives radio-like experience)
              send('tools/call', {
                name: 'playMusic',
                arguments: { type: 'artist', id: artistId }
              });
            }
          } else if (text.includes('Started playing') && !songStarted) {
            songStarted = true;
            // Now queue the specific track to play first
            if (foundId && foundType === 'track') {
              send('tools/call', {
                name: 'addToQueue',
                arguments: { type: 'track', id: foundId }
              });
            } else {
              // Not a track, just announce
              finish(global.foundSong ? global.foundSong + ' tocando' : 'Música tocando');
            }
          } else if (text.includes('Added item') && songStarted) {
            // Skip to next to play our requested song
            send('tools/call', {
              name: 'skipToNext',
              arguments: {}
            });
          } else if (text.includes('Skipped to next')) {
            finish(global.foundSong && global.foundArtist
              ? global.foundSong + ' de ' + global.foundArtist + ' tocando'
              : 'Música tocando');
          }
        }
      } catch {}
    }
  }
});

setTimeout(() => send('initialize', {
  protocolVersion: '2024-11-05',
  capabilities: {},
  clientInfo: { name: 'siri-client', version: '1.0.0' }
}), 100);

setTimeout(() => searchNext(), 500);

// Safety timeout - only report success if playback actually started
setTimeout(() => {
  if (songStarted) {
    finish(global.foundSong && global.foundArtist
      ? global.foundSong + ' de ' + global.foundArtist + ' tocando'
      : 'Música tocando');
  } else if (foundId) {
    finish('Não foi possível iniciar a reprodução');
  } else {
    finish('Não encontrei essa música');
  }
}, 15000);
"
