// Marginalia AI backend — a tiny self-hostable HTTP/SSE bridge to the Claude
// Agent SDK sidecar (`src-tauri/sidecar/agent.mjs`). It reuses that sidecar
// VERBATIM: per request it spawns `node agent.mjs`, pipes the JSON payload to its
// stdin, and relays its JSON-lines events to the client as Server-Sent Events.
//
// This is how iOS and the web build get AI (no local Node sidecar). The Anthropic
// credentials live here on the server, never on the device.
//
//   ANTHROPIC_API_KEY=sk-...  MARG_TOKEN=your-shared-secret  node server/server.mjs
//
// Env:
//   PORT             (default 8799)
//   MARG_TOKEN       require `Authorization: Bearer <token>` when set (recommended)
//   MARG_CORS_ORIGIN allowed CORS origin for the web build (default "*")
//   AGENT_SCRIPT     path to agent.mjs (default ../src-tauri/sidecar/agent.mjs)
import http from "node:http";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8799);
const TOKEN = process.env.MARG_TOKEN || "";
const ORIGIN = process.env.MARG_CORS_ORIGIN || "*";
const AGENT_SCRIPT = process.env.AGENT_SCRIPT || resolve(here, "../src-tauri/sidecar/agent.mjs");

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", ORIGIN);
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
}

const server = http.createServer((req, res) => {
  cors(res);
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end('{"ok":true}');
    return;
  }
  if (req.method !== "POST" || !req.url.startsWith("/v1/agent")) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }
  if (TOKEN && req.headers["authorization"] !== `Bearer ${TOKEN}`) {
    res.writeHead(401);
    res.end("Unauthorized");
    return;
  }

  let body = "";
  req.on("data", (c) => {
    body += c;
    if (body.length > 8_000_000) req.destroy(); // cap payload
  });
  req.on("end", () => {
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
    // and would kill the agent before it streams anything.
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
});

server.listen(PORT, () => {
  console.log(`Marginalia AI backend listening on :${PORT}`);
  console.log(`  agent script: ${AGENT_SCRIPT}`);
  console.log(`  auth: ${TOKEN ? "Bearer token required" : "OPEN (set MARG_TOKEN!)"}`);
});
