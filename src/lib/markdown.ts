// Obsidian-flavoured Markdown export for papers: YAML frontmatter, metadata,
// abstract, AI summary, highlights (as quotes), notes, and [[wikilinks]] to
// related papers. Native writes files into <library>/Marginalia Notes/;
// the browser downloads them.
import type { Paper } from "../types";
import { invoke, isTauri } from "./tauri";

function safeName(title: string): string {
  return (
    title
      .replace(/[\\/:*?"<>|]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120) || "Untitled"
  );
}

// Short stable suffix from the paper id so two papers with the same (or
// same-after-truncation) title don't collide on one filename / wikilink.
function shortHash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36).slice(0, 5).padStart(4, "0");
}

// Deterministic note filename (without extension) — used for both the file and
// any [[wikilink]] pointing at it, so links always resolve.
function noteName(p: Paper): string {
  return `${safeName(p.title)} ${shortHash(p.id)}`;
}

export function paperToMarkdown(p: Paper, all: Paper[]): string {
  const fm: string[] = [
    "---",
    `title: "${(p.title || "").replace(/"/g, '\\"')}"`,
    `authors: "${(p.authorsFull || p.authors || "").replace(/"/g, '\\"')}"`,
    `year: ${p.year || ""}`,
    `venue: "${(p.venue || "").replace(/"/g, '\\"')}"`,
    p.doi && p.doi !== "—" ? `doi: ${p.doi}` : null,
    p.arxiv && p.arxiv !== "—" ? `arxiv: ${p.arxiv}` : null,
    `status: ${p.status ?? (p.read ? "done" : "unread")}`,
    `tags: [${p.tags.map((t) => t.replace(/\s+/g, "-")).join(", ")}]`,
    "---",
    "",
  ].filter((x): x is string => x !== null);

  const lines: string[] = [...fm, `# ${p.title}`, ""];
  if (p.authorsFull || p.authors) lines.push(`*${p.authorsFull || p.authors}*`, "");
  const meta = [p.venue, p.year ? String(p.year) : "", p.arxiv !== "—" ? `arXiv:${p.arxiv}` : ""]
    .filter(Boolean)
    .join(" · ");
  if (meta) lines.push(meta, "");

  if (p.abstract) lines.push("## Abstract", "", p.abstract, "");
  if (p.summary) lines.push("## Summary", "", p.summary, "");

  if (p.hl.length) {
    lines.push("## Highlights", "");
    for (const h of p.hl) {
      lines.push(`> ${h.text}  *(p.${h.page})*`);
      if (h.note) lines.push(`> — ${h.note}`);
      lines.push("");
    }
  }

  if (p.notes) lines.push("## Notes", "", p.notes, "");

  if (p.related?.length) {
    lines.push("## Related", "");
    for (const id of p.related) {
      const r = all.find((x) => x.id === id);
      if (r) lines.push(`- [[${noteName(r)}]]`);
    }
    lines.push("");
  }

  if (p.tags.length) lines.push(p.tags.map((t) => `#${t.replace(/\s+/g, "-")}`).join(" "), "");

  return lines.join("\n");
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

const SUBDIR = "Marginalia Notes";

export async function exportPaper(p: Paper, all: Paper[], libDir: string): Promise<string> {
  const md = paperToMarkdown(p, all);
  const file = `${noteName(p)}.md`;
  if (isTauri() && libDir) {
    const path = `${libDir.replace(/\/+$/, "")}/${SUBDIR}/${file}`;
    await invoke("write_text_file", { path, contents: md });
    return `${SUBDIR}/${file}`;
  }
  download(file, md);
  return file;
}

export async function exportLibrary(papers: Paper[], libDir: string): Promise<number> {
  if (isTauri() && libDir) {
    for (const p of papers) {
      const path = `${libDir.replace(/\/+$/, "")}/${SUBDIR}/${noteName(p)}.md`;
      await invoke("write_text_file", { path, contents: paperToMarkdown(p, papers) });
    }
    return papers.length;
  }
  // browser: one combined file
  download(
    "marginalia-notes.md",
    papers.map((p) => paperToMarkdown(p, papers)).join("\n\n---\n\n"),
  );
  return papers.length;
}
