// Claude Agent SDK sidecar for Marginalia.
//
// Invoked once per chat turn by the Tauri (Rust) backend. Reads a single JSON
// payload on stdin, runs an agent turn, and streams JSON-lines events on stdout.
// Every event we emit carries `__marg: true` so the Rust side can ignore any
// unrelated logging the SDK might print.
//
// Auth is resolved by the SDK from the environment (a logged-in Claude Code
// session or ANTHROPIC_API_KEY). We do not set or extract any credentials here.

import { query } from "@anthropic-ai/claude-agent-sdk";
import { homedir } from "node:os";
import { dirname } from "node:path";

// A Finder-launched macOS app has a minimal PATH, so when the Agent SDK spawns
// its own `node` child (the Claude Code process) bare `node` can fail with
// ENOENT. Guarantee the directory of the node binary running THIS sidecar — plus
// the usual install dirs — are on PATH so that inner spawn always resolves.
{
  const want = [dirname(process.execPath), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"];
  const have = (process.env.PATH || "").split(":").filter(Boolean);
  process.env.PATH = [...want.filter((d) => d && !have.includes(d)), ...have].join(":");
}

function expandHome(p) {
  return p && p.startsWith("~/") ? homedir() + p.slice(1) : p;
}

function emit(event) {
  process.stdout.write(JSON.stringify({ __marg: true, ...event }) + "\n");
}

async function readStdin() {
  let input = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) input += chunk;
  return input;
}

function buildSystemPrompt(paper, pdfPath) {
  const p = paper || {};
  const meta = [
    p.title && `Title: ${p.title}`,
    p.authorsFull && `Authors: ${p.authorsFull}`,
    (p.venue || p.year) && `Venue/Year: ${[p.venue, p.year].filter(Boolean).join(", ")}`,
    (p.doi && p.doi !== "—") && `DOI: ${p.doi}`,
    (p.arxiv && p.arxiv !== "—") && `arXiv: ${p.arxiv}`,
    p.tags?.length && `Tags: ${p.tags.join(", ")}`,
    p.abstract && `\nAbstract:\n${p.abstract}`,
    p.notes && `\nThe user's notes:\n${p.notes}`,
  ]
    .filter(Boolean)
    .join("\n");

  const lines = [
    "You are a research assistant inside Marginalia, a paper manager.",
    "The user wants to discuss the following paper. Answer their questions clearly and concisely.",
  ];
  if (pdfPath) {
    lines.push(
      `The full PDF is on disk at: ${pdfPath}`,
      "Use the Read tool to read it whenever the question needs the paper's actual content",
      "(method, results, equations, specific claims). Read it before answering such questions",
      "rather than guessing. For simple metadata questions the info below may be enough.",
    );
  } else {
    lines.push(
      "If something isn't covered by the metadata/abstract below, say so rather than inventing details.",
    );
  }
  lines.push("", "=== PAPER ===", meta || "(no metadata available)");
  return lines.join("\n");
}

function renderConversation(history, question) {
  const turns = (history || [])
    .map((m) => `${m.role === "assistant" ? "Assistant" : "User"}: ${m.text}`)
    .join("\n\n");
  return turns ? `${turns}\n\nUser: ${question}` : question;
}

