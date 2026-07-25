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
let buffer = '', id = 1;

const send = (method, params = {}) => {
  server.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: id++, method, params }) + '\n');
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
          console.log(r.result.content[0].text);
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

setTimeout(() => send('tools/call', {
  name: '${TOOL}',
  arguments: ${ARGS}
}), 500);

setTimeout(() => { server.kill(); process.exit(0); }, 6000);
"
