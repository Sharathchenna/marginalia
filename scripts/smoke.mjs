// Runtime smoke test for the pure logic modules (no browser needed).
// Bundles the real TS with esbuild and asserts behavior. Run: node scripts/smoke.mjs
import { build } from "esbuild";

const entry = `
export { searchPapers } from './lib/search';
export { toBibTeX, parseBibliography, exportLibrary, citationText } from './lib/citation';
export { classifyIdentifier } from './lib/metadata';
export { rrfMerge, hitToPaper } from './lib/discover';
export { paperToMarkdown } from './lib/markdown';
export { PAPERS } from './data';
`;

const res = await build({
  stdin: { contents: entry, resolveDir: process.cwd() + "/src", loader: "ts" },
  bundle: true,
  format: "esm",
  write: false,
  platform: "neutral",
  external: ["@tauri-apps/api/core", "@tauri-apps/api/event"],
});
const m = await import(
  "data:text/javascript," + encodeURIComponent(res.outputFiles[0].text)
);

let pass = 0,
  fail = 0;
const ok = (name, cond) => {
  if (cond) {
    pass++;
    console.log("  ✓ " + name);
  } else {
    fail++;
    console.error("  ✗ " + name);
  }
};

// --- search (Phase 4) ---
const s1 = m.searchPapers(m.PAPERS, "attention");
ok("search 'attention' → Attention paper first", s1[0]?.paper.id === "attention");
const s2 = m.searchPapers(m.PAPERS, "reinforcement");
ok("search 'reinforcement' matches RL papers", s2.length >= 1 && s2.every((h) => h.score > 0));
ok("search AND semantics: 'attention quantum' → none", m.searchPapers(m.PAPERS, "attention quantum").length === 0);
ok("empty query returns all", m.searchPapers(m.PAPERS, "").length === m.PAPERS.length);

// --- citations (Phase 5) ---
const bib = m.toBibTeX(m.PAPERS[0]);
ok("BibTeX has @inproceedings + title", bib.includes("@inproceedings") && bib.includes("Attention Is All You Need"));
const roundTrip = m.parseBibliography(bib);
ok("BibTeX round-trips title", roundTrip[0]?.title === "Attention Is All You Need");
ok("BibTeX round-trips year", roundTrip[0]?.year === 2017);
const ris = m.exportLibrary(m.PAPERS.slice(0, 3), "ris");
const fromRis = m.parseBibliography(ris);
ok("RIS export+import preserves count", fromRis.length === 3);
ok("APA text contains year", m.citationText(m.PAPERS[0], "APA").includes("2017"));

// --- identifier classification (Phase 2) ---
ok("arXiv prefix", JSON.stringify(m.classifyIdentifier("arXiv:1706.03762")) === JSON.stringify({ type: "arxiv", id: "1706.03762" }));
ok("bare arXiv w/ version", m.classifyIdentifier("2310.06825v2").id === "2310.06825");
ok("arXiv abs URL", m.classifyIdentifier("https://arxiv.org/abs/2310.06825").id === "2310.06825");
ok("DOI", JSON.stringify(m.classifyIdentifier("10.1038/nature16961")) === JSON.stringify({ type: "doi", id: "10.1038/nature16961" }));
ok("arXiv-minted DOI → arxiv", m.classifyIdentifier("10.48550/arXiv.1706.03762").type === "arxiv");
ok("HF papers URL → arxiv", JSON.stringify(m.classifyIdentifier("https://huggingface.co/papers/2310.06825")) === JSON.stringify({ type: "arxiv", id: "2310.06825" }));
ok("HF model URL → hf model", JSON.stringify(m.classifyIdentifier("huggingface.co/mistralai/Mistral-7B-v0.1")) === JSON.stringify({ type: "hf", id: "mistralai/Mistral-7B-v0.1", hfType: "model" }));
ok("HF dataset URL → hf dataset", JSON.stringify(m.classifyIdentifier("https://huggingface.co/datasets/squad/tree/main")) === JSON.stringify({ type: "hf", id: "squad", hfType: "dataset" }));
ok("HF repo PDF (blob → resolve)", JSON.stringify(m.classifyIdentifier("https://huggingface.co/deepseek-ai/DeepSeek-V4-Pro/blob/main/DeepSeek_V4.pdf")) === JSON.stringify({ type: "pdf", url: "https://huggingface.co/deepseek-ai/DeepSeek-V4-Pro/resolve/main/DeepSeek_V4.pdf" }));
ok("generic PDF URL", JSON.stringify(m.classifyIdentifier("https://example.com/papers/foo.pdf")) === JSON.stringify({ type: "pdf", url: "https://example.com/papers/foo.pdf" }));
try {
  m.classifyIdentifier("not an id");
  ok("rejects garbage", false);
} catch {
  ok("rejects garbage", true);
}

// --- discover RRF merge (Part B) ---
const hitA1 = { id: "1", source: "openalex", title: "Attention Is All You Need", authorsShort: "Vaswani et al.", authorsFull: "", year: 2017, venue: "NeurIPS", doi: "10.x/abc", arxiv: "—", abstract: "long abstract here", citedBy: 100 };
const hitA2 = { id: "2", source: "arxiv", title: "Attention Is All You Need", authorsShort: "Vaswani et al.", authorsFull: "", year: 2017, venue: "arXiv", doi: "10.x/abc", arxiv: "1706.03762", abstract: "", tldr: "transformers", citedBy: 0 };
const hitB = { id: "3", source: "crossref", title: "BERT", authorsShort: "Devlin", authorsFull: "", year: 2019, venue: "NAACL", doi: "10.x/bert", arxiv: "—", abstract: "", citedBy: 50 };
const merged = m.rrfMerge([[hitA1, hitB], [hitA2]]);
ok("RRF de-dupes same DOI across sources", merged.length === 2);
const att = merged.find((h) => h.doi === "10.x/abc");
ok("RRF merges sources [openalex, arxiv]", att && att.sources.includes("openalex") && att.sources.includes("arxiv"));
ok("RRF enriches arxiv id from second source", att && att.arxiv === "1706.03762");
ok("RRF enriches tldr", att && att.tldr === "transformers");
ok("RRF ranks cross-source hit first", merged[0].doi === "10.x/abc");
ok("hitToPaper keeps arxiv id", m.hitToPaper(hitA2).arxiv === "1706.03762");

// --- markdown export (Part 2 second-brain) ---
const md = m.paperToMarkdown(m.PAPERS[0], m.PAPERS);
ok("markdown has YAML frontmatter", md.startsWith("---\n") && md.includes("title:"));
ok("markdown has H1 title", md.includes("# Attention Is All You Need"));
ok("markdown includes highlights as quotes", md.includes("> ") && md.includes("## Highlights"));
ok("markdown includes #tags", md.includes("#Transformers"));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
