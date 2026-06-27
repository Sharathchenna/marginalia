# Marginalia AI backend. Bundles the HTTP/SSE server (agent relay + Edge TTS +
# citeproc citations) and the Node sidecars it spawns.
FROM node:20-slim

WORKDIR /app

# Sidecar (agent.mjs + tts.mjs) + its deps: Claude Agent SDK + edge-tts-universal.
COPY src-tauri/sidecar/package.json src-tauri/sidecar/package-lock.json* ./sidecar/
RUN cd sidecar && npm install --omit=dev
COPY src-tauri/sidecar/agent.mjs src-tauri/sidecar/tts.mjs ./sidecar/

# Server (server.mjs + cite.mjs) + its dep: citeproc. The CSL styles cite.mjs
# loads live in ./server/csl/.
COPY server/package.json server/package-lock.json* ./server/
RUN cd server && npm install --omit=dev
COPY server/server.mjs server/cite.mjs ./server/
COPY src/styles/csl/ ./server/csl/

ENV AGENT_SCRIPT=/app/sidecar/agent.mjs
ENV TTS_SCRIPT=/app/sidecar/tts.mjs
ENV PORT=8799
EXPOSE 8799

# Provide at runtime: ANTHROPIC_API_KEY (or in-container Claude login) and
# MARG_TOKEN (recommended).
#   docker run -e ANTHROPIC_API_KEY=sk-... -e MARG_TOKEN=secret -p 8799:8799 marginalia-ai
CMD ["node", "server/server.mjs"]