async function main() {
  let payload;
  try {
    payload = JSON.parse(await readStdin());
  } catch (e) {
    emit({ type: "error", error: "Bad request payload: " + e.message });
    return;
  }

  const { paper, history, model } = payload;
  const mode = payload.mode || "chat"; // chat | summarize | extract
  const pdfPath = expandHome(payload.pdfPath);

  if (mode === "extract") {
    await runExtract(pdfPath, model);
    return;
  }

  if (mode === "library") {
    await runLibraryChat(payload, model);
    return;
  }

  if (mode === "tag") {
    await runTag(payload, model);
    return;
  }

  const question =
    mode === "summarize"
      ? "Summarize this paper for my library."
      : payload.question;
  if (!question || typeof question !== "string") {
    emit({ type: "error", error: "Missing 'question'." });
    return;
  }

  let system =
    mode === "summarize"
      ? buildSummarySystemPrompt(paper, pdfPath)
      : buildSystemPrompt(paper, pdfPath);

  if (mode === "chat" && payload.selection) {
    system +=
      "\n\n=== FOCUS PASSAGE (the user selected this text in the PDF) ===\n" +
      `"${payload.selection}"\n` +
      "Ground your answers in this passage. Use the Read tool on the full PDF" +
      (pdfPath ? ` at ${pdfPath}` : "") +
      " for surrounding context — the section it's in, definitions, and anything" +
      " it references — when that helps answer the question.";
  }

  const options = {
    systemPrompt: system,
    // Allow only Read (pre-approved) when we have a PDF; deny everything else
    // silently so a headless turn never blocks on a permission prompt.
    allowedTools: pdfPath ? ["Read"] : [],
    permissionMode: "dontAsk",
    settingSources: [], // don't pull in project CLAUDE.md / settings
    maxTurns: pdfPath ? 6 : 1, // allow a read → answer loop
    // Stream raw deltas so the UI can show tokens, thinking, and tool use live.
    includePartialMessages: true,
  };
  if (pdfPath) options.cwd = dirname(pdfPath);
  if (model) options.model = model;

  let streamedText = false;
  try {
    for await (const message of query({
      prompt: mode === "summarize" ? question : renderConversation(history, question),
      options,
    })) {
      // Live, token-level events (requires includePartialMessages).
      if (message.type === "stream_event") {
        const ev = message.event;
        if (ev?.type === "content_block_start") {
          const cb = ev.content_block;
          if (cb?.type === "tool_use") emit({ type: "tool", name: cb.name || "tool", phase: "start" });
          else if (cb?.type === "thinking") emit({ type: "thinking_start" });
        } else if (ev?.type === "content_block_delta") {
          const d = ev.delta;
          if (d?.type === "text_delta" && d.text) {
            streamedText = true;
            emit({ type: "delta", text: d.text });
          } else if (d?.type === "thinking_delta" && d.thinking) {
            emit({ type: "thinking", text: d.thinking });
          }
        }
        continue;
      }
      // A tool finished (its result came back).
      if (message.type === "user") {
        const blocks = message.message?.content;
        if (Array.isArray(blocks) && blocks.some((b) => b.type === "tool_result")) {
          emit({ type: "tool", phase: "done" });
        }
        continue;
      }
      // Fallback: if partial streaming didn't fire, emit the full assistant text.
      if (message.type === "assistant") {
        if (!streamedText) {
          for (const b of message.message?.content ?? []) {
            if (b.type === "text" && b.text) {
              streamedText = true;
              emit({ type: "delta", text: b.text });
            }
          }
        }
        continue;
      }
      if (message.type === "result") {
        if (!streamedText && typeof message.result === "string") {
          emit({ type: "delta", text: message.result });
        }
        emit({
          type: "done",
          cost: message.total_cost_usd ?? null,
          isError: !!message.is_error,
          model: message.model ?? model ?? null,
        });
        return;
      }
    }
    emit({ type: "done", cost: null, isError: false, model: model ?? null });
  } catch (err) {
    emit({ type: "error", error: err?.message ? String(err.message) : String(err) });
  }
}

function buildSummarySystemPrompt(paper, pdfPath) {
  const base = buildSystemPrompt(paper, pdfPath);
  return [
    base,
    "",
    "Produce a concise structured summary in Markdown with these sections:",
    "**TL;DR** (1–2 sentences), **Key contributions** (bullets),",
    "**Method** (2–3 sentences), **Results** (bullets), **Limitations** (bullets).",
    "Read the PDF first if a path was provided. Be specific and faithful to the paper.",
  ].join("\n");
}

function parseJsonLoose(text) {
  if (!text) return null;
  let t = text.trim();
  // strip code fences
  t = t.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start < 0 || end < 0) return null;
  try {
    return JSON.parse(t.slice(start, end + 1));
  } catch {
    return null;
  }
}

async function runLibraryChat(payload, model) {
  const { question, history, papers } = payload;
  if (!question) {
    emit({ type: "error", error: "Missing 'question'." });
    return;
  }
  const list = (papers || [])
    .map((p, i) => {
      const bits = [
        `[${i + 1}] ${p.title}`,
        p.authors && `    ${p.authors}${p.year ? ", " + p.year : ""}${p.venue ? " · " + p.venue : ""}`,
        p.abstract && `    Abstract: ${p.abstract}`,
        p.summary && `    Summary: ${p.summary}`,
      ].filter(Boolean);
      return bits.join("\n");
    })
    .join("\n\n");

  const systemPrompt = [
    "You are a research assistant for the user's personal paper library (Marginalia).",
    "Answer questions across the papers below — comparisons, which papers address a topic,",
    "synthesis, gaps. Cite papers by their title (and [number]) when relevant.",
    "If the library doesn't contain relevant work, say so. Be concise and specific.",
    "",
    "=== LIBRARY ===",
    list || "(empty library)",
  ].join("\n");

  const options = {
    systemPrompt,
    allowedTools: [],
    permissionMode: "dontAsk",
    settingSources: [],
    maxTurns: 1,
  };
  if (model) options.model = model;

  let streamed = false;
  try {
    for await (const message of query({ prompt: renderConversation(history, question), options })) {
      if (message.type === "assistant") {
        for (const b of message.message?.content ?? []) {
          if (b.type === "text" && b.text) {
            streamed = true;
            emit({ type: "delta", text: b.text });
          }
        }
      } else if (message.type === "result") {
        if (!streamed && typeof message.result === "string") emit({ type: "delta", text: message.result });
        emit({ type: "done", cost: message.total_cost_usd ?? null, isError: !!message.is_error, model: message.model ?? null });
        return;
      }
    }
    emit({ type: "done", cost: null, isError: false, model: null });
  } catch (err) {
    emit({ type: "error", error: err?.message ? String(err.message) : String(err) });
  }
}

