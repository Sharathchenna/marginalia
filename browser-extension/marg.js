// Shared helpers for the Marginalia Connector — loaded by both the background
// page and the popup. Talks to the desktop app's localhost capture listener
// (src-tauri/src/capture.rs), which binds the first free port in this list.
const api = typeof browser !== "undefined" ? browser : chrome;
const MARG_PORTS = [8787, 8788, 8789, 8790];
let _port = null;

async function margPing(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/marg-ping`, { method: "GET" });
    return r.ok;
  } catch {
    return false;
  }
}

// Find (and cache) the port the running app bound to. null = app not running.
async function margFindPort() {
  if (_port && (await margPing(_port))) return _port;
  _port = null;
  for (const p of MARG_PORTS) {
    if (await margPing(p)) {
      _port = p;
      return p;
    }
  }
  return null;
}

// Send one URL into Marginalia (it resolves metadata + fetches the PDF itself).
async function margSend(url) {
  const port = await margFindPort();
  if (!port) throw new Error("Marginalia isn't running. Open the desktop app and try again.");
  const r = await fetch(`http://127.0.0.1:${port}/add?u=${encodeURIComponent(url)}`);
  if (!r.ok) throw new Error(`Capture failed (${r.status})`);
  return true;
}

// Resolve an entry to a directly downloadable PDF URL, or null.
function margPdfUrl(entry) {
  if (entry.type === "pdf") return entry.url;
  if (entry.type === "arxiv") {
    const m = entry.url.match(/arxiv\.org\/(?:abs|pdf)\/([^?#]+?)(?:\.pdf)?$/i);
    if (m) return `https://arxiv.org/pdf/${m[1].replace(/v\d+$/, "")}.pdf`;
  }
  return null; // a bare DOI can't be downloaded without resolving the publisher
}
