// Client for the Claude Agent SDK sidecar. Invokes the Rust `ai_chat` command
// and listens for `agent-event` events (tagged with our requestId), forwarding
// delta/metadata/done/error to handlers. Supports chat, summarize, and extract.
import type { Paper } from "../types";
import { invoke, isTauri } from "./tauri";

export function isAgentAvailable(): boolean {
  return isTauri();
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

let counter = 0;

// The model every AI call uses, set once from the store ("" = the SDK/account
// default). Injected into each payload so we don't thread it through call sites.
let currentModel = "";
export function setAgentModel(model: string): void {
  currentModel = model || "";
}

async function runAgent(
  payload: Record<string, unknown>,
  handlers: ChatHandlers,
): Promise<() => void> {
  if (currentModel && payload.model === undefined) payload = { model: currentModel, ...payload };
  if (!isTauri()) {
    handlers.onError?.(
      "AI runs through the native sidecar — launch the desktop app (not the web preview).",
    );
    return () => {};
  }

  const requestId = `${Date.now()}-${++counter}`;
  const { listen } = await import("@tauri-apps/api/event");

  let unlisten = () => {};
  const cleanup = () => unlisten();

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
        handlers.onDone?.({
          cost: (p.cost as number) ?? null,
          model: (p.model as string) ?? null,
        });
        cleanup();
        break;
      case "error":
        handlers.onError?.(String(p.error ?? "Unknown error"));
        cleanup();
        break;
      case "closed":
        cleanup();
        break;
    }
  });

  try {
    await invoke("ai_chat", { requestId, payload });
  } catch (err) {
    handlers.onError?.(err instanceof Error ? err.message : String(err));
    cleanup();
  }
  return cleanup;
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
