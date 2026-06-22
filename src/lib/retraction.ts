// Retraction checks via Crossref (which hosts the full Retraction Watch DB).
// Privacy-preserving: only a single DOI is ever sent per query. Native delegates
// to Rust (reqwest); web hits the proxied Crossref API directly.
import type { Retraction } from "../types";
import { invoke, isTauri } from "./tauri";

const NOTICE_KINDS = new Set([
  "retraction",
  "withdrawal",
  "removal",
  "partial_retraction",
  "expression_of_concern",
]);

function titleCase(s: string): string {
  return s
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

// Extract a retraction notice from a Crossref work message, if present.
function fromMessage(m: unknown): Retraction | null {
  const updatedBy = (m as { "updated-by"?: unknown })?.["updated-by"];
  if (!Array.isArray(updatedBy)) return null;
  for (const u of updatedBy) {
    const type = String(u?.type ?? "").toLowerCase();
    if (!NOTICE_KINDS.has(type)) continue;
    const dateTime: string | undefined = u?.updated?.["date-time"];
    const year = u?.updated?.["date-parts"]?.[0]?.[0];
    const date = dateTime ? dateTime.split("T")[0] : year ? String(year) : "";
    const notice = String(u?.DOI ?? "");
    return {
      type,
      reason: String(u?.label || titleCase(type)),
      date,
      url: notice ? `https://doi.org/${notice}` : "",
    };
  }
  return null;
}

// Resolve a DOI's retraction status. Returns null when not retracted (or the DOI
// is unusable / the lookup fails — callers treat null as "clear").
export async function checkRetraction(doi: string): Promise<Retraction | null> {
  const id = (doi || "").trim();
  if (!id || id === "—") return null;
  try {
    if (isTauri()) {
      const r = await invoke<{ retracted: boolean } & Retraction>("check_retraction", {
        doi: id,
      });
      return r?.retracted ? { type: r.type, reason: r.reason, date: r.date, url: r.url } : null;
    }
    const res = await fetch(`/crossref/works/${encodeURIComponent(id)}`);
    if (!res.ok) return null;
    const data = await res.json();
    return fromMessage(data.message);
  } catch {
    return null;
  }
}
