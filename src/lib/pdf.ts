import * as pdfjs from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { PdfSource } from "./library";
import type { Highlight } from "../types";

// Point pdf.js at its worker (Vite turns the ?url import into an asset URL).
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

// Load a document from either local bytes (native) or a URL (web/proxy).
export function loadPdfSource(src: PdfSource): Promise<PDFDocumentProxy> {
  return pdfjs.getDocument(src.data ? { data: src.data } : { url: src.url }).promise;
}

// Track the in-flight render per canvas so a new render (e.g. on fast zoom)
// cancels the previous one instead of throwing "same canvas in multiple render()".
type RenderTask = { promise: Promise<void>; cancel: () => void };
const canvasTasks = new WeakMap<HTMLCanvasElement, RenderTask>();

// Render one page into a canvas at the given CSS width; returns the scale used.
export async function renderPage(
  pdf: PDFDocumentProxy,
  pageNum: number,
  canvas: HTMLCanvasElement,
  cssWidth: number,
): Promise<{ scale: number; viewport: pdfjs.PageViewport }> {
  const prev = canvasTasks.get(canvas);
  if (prev) {
    try {
      prev.cancel();
    } catch {
      /* ignore */
    }
  }
  const page = await pdf.getPage(pageNum);
  const unscaled = page.getViewport({ scale: 1 });
  const scale = cssWidth / unscaled.width;
  const dpr = window.devicePixelRatio || 1;
  const viewport = page.getViewport({ scale });
  const ctx = canvas.getContext("2d")!;
  canvas.width = Math.floor(viewport.width * dpr);
  canvas.height = Math.floor(viewport.height * dpr);
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const task = page.render({ canvasContext: ctx, viewport }) as unknown as RenderTask;
  canvasTasks.set(canvas, task);
  try {
    await task.promise;
  } finally {
    if (canvasTasks.get(canvas) === task) canvasTasks.delete(canvas);
  }
  return { scale, viewport };
}

// Build a selectable text layer over a rendered page (v4 TextLayer API).
export async function renderTextLayer(
  pdf: PDFDocumentProxy,
  pageNum: number,
  container: HTMLElement,
  viewport: pdfjs.PageViewport,
): Promise<void> {
  container.innerHTML = "";
  container.style.width = `${Math.floor(viewport.width)}px`;
  container.style.height = `${Math.floor(viewport.height)}px`;
  // v4 text layer sizes glyphs from this CSS var
  container.style.setProperty("--scale-factor", String(viewport.scale));
  const page = await pdf.getPage(pageNum);
  const textLayer = new pdfjs.TextLayer({
    textContentSource: page.streamTextContent(),
    container,
    viewport,
  });
  await textLayer.render();
}

// Tint the text-layer spans that make up each highlight on this page. Matches by
// whitespace-stripped text so it's robust to how the text layer segments words.
export function paintHighlights(container: HTMLElement, highlights: Highlight[]): void {
  const spans = Array.from(container.querySelectorAll("span")) as HTMLSpanElement[];
  // reset any prior tint
  for (const sp of spans) {
    sp.style.backgroundColor = "";
    sp.style.color = "";
  }
  if (!highlights.length || !spans.length) return;

  let compact = "";
  const map: HTMLSpanElement[] = [];
  for (const sp of spans) {
    for (const ch of sp.textContent || "") {
      if (!/\s/.test(ch)) {
        compact += ch.toLowerCase();
        map.push(sp);
      }
    }
  }

  for (const h of highlights) {
    const needle = (h.text || "").replace(/\s+/g, "").toLowerCase();
    if (needle.length < 3) continue;
    const probe = needle.slice(0, 80);
    const i = compact.indexOf(probe);
    if (i < 0) continue;
    const end = Math.min(i + needle.length, i + 1200, map.length);
    const touched = new Set<HTMLSpanElement>();
    for (let k = i; k < end; k++) touched.add(map[k]);
    touched.forEach((sp) => {
      sp.style.backgroundColor = h.color;
      sp.style.color = "#1b1c21";
      sp.style.borderRadius = "2px";
    });
  }
}

export interface OutlineNode {
  title: string;
  items: OutlineNode[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dest: any;
}

export async function getOutline(pdf: PDFDocumentProxy): Promise<OutlineNode[]> {
  try {
    const raw = (await pdf.getOutline()) as unknown as OutlineNode[] | null;
    return raw ?? [];
  } catch {
    return [];
  }
}

// Resolve an outline destination to a 1-based page number (-1 if unresolvable).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function destToPage(pdf: PDFDocumentProxy, dest: any): Promise<number> {
  try {
    let explicit = dest;
    if (typeof dest === "string") explicit = await pdf.getDestination(dest);
    if (!Array.isArray(explicit) || !explicit[0]) return -1;
    const idx = await pdf.getPageIndex(explicit[0]);
    return idx + 1;
  } catch {
    return -1;
  }
}

// Find the first page (>= fromPage, wrapping) whose text contains `term`.
export async function searchInPdf(
  pdf: PDFDocumentProxy,
  term: string,
  fromPage: number,
): Promise<number> {
  const needle = term.trim().toLowerCase();
  if (!needle) return -1;
  const n = pdf.numPages;
  for (let off = 0; off < n; off++) {
    const pageNum = ((fromPage - 1 + off) % n) + 1;
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    const text = content.items
      .map((it) => ("str" in it ? (it as { str: string }).str : ""))
      .join(" ")
      .toLowerCase();
    if (text.includes(needle)) return pageNum;
  }
  return -1;
}
