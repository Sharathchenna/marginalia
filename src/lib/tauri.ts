// Detect whether we're running inside the Tauri native shell vs. a plain
// browser (npm run dev). The repository layer uses this to pick a backend.
export function isTauri(): boolean {
  return (
    typeof window !== "undefined" &&
    ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
  );
}

// Thin wrapper so non-Tauri builds never statically import the API.
export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}
