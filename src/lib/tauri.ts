// Detect whether we're running inside the Tauri native shell vs. a plain
// browser (npm run dev). The repository layer uses this to pick a backend.
export function isTauri(): boolean {
  return (
    typeof window !== "undefined" &&
    ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
  );
}

// Running on a mobile platform (iOS/Android webview). Used to switch to the
// single-column layout and hide desktop-only features (watch folders, the
// localhost-capture bookmarklet, library-folder picking).
export function isMobilePlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
}

// Thin wrapper so non-Tauri builds never statically import the API.
export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

// Which native window-material the platform can show behind transparent chrome.
// `full` = macOS NSVisualEffect (Liquid Glass on Tahoe); `acrylic` = Windows
// acrylic; `off` = no native material (Linux / web / reduced-transparency).
export type GlassMode = "full" | "acrylic" | "off";
export function detectGlassPlatform(): GlassMode {
  if (!isTauri()) return "off";
  try {
    if (window.matchMedia?.("(prefers-reduced-transparency: reduce)").matches) return "off";
  } catch {
    /* matchMedia unavailable — ignore */
  }
  const ua = navigator.userAgent;
  if (/Mac OS X|Macintosh/i.test(ua)) return "full";
  if (/Windows/i.test(ua)) return "acrylic";
  return "off";
}
