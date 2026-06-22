// Background page: right-click context menus + a tiny message API for the popup.
// (marg.js is loaded first via the manifest, so margSend/margFindPort exist here.)

api.runtime.onInstalled.addListener(() => {
  api.contextMenus.create({
    id: "marg-save-link",
    title: "Save link to Marginalia",
    contexts: ["link"],
  });
  api.contextMenus.create({
    id: "marg-save-page",
    title: "Save this page to Marginalia",
    contexts: ["page", "selection"],
  });
});

function flashBadge(ok) {
  api.browserAction.setBadgeText({ text: ok ? "✓" : "!" });
  api.browserAction.setBadgeBackgroundColor({ color: ok ? "#4b57d6" : "#e05c7e" });
  setTimeout(() => api.browserAction.setBadgeText({ text: "" }), 1600);
}

api.contextMenus.onClicked.addListener(async (info, tab) => {
  const url = info.menuItemId === "marg-save-link" ? info.linkUrl : info.pageUrl || (tab && tab.url);
  if (!url) return;
  try {
    await margSend(url);
    flashBadge(true);
  } catch {
    flashBadge(false);
  }
});

// Popup → background bridge (Firefox lets the listener return a Promise).
api.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === "ping") return margFindPort().then((port) => ({ port }));
  if (msg && msg.type === "send")
    return margSend(msg.url).then(
      () => ({ ok: true }),
      (e) => ({ ok: false, error: e.message }),
    );
  return undefined;
});
