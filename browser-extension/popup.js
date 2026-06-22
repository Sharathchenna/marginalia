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

function renderList() {
  const list = $("list");
  list.innerHTML = "";
  $("results").style.display = "block";
  if (!entries.length) {
    $("resHint").textContent = "No arXiv / DOI / PDF links found here.";
    list.innerHTML = '<div class="count">Nothing to capture.</div>';
    return;
  }
  $("resHint").textContent = `Found ${entries.length} link${entries.length === 1 ? "" : "s"} — pick what to capture:`;
  entries.forEach((e, i) => {
    const row = document.createElement("label");
    row.className = "item";
    row.innerHTML =
      `<input type="checkbox" data-i="${i}" checked />` +
      `<span class="meta"><span class="typ">${e.type}</span><br><span class="lbl">${escapeHtml(e.label)}</span></span>`;
    list.appendChild(row);
  });
}

function selected() {
  return Array.from(document.querySelectorAll(".item input:checked")).map((c) => entries[Number(c.dataset.i)]);
}

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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
