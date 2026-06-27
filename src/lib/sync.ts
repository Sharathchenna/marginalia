// Per-record sync against the self-hosted data server (server-rs: GET /v1/sync +
// CRUD). The server is the source of truth; the desktop keeps its local SQLite and
// pushes/pulls deltas (last-writer-wins on `updatedTs`, with tombstones). Same
// server the iOS app uses — base derived from the AI-backend URL, port 8443.
import type { Collection, Paper } from "../types";

export function serverBase(apiUrl?: string): string | null {
  const t = (apiUrl ?? "").trim();
  if (!t) return null;
  try {
    const u = new URL(t);
    u.port = "8443";
    u.pathname = "";
    u.search = "";
    return u.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

export interface Pulled {
  serverTs: number;
  papers: Paper[];
  collections: Collection[] | null;
  collectionsTs: number | null;
  feeds: unknown[] | null;
  feedsTs: number | null;
}

function headers(token: string): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h["Authorization"] = `Bearer ${token}`;
  return h;
}

export async function pull(base: string, token: string, since: number): Promise<Pulled> {
  const res = await fetch(`${base}/v1/sync?since=${Math.floor(since)}`, { headers: headers(token) });
  if (!res.ok) throw new Error(`Sync server error (${res.status})`);
  return res.json() as Promise<Pulled>;
}

export async function pushPaper(base: string, token: string, p: Paper): Promise<void> {
  const res = await fetch(`${base}/v1/papers`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify(p),
  });
  if (!res.ok) throw new Error(`Push error (${res.status})`);
}

export async function deletePaper(base: string, token: string, id: string): Promise<void> {
  await fetch(`${base}/v1/papers/${encodeURIComponent(id)}`, { method: "DELETE", headers: headers(token) });
}

export async function putCollections(base: string, token: string, c: Collection[]): Promise<void> {
  await fetch(`${base}/v1/collections`, { method: "PUT", headers: headers(token), body: JSON.stringify(c) });
}

/// LWW merge of a server pull into the local papers (tombstones removed).
export function mergePapers(local: Paper[], remote: Paper[]): Paper[] {
  const map = new Map(local.map((p) => [p.id, p]));
  for (const rp of remote) {
    if (rp.deleted) {
      map.delete(rp.id);
      continue;
    }
    const l = map.get(rp.id);
    if (l && (l.updatedTs ?? 0) > (rp.updatedTs ?? 0)) continue; // local is newer
    map.set(rp.id, rp);
  }
  return [...map.values()].filter((p) => !p.deleted).sort((a, b) => b.addedTs - a.addedTs);
}
