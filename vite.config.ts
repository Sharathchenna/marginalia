import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Vite config tuned for Tauri: fixed port, no clearScreen so Rust logs survive.
// Dev proxies dodge CORS for the metadata APIs (arXiv has no CORS headers);
// the native build hits these from Rust instead.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    proxy: {
      "/arxiv-api": {
        target: "https://export.arxiv.org",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/arxiv-api/, ""),
      },
      "/crossref": {
        target: "https://api.crossref.org",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/crossref/, ""),
      },
      "/arxiv-pdf": {
        target: "https://arxiv.org",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/arxiv-pdf/, ""),
      },
      "/openalex": {
        target: "https://api.openalex.org",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/openalex/, ""),
      },
      "/semanticscholar": {
        target: "https://api.semanticscholar.org",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/semanticscholar/, ""),
      },
      "/huggingface": {
        target: "https://huggingface.co",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/huggingface/, ""),
      },
    },
  },
});
