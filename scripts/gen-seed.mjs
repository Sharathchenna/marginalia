// Generates src-tauri/seed.json from src/data.ts so the native (SQLite) backend
// seeds the same demo library the browser backend does. Run: node scripts/gen-seed.mjs
import { build } from "esbuild";
import { writeFileSync } from "node:fs";

const res = await build({
  entryPoints: ["src/data.ts"],
  bundle: true,
  format: "esm",
  write: false,
  platform: "neutral",
});
const code = res.outputFiles[0].text;
const mod = await import(
  "data:text/javascript," + encodeURIComponent(code)
);

const seed = {
  papers: mod.PAPERS,
  collections: mod.COLLECTIONS,
};
writeFileSync("src-tauri/seed.json", JSON.stringify(seed, null, 2) + "\n");
console.log(
  `Wrote src-tauri/seed.json (${seed.papers.length} papers, ${seed.collections.length} collections)`,
);
