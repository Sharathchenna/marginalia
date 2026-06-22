// Popup logic. marg.js (loaded first) provides api, margFindPort, margSend, margPdfUrl.

const $ = (id) => document.getElementById(id);
let entries = [];

function toast(msg, kind) {
  const t = $("toast");
  t.textContent = msg;
  t.className = "toast " + (kind || "ok");
}

async function refreshStatus() {
  const port = await margFindPort();
  $("pill").className = "pill " + (port ? "on" : "off");
  $("status").textContent = port ? `connected · :${port}` : "app not running";
  return port;
}

async function activeTab() {
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  return tab;
}

$("savePage").addEventListener("click", async () => {
  const tab = await activeTab();
  if (!tab?.url) return;
  try {
    await margSend(tab.url);
    toast("Saved this page to Marginalia ✓", "ok");
  } catch (e) {
    toast(e.message, "err");
  }
});

$("scan").addEventListener("click", async () => {
  const tab = await activeTab();
  if (!tab?.id) return;
  try {
    const res = await api.tabs.executeScript(tab.id, { file: "scan.js" });
    entries = (res && res[0]) || [];
  } catch {
    toast("Can't scan this page (try a normal http/https page).", "err");
    return;
  }
  renderList();
});

// Build the list with DOM nodes (no innerHTML) so untrusted page text can never
// be interpreted as markup.
function renderList() {
  const list = $("list");
  list.replaceChildren();
  $("results").style.display = "block";
  if (!entries.length) {
    $("resHint").textContent = "No arXiv / DOI / PDF links found here.";
    const empty = document.createElement("div");
    empty.className = "count";
    empty.textContent = "Nothing to capture.";
    list.appendChild(empty);
    return;
  }
  $("resHint").textContent = `Found ${entries.length} link${entries.length === 1 ? "" : "s"} — pick what to capture:`;
  entries.forEach((e, i) => {
    const row = document.createElement("label");
    row.className = "item";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = true;
    cb.dataset.i = String(i);
    const meta = document.createElement("span");
    meta.className = "meta";
    const typ = document.createElement("span");
    typ.className = "typ";
    typ.textContent = e.type;
    const lbl = document.createElement("span");
    lbl.className = "lbl";
    lbl.textContent = e.label;
    meta.append(typ, document.createElement("br"), lbl);
    row.append(cb, meta);
    list.appendChild(row);
  });
}

function selected() {
  return Array.from(document.querySelectorAll(".item input:checked")).map((c) => entries[Number(c.dataset.i)]);
}

$("sendSel").addEventListener("click", async () => {
  const sel = selected();
  if (!sel.length) return toast("Select at least one link.", "err");
  if (!(await margFindPort())) return toast("Marginalia isn't running.", "err");
  let ok = 0;
  for (const e of sel) {
    try {
      await margSend(e.url);
      ok++;
    } catch {
      /* keep going */
    }
  }
  toast(`Sent ${ok}/${sel.length} to Marginalia ✓`, ok ? "ok" : "err");
});

$("dlSel").addEventListener("click", async () => {
  const sel = selected().map(margPdfUrl).filter(Boolean);
  if (!sel.length) return toast("No directly-downloadable PDFs selected (DOIs need the app).", "err");
  for (const url of sel) {
    try {
      await api.downloads.download({ url });
    } catch {
      /* skip */
    }
  }
  toast(`Downloading ${sel.length} PDF${sel.length === 1 ? "" : "s"} ↓`, "ok");
});

refreshStatus();
