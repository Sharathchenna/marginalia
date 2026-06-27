# Marginalia AI backend

The Node-side services the native apps can't run locally: a Claude Agent SDK
relay (`sidecar/agent.mjs`), Microsoft Edge neural read-aloud (`sidecar/tts.mjs`),
and citeproc/CSL citations (`cite.mjs`). Your Anthropic credentials stay on the
server.

## How it works
For `/v1/agent`, the server spawns `node sidecar/agent.mjs`, pipes the JSON payload
to its stdin, and relays the sidecar's JSON-lines events to the client as
Server-Sent Events. `/v1/tts/*` spawns `sidecar/tts.mjs`; `/v1/cite` runs in-process
via `cite.mjs`. The apps call these when an **AI backend URL** is set in Settings.

## Run it
```bash
# from the server/ dir — install the sidecar's SDK once:
npm --prefix sidecar install && npm install

# then start the server:
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
| `AGENT_SCRIPT` | `./sidecar/agent.mjs` | path to the agent sidecar |
| `TTS_SCRIPT` | `./sidecar/tts.mjs` | path to the TTS sidecar |
