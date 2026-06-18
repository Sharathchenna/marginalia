// Semantic-search client: thin wrappers over the Rust embedding commands plus
// the text we feed Voyage per paper. No-ops gracefully in the browser (the
// commands are native-only) so the lexical path keeps working everywhere.
import { invoke, isTauri } from "./tauri";
import type { Paper } from "../types";

export interface EmbedStatus {
  embedded: number;
  model: string;
  hasKey: boolean;
}

export interface ScoredId {
  id: string;
  score: number;
}

// What we embed for a paper: identity + topic signal + a slice of the body.
export function buildEmbedText(p: Paper): string {
  return [
    p.title,
    (p.concepts ?? []).join(", "),
    p.tags.join(", "),
    p.abstract || p.summary || "",
    (p.fulltext ?? "").slice(0, 4000),
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 16000);
}

export async function embeddingStatus(): Promise<EmbedStatus> {
  if (!isTauri()) return { embedded: 0, model: "", hasKey: false };
  try {
    return await invoke<EmbedStatus>("embedding_status");
  } catch {
    return { embedded: 0, model: "", hasKey: false };
  }
}

export async function embedPapers(
  items: { id: string; text: string }[],
): Promise<{ embedded: number; skipped: number; total: number }> {
  return invoke("embed_papers", { items });
}

export async function semanticSearch(query: string, k = 16): Promise<ScoredId[]> {
  if (!isTauri()) return [];
  try {
    return await invoke<ScoredId[]>("semantic_search", { query, k });
  } catch {
    return [];
  }
}

export async function similarPapers(id: string, k = 5): Promise<ScoredId[]> {
  if (!isTauri()) return [];
  try {
    return await invoke<ScoredId[]>("similar_papers", { id, k });
  } catch {
    return [];
  }
}
