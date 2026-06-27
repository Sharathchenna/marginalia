# Marginalia AI backend. Bundles the server + the Claude Agent SDK sidecar.
FROM node:20-slim

WORKDIR /app

# The sidecar (agent.mjs) + its SDK dependency.
COPY src-tauri/sidecar/package.json src-tauri/sidecar/package-lock.json* ./sidecar/
RUN cd sidecar && npm install --omit=dev
COPY src-tauri/sidecar/agent.mjs ./sidecar/

# The HTTP/SSE server.
COPY server/server.mjs ./server/

ENV AGENT_SCRIPT=/app/sidecar/agent.mjs
ENV PORT=8799
EXPOSE 8799

# Provide at runtime: ANTHROPIC_API_KEY (required) and MARG_TOKEN (recommended).
#   docker run -e ANTHROPIC_API_KEY=sk-... -e MARG_TOKEN=secret -p 8799:8799 marginalia-ai
CMD ["node", "server/server.mjs"]
