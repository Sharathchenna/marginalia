// Background page: right-click context menus + a tiny message API for the popup.
// (marg.js is loaded first via the manifest, so margSend/margFindPort exist here.)

api.runtime.onInstalled.addListener(() => {
  api.contextMenus.create({
    id: "marg-save-link",
    title: "Save link to Marginalia",
    contexts: ["link"],
  });
  api.contextMenus.create({
    id: "marg-bookmark-page",
    title: "Bookmark this page (full article)",
    contexts: ["page", "selection"],
  });
  api.contextMenus.create({
    id: "marg-subscribe",
    title: "Subscribe to this blog’s feed",
    contexts: ["page"],
  });
});

function flashBadge(ok) {
  api.browserAction.setBadgeText({ text: ok ? "✓" : "!" });
  api.browserAction.setBadgeBackgroundColor({ color: ok ? "#4b57d6" : "#e05c7e" });
  setTimeout(() => api.browserAction.setBadgeText({ text: "" }), 1600);
}

// Clip a tab to Markdown (full text) and save it as a bookmark/article.
async function clipTab(tabId) {
  await api.tabs.executeScript(tabId, { file: "vendor/Readability.js" });
  await api.tabs.executeScript(tabId, { file: "vendor/turndown.js" });
  await api.tabs.executeScript(tabId, { file: "vendor/turndown-plugin-gfm.js" });
  const res = await api.tabs.executeScript(tabId, { file: "clip.js" });
  const data = res && res[0];
  if (!data || !data.markdown) throw new Error("Couldn't extract this page.");
  data.kind = "article";
  await margClip(data);
}

api.contextMenus.onClicked.addListener(async (info, tab) => {
  try {
    if (info.menuItemId === "marg-save-link" && info.linkUrl) {
      await margSend(info.linkUrl);
    } else if (info.menuItemId === "marg-subscribe") {
      await margSubscribe(info.pageUrl || (tab && tab.url));
    } else if (tab && tab.id != null) {
      // marg-bookmark-page (or selection): full-text clip.
      await clipTab(tab.id);
    } else {
      return;
    }
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
