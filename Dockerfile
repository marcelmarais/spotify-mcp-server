# syntax=docker/dockerfile:1

# ---- Build stage -----------------------------------------------------------
# Uses the Node 26 Current line (package.json requires >= 26.8.1; CI tracks
# the latest Current release).
FROM node:26-alpine AS build
WORKDIR /app

# Locked dependencies, including the devDependencies the TypeScript build needs.
COPY package.json package-lock.json ./
RUN npm ci

# Compile TypeScript to /app/build (tsc emits to ./build per tsconfig.json).
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Keep only runtime dependencies for the image.
RUN npm prune --omit=dev

# ---- Runtime stage ---------------------------------------------------------
FROM node:26-alpine
# Run as an unprivileged user; the server needs no filesystem or host access
# beyond its own working directory in OAuth mode.
RUN addgroup -g 1001 mcp && adduser -u 1001 -G mcp -s /bin/sh -D mcp
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build --chown=mcp:mcp /app/node_modules ./node_modules
COPY --from=build --chown=mcp:mcp /app/build ./build
COPY --chown=mcp:mcp package.json ./

USER mcp
EXPOSE 3000

# OAuth-protected Streamable HTTP mode:
#   - 0.0.0.0 so other containers on the Docker network can reach it. No host
#     port is published, so it is not exposed to the host's external
#     interfaces.
#   - MCP_AUTH=spotify makes the server an RFC 9728 protected resource whose
#     authorization server is Spotify. The MCP client (e.g. MCPHub) performs
#     the browser OAuth flow and presents the resulting access token as Bearer
#     per request. This image therefore needs NO client secret, NO refresh
#     token and NO spotify-config.json.
ENV MCP_TRANSPORT=http \
    MCP_HTTP_HOST=0.0.0.0 \
    MCP_HTTP_PORT=3000 \
    MCP_AUTH=spotify

CMD ["node", "build/index.js"]
