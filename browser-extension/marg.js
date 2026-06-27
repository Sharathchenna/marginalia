// Shared helpers for the Marginalia Connector — loaded by both the background
// page and the popup. Talks to the desktop app's localhost capture listener
// (src-tauri/src/capture.rs), which binds the first free port in this list.
const api = typeof browser !== "undefined" ? browser : chrome;
const MARG_PORTS = [8787, 8788, 8789, 8790];
let _port = null;

// The X-Marginalia header authorizes the request to the desktop listener. A web
// page can't replicate it cross-origin (it would trigger a preflight the server
// never approves), so it gates out drive-by capture attempts.
const MARG_HEADERS = { "X-Marginalia": "1" };

async function margPing(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/marg-ping`, { headers: MARG_HEADERS });
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

// Launch / focus the desktop app via its marginalia:// deep link (Obsidian-style).
// Opens an inert background tab so Firefox routes the protocol, then closes it.
async function margOpenApp() {
  try {
    const tab = await api.tabs.create({ url: "marginalia://open", active: false });
    if (tab && tab.id != null) setTimeout(() => api.tabs.remove(tab.id).catch(() => {}), 1500);
  } catch {
    /* ignore */
  }
}

// Find the listener; if the app isn't up, try to launch it and retry once.
async function margEnsurePort() {
  let port = await margFindPort();
  if (port) return port;
  await margOpenApp();
  await new Promise((r) => setTimeout(r, 1800)); // let the app start + bind
  port = await margFindPort();
  return port;
}

// Send one URL into Marginalia (it resolves metadata + fetches the PDF itself).
async function margSend(url) {
  const port = await margEnsurePort();
  if (!port) throw new Error("Couldn't reach Marginalia — opening it now, try again in a moment.");
  const r = await fetch(`http://127.0.0.1:${port}/add?u=${encodeURIComponent(url)}`, {
    headers: MARG_HEADERS,
  });
  if (!r.ok) throw new Error(`Capture failed (${r.status})`);
  return true;
}

// POST a clipped page (Markdown + metadata) into Marginalia.
async function margClip(data) {
  const port = await margEnsurePort();
  if (!port) throw new Error("Couldn't reach Marginalia — opening it now, try again in a moment.");
  const r = await fetch(`http://127.0.0.1:${port}/clip`, {
    method: "POST",
    headers: { ...MARG_HEADERS, "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!r.ok) throw new Error(`Clip failed (${r.status})`);
  return true;
}

// Subscribe to a blog/RSS feed. The desktop app resolves the feed from either a
// site URL (it discovers the <link rel=alternate>) or a direct feed URL.
async function margSubscribe(url) {
  const port = await margEnsurePort();
  if (!port) throw new Error("Couldn't reach Marginalia — opening it now, try again in a moment.");
  const r = await fetch(`http://127.0.0.1:${port}/subscribe?u=${encodeURIComponent(url)}`, {
    headers: MARG_HEADERS,
  });
  if (!r.ok) throw new Error(`Subscribe failed (${r.status})`);
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
