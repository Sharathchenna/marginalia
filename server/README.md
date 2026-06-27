# Marginalia AI backend

A tiny self-hostable HTTP/SSE bridge to the Claude Agent SDK sidecar
(`src-tauri/sidecar/agent.mjs`). It lets the **iOS app and the web build** use AI
(chat, summarize, auto-tag, claim verification) — which otherwise require the
desktop app's local Node sidecar. Your Anthropic credentials stay on the server.

## How it works
Per request, the server spawns `node agent.mjs`, pipes the JSON payload to its
stdin, and relays the sidecar's JSON-lines events to the client as Server-Sent
Events. The app's `src/lib/agent.ts` calls it when an **AI backend URL** is set in
Settings (and that's the only AI path on iOS/web).

## Run it
```bash
# from the repo root — install the sidecar's SDK once:
cd src-tauri/sidecar && npm install && cd -

# then start the server (zero extra deps):
ANTHROPIC_API_KEY=sk-ant-...  MARG_TOKEN=your-shared-secret  node server/server.mjs
```
Or with Docker (bundles the sidecar):
```bash
docker build -f server/Dockerfile -t marginalia-ai .
docker run -e ANTHROPIC_API_KEY=sk-ant-... -e MARG_TOKEN=secret -p 8799:8799 marginalia-ai
```

Put it behind HTTPS (Caddy/nginx/Cloudflare Tunnel). Then in the app:
**Settings → AI backend** → URL `https://your-host` + the `MARG_TOKEN`.

## Endpoints
- `POST /v1/agent` — body = the agent payload `{ mode, paper, history, model, … }`;
  responds with an SSE stream of `{type,...}` events (delta / metadata / tags /
  verdict / thinking / tool / done / error).
- `GET /health` — `{"ok":true}`.

## Env
| var | default | purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | **required** — passed to the Agent SDK |
| `MARG_TOKEN` | (none) | require `Authorization: Bearer <token>` — **set this** |
| `MARG_CORS_ORIGIN` | `*` | allowed origin for the web build |
| `PORT` | `8799` | listen port |
| `AGENT_SCRIPT` | `../src-tauri/sidecar/agent.mjs` | path to the sidecar |
