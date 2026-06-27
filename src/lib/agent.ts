// Client for the Claude Agent SDK sidecar. Invokes the Rust `ai_chat` command
// and listens for `agent-event` events (tagged with our requestId), forwarding
// delta/metadata/done/error to handlers. Supports chat, summarize, and extract.
import type { Paper } from "../types";
import { invoke, isMobilePlatform, isTauri } from "./tauri";

// Optional self-hosted AI backend (see server/). When configured, all AI runs
// through it over HTTPS — which is how iOS and the web build get AI (no local
// Node sidecar). Set from the store; mirrors setAgentModel.
let apiUrl = "";
let apiToken = "";
export function setAgentBackend(url: string, token: string): void {
  apiUrl = (url || "").trim().replace(/\/+$/, "");
  apiToken = (token || "").trim();
}

// AI is available if a backend is configured, or on desktop (local sidecar).
// On mobile Tauri there's no sidecar, so a backend is required.
export function isAgentAvailable(): boolean {
  return !!apiUrl || (isTauri() && !isMobilePlatform());
}

// Selectable models for AI actions. "" means the SDK/account default.
export const AGENT_MODELS: { id: string; label: string }[] = [
  { id: "", label: "Default" },
  { id: "claude-opus-4-8", label: "Opus 4.8" },
  { id: "claude-sonnet-4-6", label: "Sonnet 4.6" },
  { id: "claude-haiku-4-5", label: "Haiku 4.5" },
];

export interface ChatHandlers {
  onDelta?: (text: string) => void;
  onMetadata?: (data: Record<string, unknown>) => void;
  onTags?: (data: AutoTagResult) => void;
  onVerdict?: (data: AssessResult) => void;
  onThinkingStart?: () => void;
  onThinking?: (text: string) => void;
  onTool?: (info: { name?: string; phase: "start" | "done" }) => void;
  onDone?: (info: { cost: number | null; model: string | null }) => void;
  onError?: (message: string) => void;
}

export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
}

export interface AutoTagResult {
  tags?: string[];
  category?: string;
  concepts?: string[];
  authorsShort?: string;
  authorsFull?: string;
  year?: number | string;
  venue?: string;
}

// Claim verification / systematic-review screening result.
export type AssessTask = "verify" | "screen";
export interface AssessItem {
  id: string;
  /** verify: supports|contradicts|neutral · screen: include|exclude|maybe */
  stance: string;
  evidence: string;
}
export interface AssessResult {
  summary: string;
  items: AssessItem[];
}
export interface AssessPaper {
  id: string;
  title: string;
  authors: string;
  year: number;
  abstract: string;
  summary?: string;
}

let counter = 0;

// The model every AI call uses, set once from the store ("" = the SDK/account
// default). Injected into each payload so we don't thread it through call sites.
let currentModel = "";
export function setAgentModel(model: string): void {
  currentModel = model || "";
}

// Apply one streamed agent event to the handlers. Shared by the local (Tauri
// event) and remote (HTTP/SSE) transports. Returns true if terminal.
function applyAgentEvent(p: Record<string, unknown>, handlers: ChatHandlers): boolean {
  switch (p.type) {
    case "delta":
      handlers.onDelta?.(String(p.text ?? ""));
      return false;
    case "metadata":
      handlers.onMetadata?.((p.data as Record<string, unknown>) ?? {});
      return false;
    case "tags":
      handlers.onTags?.((p.data as AutoTagResult) ?? {});
      return false;
    case "verdict":
      handlers.onVerdict?.((p.data as AssessResult) ?? { summary: "", items: [] });
      return false;
    case "thinking_start":
      handlers.onThinkingStart?.();
      return false;
    case "thinking":
      handlers.onThinking?.(String(p.text ?? ""));
      return false;
    case "tool":
      handlers.onTool?.({
        name: p.name as string | undefined,
        phase: (p.phase as "start" | "done") ?? "start",
      });
      return false;
    case "done":
      if (p.isError) handlers.onError?.(String(p.error ?? "The model reported an error."));
      else handlers.onDone?.({ cost: (p.cost as number) ?? null, model: (p.model as string) ?? null });
      return true;
    case "error":
      handlers.onError?.(String(p.error ?? "Unknown error"));
      return true;
    default:
      return false;
  }
}