async function runTag(payload, model) {
  const p = payload.paper || {};
  const pdfPath = expandHome(payload.pdfPath);
  const vocab = Array.isArray(payload.vocab) ? payload.vocab : [];

  const meta = [
    p.title && `Title: ${p.title}`,
    p.authorsFull && `Authors: ${p.authorsFull}`,
    (p.venue || p.year) && `Venue/Year: ${[p.venue, p.year].filter(Boolean).join(", ")}`,
    p.abstract && `Abstract: ${p.abstract}`,
  ]
    .filter(Boolean)
    .join("\n");

  const systemPrompt = [
    "You categorize a research paper and identify its authors for a personal library.",
    vocab.length
      ? `Existing tags in the library (PREFER reusing these when they fit): ${vocab.join(", ")}.`
      : "There are no existing tags yet; create a small, clean set.",
    "Add new tags only when an existing one doesn't capture the topic. Tags should be",
    'short noun phrases (e.g. "Reinforcement Learning", "Transformers", "Optimization").',
    "Also identify the authors, year, and venue. authorsShort is the citation form",
    '("Vaswani et al."); authorsFull is the comma-separated full list.',
    'Also list "concepts": 3-8 SPECIFIC named methods, models, datasets, or technical',
    'ideas the paper centres on (e.g. "Self-Attention", "ImageNet", "PPO", "RLHF").',
    "Concepts are precise and shareable across papers — distinct from the broad tags.",
    pdfPath
      ? `Read the PDF at ${pdfPath} to find the authors/venue/year and confirm the topic.`
      : "Use only the metadata below; if a field is unknown, use \"—\" (or [] for tags).",
    'Respond with ONLY a minified JSON object: {"tags": [3-6 strings], "category": "one broad area",',
    '"concepts": [3-8 strings], "authorsShort": string, "authorsFull": string, "year": number, "venue": string}.',
    "",
    "=== PAPER ===",
    meta || "(only a title is available)",
  ]
    .filter(Boolean)
    .join("\n");

  const options = {
    systemPrompt,
    allowedTools: pdfPath ? ["Read"] : [],
    permissionMode: "dontAsk",
    settingSources: [],
    maxTurns: pdfPath ? 6 : 1,
  };
  if (pdfPath) options.cwd = dirname(pdfPath);
  if (model) options.model = model;

  let result = "";
  try {
    for await (const message of query({ prompt: "Categorize this paper as JSON.", options })) {
      if (message.type === "assistant") {
        for (const b of message.message?.content ?? []) if (b.type === "text" && b.text) result += b.text;
      } else if (message.type === "result") {
        if (typeof message.result === "string" && message.result.trim()) result = message.result;
        break;
      }
    }
    const data = parseJsonLoose(result);
    if (!data || !Array.isArray(data.tags)) emit({ type: "error", error: "Could not parse tags." });
    else emit({ type: "tags", data });
    emit({ type: "done", cost: null, isError: !data, model: model ?? null });
  } catch (err) {
    emit({ type: "error", error: err?.message ? String(err.message) : String(err) });
  }
}

async function runExtract(pdfPath, model) {
  if (!pdfPath) {
    emit({ type: "error", error: "Metadata extraction needs a local PDF." });
    return;
  }
  const systemPrompt = [
    "You extract bibliographic metadata from a research-paper PDF.",
    `Read the PDF at: ${pdfPath} (use the Read tool), then respond with ONLY a single`,
    "minified JSON object — no prose, no code fence. Keys:",
    'title (string), authorsShort (string like "Vaswani et al."),',
    "authorsFull (string, comma-separated full names), year (number),",
    'venue (string), doi (string or "—"), arxiv (string or "—"),',
    "abstract (string), tags (array of 3-6 short topical tags).",
    'Use "—" or [] for unknown fields. Output JSON only.',
  ].join("\n");

  const options = {
    systemPrompt,
    allowedTools: ["Read"],
    permissionMode: "dontAsk",
    settingSources: [],
    maxTurns: 6,
    cwd: dirname(pdfPath),
  };
  if (model) options.model = model;

  let result = "";
  try {
    for await (const message of query({ prompt: "Extract the metadata as JSON.", options })) {
      if (message.type === "assistant") {
        for (const b of message.message?.content ?? []) {
          if (b.type === "text" && b.text) result += b.text;
        }
      } else if (message.type === "result") {
        if (typeof message.result === "string" && message.result.trim()) {
          result = message.result;
        }
        break;
      }
    }
    const data = parseJsonLoose(result);
    if (!data) {
      emit({ type: "error", error: "Could not parse extracted metadata." });
    } else {
      emit({ type: "metadata", data });
    }
    emit({ type: "done", cost: null, isError: !data, model: model ?? null });
  } catch (err) {
    emit({ type: "error", error: err?.message ? String(err.message) : String(err) });
  }
}

main();
