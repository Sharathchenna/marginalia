// Marginalia AI backend — a tiny self-hostable HTTP/SSE service for the Node-side
// features iOS and the web build can't run locally:
//   POST /v1/agent        SSE bridge to the Claude Agent SDK sidecar (agent.mjs)
//   POST /v1/tts/speak     Microsoft Edge neural TTS (spawns tts.mjs) -> base64 mp3
//   GET  /v1/tts/voices    list Edge voices
//   POST /v1/cite          CSL/citeproc citation formatting (cite.mjs)
//   GET  /v1/cite/styles   available citation styles
//
// The Anthropic credentials live here on the server, never on the device. Per
// /v1/agent request it spawns `node agent.mjs`, pipes the JSON payload to stdin,
// and relays its JSON-lines events to the client as Server-Sent Events.
//
//   ANTHROPIC_API_KEY=sk-...  MARG_TOKEN=your-shared-secret  node server/server.mjs
//
// Env:
//   PORT             (default 8799)
//   MARG_TOKEN       require `Authorization: Bearer <token>` when set (recommended)
//   MARG_CORS_ORIGIN allowed CORS origin for the web build (default "*")
//   AGENT_SCRIPT     path to agent.mjs (default ./sidecar/agent.mjs)
//   TTS_SCRIPT       path to tts.mjs   (default alongside AGENT_SCRIPT)
import http from "node:http";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cite as citeOne, CITE_STYLE_OPTIONS } from "./cite.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8799);
const TOKEN = process.env.MARG_TOKEN || "";
const ORIGIN = process.env.MARG_CORS_ORIGIN || "*";
const AGENT_SCRIPT = process.env.AGENT_SCRIPT || resolve(here, "sidecar/agent.mjs");
const TTS_SCRIPT = process.env.TTS_SCRIPT || resolve(dirname(AGENT_SCRIPT), "tts.mjs");

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", ORIGIN);
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
}

function authorized(req) {
  return !TOKEN || req.headers["authorization"] === `Bearer ${TOKEN}`;
}

function sendJson(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}