// Remote transport: POST the payload to the self-hosted backend and parse its
// SSE stream of agent events. Works on iOS, web, and desktop.
async function runAgentRemote(
  payload: Record<string, unknown>,
  handlers: ChatHandlers,
): Promise<() => void> {
  const ctrl = new AbortController();
  let settled = false;
  void (async () => {
    try {
      const res = await fetch(`${apiUrl}/v1/agent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(apiToken ? { Authorization: `Bearer ${apiToken}` } : {}),
        },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) {
        handlers.onError?.(`AI backend error (${res.status}). Check the URL and token in Settings.`);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let sep: number;
        // SSE events are separated by a blank line; each carries a `data:` line.
        while ((sep = buf.indexOf("\n\n")) >= 0) {
          const evt = buf.slice(0, sep);
          buf = buf.slice(sep + 2);
          for (const line of evt.split("\n")) {
            const data = line.replace(/^data:\s?/, "").trim();
            if (!data) continue;
            try {
              if (applyAgentEvent(JSON.parse(data), handlers)) settled = true;
            } catch {
              /* keep-alive / non-JSON line */
            }
          }
        }
      }
      if (!settled) handlers.onError?.("The AI backend closed the stream unexpectedly.");
    } catch (e) {
      if (!ctrl.signal.aborted) handlers.onError?.(e instanceof Error ? e.message : String(e));
    }
  })();
  return () => ctrl.abort();
}

async function runAgent(
  payload: Record<string, unknown>,
  handlers: ChatHandlers,
): Promise<() => void> {
  if (currentModel && payload.model === undefined) payload = { model: currentModel, ...payload };
  // A configured backend wins (and is the only option on iOS / web).
  if (apiUrl) return runAgentRemote(payload, handlers);
  if (!isTauri() || isMobilePlatform()) {
    handlers.onError?.(
      "AI needs a backend. Set an AI backend URL in Settings, or use the desktop app.",
    );
    return () => {};
  }

  const requestId = `${Date.now()}-${++counter}`;
  const { listen } = await import("@tauri-apps/api/event");

  let unlisten = () => {};
  let settled = false; // did we see a terminal done/error yet?
  const teardown = () => unlisten();
  // Returned to the caller: stop listening AND ask the backend to kill the
  // sidecar so a long/looping turn stops accruing cost.
  const cancel = () => {
    teardown();
    void invoke("ai_cancel", { requestId }).catch(() => {});
  };

  unlisten = await listen<Record<string, unknown>>("agent-event", (e) => {
    const p = e.payload;
    if (!p || p.requestId !== requestId) return;
    switch (p.type) {
      case "delta":
        handlers.onDelta?.(String(p.text ?? ""));
        break;
      case "metadata":
        handlers.onMetadata?.((p.data as Record<string, unknown>) ?? {});
        break;
      case "tags":
        handlers.onTags?.((p.data as AutoTagResult) ?? {});
        break;
      case "verdict":
        handlers.onVerdict?.((p.data as AssessResult) ?? { summary: "", items: [] });
        break;
      case "thinking_start":
        handlers.onThinkingStart?.();
        break;
      case "thinking":
        handlers.onThinking?.(String(p.text ?? ""));
        break;
      case "tool":
        handlers.onTool?.({
          name: p.name as string | undefined,
          phase: (p.phase as "start" | "done") ?? "start",
        });
        break;
      case "done":
        settled = true;
        // the SDK can finish with an error result — surface it, don't pretend success
        if (p.isError) {
          handlers.onError?.(String(p.error ?? "The model reported an error."));
        } else {
          handlers.onDone?.({
            cost: (p.cost as number) ?? null,
            model: (p.model as string) ?? null,
          });
        }
        teardown();
        break;
      case "error":
        settled = true;
        handlers.onError?.(String(p.error ?? "Unknown error"));
        teardown();
        break;
      case "closed":
        // process exited without a done/error (crash, OOM, non-JSON output) —
        // don't leave the caller hanging forever.
        if (!settled) {
          settled = true;
          handlers.onError?.(
            String(p.error ?? "The AI process ended unexpectedly. Check that Node 18+ is installed and you're signed in."),
          );
        }
        teardown();
        break;
    }
  });

  try {
    await invoke("ai_chat", { requestId, payload });
  } catch (err) {
    settled = true;
    handlers.onError?.(err instanceof Error ? err.message : String(err));
    teardown();
  }
  return cancel;
}

export function chatAboutPaper(
  paper: Paper,
  question: string,
  history: ChatTurn[],
  handlers: ChatHandlers,
  pdfPath?: string,
  selection?: string,
): Promise<() => void> {
  return runAgent({ mode: "chat", question, paper, history, pdfPath, selection }, handlers);
}

export interface LibraryContext {
  title: string;
  authors: string;
  year: number;
  venue: string;
  abstract: string;
  summary?: string;
}

export function askLibrary(
  papers: LibraryContext[],
  question: string,
  history: ChatTurn[],
  handlers: ChatHandlers,
): Promise<() => void> {
  return runAgent({ mode: "library", papers, question, history }, handlers);
}

export function summarizePaper(
  paper: Paper,
  pdfPath: string | undefined,
  handlers: ChatHandlers,
): Promise<() => void> {
  return runAgent({ mode: "summarize", paper, pdfPath }, handlers);
}

// Auto-categorize a paper: returns suggested tags (preferring the given vocab)
// plus best-effort authors/venue/year (read from the PDF when a path is given).
export function autoTag(paper: Paper, vocab: string[], pdfPath?: string): Promise<AutoTagResult> {
  return new Promise((resolve, reject) => {
    let got: AutoTagResult | null = null;
    runAgent(
      { mode: "tag", paper, vocab, pdfPath },
      {
        onTags: (data) => {
          got = data;
        },
        onDone: () => (got?.tags ? resolve(got) : reject(new Error("No tags returned."))),
        onError: (msg) => reject(new Error(msg)),
      },
    );
  });
}

// Verify a claim (or screen for a review) against a set of papers. Resolves with
// a structured per-paper verdict.
export function assessLibrary(
  task: AssessTask,
  statement: string,
  papers: AssessPaper[],
): Promise<AssessResult> {
  return new Promise((resolve, reject) => {
    let got: AssessResult | null = null;
    runAgent(
      { mode: "assess", task, statement, papers },
      {
        onVerdict: (data) => {
          got = data;
        },
        onDone: () => (got?.items ? resolve(got) : reject(new Error("No assessment returned."))),
        onError: (msg) => reject(new Error(msg)),
      },
    );
  });
}

// Extract metadata from a PDF; resolves with the parsed fields or rejects.
export function extractMetadata(
  pdfPath: string,
  paper?: Paper,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let got: Record<string, unknown> | null = null;
    runAgent(
      { mode: "extract", pdfPath, paper },
      {
        onMetadata: (data) => {
          got = data;
        },
        onDone: () => (got ? resolve(got) : reject(new Error("No metadata returned."))),
        onError: (msg) => reject(new Error(msg)),
      },
    );
  });
}
