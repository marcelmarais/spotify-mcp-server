#!/bin/bash
cd ~/studies/spotify-mcp-server

TOOL="${1:-getNowPlaying}"
ARGS="${2:-}"
[ -z "$ARGS" ] && ARGS='{}'

NODE_PATH=$(ls -t /Users/dienert/.nvm/versions/node/*/bin/node 2>/dev/null | head -1)
[ -z "$NODE_PATH" ] && NODE_PATH=$(command -v node 2>/dev/null)

$NODE_PATH -e "
const { spawn } = require('child_process');
const server = spawn('$NODE_PATH', ['build/index.js'], { stdio: ['pipe', 'pipe', 'pipe'] });
let buffer = '', id = 1, finished = false;

const send = (method, params = {}) => {
  server.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: id++, method, params }) + '\n');
};

const finish = (msg) => {
  if (finished) return;
  finished = true;
  if (msg) console.log(msg);
  server.kill();
  process.exit(0);
};

server.stdout.on('data', (data) => {
  buffer += data.toString();
  const lines = buffer.split('\n');
  buffer = lines.pop();
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      // id 2 is the tools/call response; exit as soon as it arrives
      if (r.id === 2) {
        if (r.result?.content?.[0]?.text) finish(r.result.content[0].text);
        else if (r.error) finish('Erro: ' + r.error.message);
        else finish('');
      }
    } catch {}
  }
});

setTimeout(() => send('initialize', {
  protocolVersion: '2024-11-05',
  capabilities: {},
  clientInfo: { name: 'siri-client', version: '1.0.0' }
}), 100);

setTimeout(() => send('tools/call', {
  name: '${TOOL}',
  arguments: ${ARGS}
}), 500);

// Safety timeout for slow tools (e.g. createMoodPlaylist)
setTimeout(() => finish('Tempo esgotado'), 25000);
"