// Collect a (capped) request body, then resolve it as a string.
function readBody(req, cap = 8_000_000) {
  return new Promise((resolveBody, reject) => {
    let body = "";
    req.on("data", (c) => {
      body += c;
      if (body.length > cap) {
        reject(new Error("payload too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolveBody(body));
    req.on("error", reject);
  });
}

// Run a one-shot sidecar (tts.mjs): write `op` to stdin, read the single JSON
// reply line from stdout. Mirrors the desktop tts.rs bridge.
function runSidecar(script, op) {
  return new Promise((resolveReply, reject) => {
    const child = spawn("node", [script], { cwd: dirname(script), env: process.env });
    let out = "";
    let errBuf = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (errBuf += d.toString()));
    child.on("error", reject);
    child.on("close", () => {
      const line = out.trim().split("\n").filter(Boolean).pop() || "";
      try {
        resolveReply(JSON.parse(line));
      } catch {
        reject(new Error(errBuf.trim() || "sidecar produced no JSON reply"));
      }
    });
    child.stdin.write(JSON.stringify(op));
    child.stdin.end();
  });
}

// ---------- route handlers ----------

function handleAgent(req, res) {
  readBody(req).then((body) => {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    const child = spawn("node", [AGENT_SCRIPT], { cwd: dirname(AGENT_SCRIPT), env: process.env });
    let settled = false;
    let buf = "";
    child.stdout.on("data", (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        try {
          const evt = JSON.parse(line);
          if (!evt || !evt.__marg) continue;
          const { __marg, ...rest } = evt;
          void __marg;
          if (rest.type === "done" || rest.type === "error") settled = true;
          res.write(`data: ${JSON.stringify(rest)}\n\n`);
        } catch {
          /* ignore non-JSON stdout */
        }
      }
    });
    child.on("close", () => {
      if (!settled) {
        res.write(`data: ${JSON.stringify({ type: "error", error: "AI process ended unexpectedly." })}\n\n`);
      }
      res.end();
    });
    // Kill the agent only if the CLIENT disconnects (response closes early) — NOT
    // on request 'close', which fires as soon as the (small) POST body is received
    // and would kill the agent before it streams anything. This is also how the
    // iOS app cancels an in-flight turn (the Mac app's `ai_cancel`): drop the SSE.
    res.on("close", () => {
      if (!res.writableFinished) {
        try {
          child.kill();
        } catch {
          /* already gone */
        }
      }
    });
    child.stdin.write(body);
    child.stdin.end();
  });
}

async function handleTtsSpeak(req, res) {
  let payload;
  try {
    payload = JSON.parse((await readBody(req)) || "{}");
  } catch {
    return sendJson(res, 400, { ok: false, error: "invalid JSON" });
  }
  const text = (payload.text || "").toString();
  if (!text.trim()) return sendJson(res, 400, { ok: false, error: "text is required" });
  try {
    const reply = await runSidecar(TTS_SCRIPT, {
      op: "speak",
      text,
      voice: payload.voice || "en-US-AriaNeural",
      rate: payload.rate || "+0%",
      pitch: payload.pitch || "+0Hz",
    });
    sendJson(res, reply.ok ? 200 : 502, reply);
  } catch (e) {
    sendJson(res, 502, { ok: false, error: e?.message || String(e) });
  }
}

async function handleTtsVoices(_req, res) {
  try {
    const reply = await runSidecar(TTS_SCRIPT, { op: "voices" });
    sendJson(res, reply.ok ? 200 : 502, reply);
  } catch (e) {
    sendJson(res, 502, { ok: false, error: e?.message || String(e) });
  }
}

async function handleCite(req, res) {
  let payload;
  try {
    payload = JSON.parse((await readBody(req)) || "{}");
  } catch {
    return sendJson(res, 400, { ok: false, error: "invalid JSON" });
  }
  const style = payload.style || "APA";
  try {
    // Accept either a single { paper } or a batch { papers: [...] }.
    if (Array.isArray(payload.papers)) {
      const items = payload.papers.map((p) => citeOne(p, style));
      sendJson(res, 200, { ok: true, style, items });
    } else if (payload.paper) {
      sendJson(res, 200, { ok: true, ...citeOne(payload.paper, style) });
    } else {
      sendJson(res, 400, { ok: false, error: "provide `paper` or `papers`" });
    }
  } catch (e) {
    sendJson(res, 500, { ok: false, error: e?.message || String(e) });
  }
}

// ---------- dispatch ----------

const server = http.createServer((req, res) => {
  cors(res);
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  const url = (req.url || "").split("?")[0];

  if (req.method === "GET" && url === "/health") {
    return sendJson(res, 200, { ok: true });
  }
  // Styles list is public (no secret, drives the client's cite picker).
  if (req.method === "GET" && url === "/v1/cite/styles") {
    return sendJson(res, 200, { ok: true, styles: CITE_STYLE_OPTIONS });
  }

  // Everything below is authenticated.
  if (!authorized(req)) {
    res.writeHead(401);
    res.end("Unauthorized");
    return;
  }

  if (req.method === "POST" && url === "/v1/agent") return handleAgent(req, res);
  if (req.method === "POST" && url === "/v1/tts/speak") return void handleTtsSpeak(req, res);
  if (req.method === "GET" && url === "/v1/tts/voices") return void handleTtsVoices(req, res);
  if (req.method === "POST" && url === "/v1/cite") return void handleCite(req, res);

  res.writeHead(404);
  res.end("Not found");
});

server.listen(PORT, () => {
  console.log(`Marginalia AI backend listening on :${PORT}`);
  console.log(`  agent script: ${AGENT_SCRIPT}`);
  console.log(`  tts script:   ${TTS_SCRIPT}`);
  console.log(`  auth: ${TOKEN ? "Bearer token required" : "OPEN (set MARG_TOKEN!)"}`);
});
