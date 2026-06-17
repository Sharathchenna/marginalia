// Library-folder operations: choosing where PDFs live, importing/downloading
// PDFs into that folder, and resolving a paper to a pdf.js source. In the native
// app these go through Rust (real files on disk → no CORS); in the browser dev
// build they fall back to the Vite proxy / bundled sample.
import { invoke, isTauri } from "./tauri";
import type { Paper } from "../types";

export interface PdfSource {
  data?: Uint8Array;
  url?: string;
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function joinPath(dir: string, file: string): string {
  return dir.replace(/\/+$/, "") + "/" + file;
}

// In web dev, HF file URLs go through the Vite proxy to dodge CORS; everything
// else is loaded directly (CDN PDFs generally send permissive CORS headers).
function webPdfUrl(url: string): string {
  return url.replace(/^https?:\/\/huggingface\.co/i, "/huggingface");
}

// Stable, collision-resistant local filename for a remote PDF (keeps the repo
// path so two repos' "paper.pdf" don't clash).
function pdfUrlFilename(url: string): string {
  const clean = url.split(/[?#]/)[0];
  const m = clean.match(/huggingface\.co\/(.+)$/i);
  const path = m ? m[1].replace(/\/resolve\/[^/]+\//, "/") : clean.replace(/^https?:\/\//, "");
  const safe = path.replace(/[^a-zA-Z0-9._-]/g, "_");
  return /\.pdf$/i.test(safe) ? safe : safe + ".pdf";
}

/** Open a native folder picker (browser: prompt for a path). */
export async function chooseLibraryFolder(): Promise<string | null> {
  if (!isTauri()) {
    return window.prompt(
      "Library folder — where your PDFs will be stored",
      "~/Documents/Marginalia",
    );
  }
  const { open } = await import("@tauri-apps/plugin-dialog");
  const dir = await open({
    directory: true,
    multiple: false,
    title: "Choose your Marginalia library folder",
  });
  if (typeof dir === "string") {
    await invoke("ensure_dir", { path: dir });
    return dir;
  }
  return null;
}

export interface ScannedPdf {
  rel: string; // path relative to the library folder, e.g. "rl/Paper.pdf"
  name: string; // filename without extension
}

/** Recursively list PDFs already in the library folder (native only). */
export async function scanLibrary(libDir: string): Promise<ScannedPdf[]> {
  if (!isTauri() || !libDir) return [];
  return invoke<ScannedPdf[]>("scan_pdfs", { dir: libDir });
}

/** Pick PDF files to import (native only). Returns absolute source paths. */
export async function pickPdfFiles(): Promise<string[]> {
  if (!isTauri()) return [];
  const { open } = await import("@tauri-apps/plugin-dialog");
  const res = await open({
    multiple: true,
    filters: [{ name: "PDF", extensions: ["pdf"] }],
    title: "Import PDFs",
  });
  if (!res) return [];
  return Array.isArray(res) ? res : [res];
}

/** Copy a chosen PDF into the library folder; returns the stored filename. */
export async function importPdf(src: string, libDir: string): Promise<string> {
  return invoke<string>("import_pdf", { src, dir: libDir });
}

/**
 * Resolve a paper to a pdf.js source. May download an arXiv PDF into the library
 * folder on first open and call `onStored(filename)` so it can be cached.
 */
export async function resolvePdf(
  paper: Paper,
  libDir: string,
  onStored: (filename: string) => void,
): Promise<PdfSource> {
  if (!isTauri()) {
    if (paper.pdfUrl) return { url: webPdfUrl(paper.pdfUrl) };
    if (paper.arxiv && paper.arxiv !== "—") return { url: `/arxiv-pdf/pdf/${paper.arxiv}` };
    return { url: "/sample.pdf" };
  }
  // native: read from / download into the local library folder
  if (paper.file && libDir) {
    const b64 = await invoke<string>("read_pdf", { path: joinPath(libDir, paper.file) });
    return { data: b64ToBytes(b64) };
  }
  // A PDF hosted at a URL (e.g. inside a Hugging Face repo): download + cache it.
  if (paper.pdfUrl && libDir) {
    const filename = pdfUrlFilename(paper.pdfUrl);
    await invoke<string>("download_pdf", { url: paper.pdfUrl, dir: libDir, filename });
    onStored(filename);
    const b64 = await invoke<string>("read_pdf", { path: joinPath(libDir, filename) });
    return { data: b64ToBytes(b64) };
  }
  if (paper.arxiv && paper.arxiv !== "—" && libDir) {
    const filename = `${paper.arxiv}.pdf`;
    await invoke<string>("download_pdf", {
      url: `https://arxiv.org/pdf/${paper.arxiv}`,
      dir: libDir,
      filename,
    });
    onStored(filename);
    const b64 = await invoke<string>("read_pdf", { path: joinPath(libDir, filename) });
    return { data: b64ToBytes(b64) };
  }
  return { url: "/sample.pdf" };
}
