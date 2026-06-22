// Reading-progress helpers. Progress = last page read / total pages, both cached
// on the paper by the reader. Returns null when we don't yet know enough.
import type { Paper } from "../types";

export function readingProgress(p: Paper): number | null {
  if (!p.pages || p.pages < 1) return null;
  const page = p.lastPage ?? 0;
  if (page <= 0) return null;
  return Math.max(0, Math.min(1, page / p.pages));
}

export function readingPct(p: Paper): number | null {
  const r = readingProgress(p);
  return r === null ? null : Math.round(r * 100);
}
