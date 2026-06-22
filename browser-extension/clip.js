// Runs in the page (after Readability + Turndown are injected) to clip the
// rendered article into Markdown. The IIFE's return value is handed back to the
// popup by executeScript. Works on JS-rendered SPAs because it reads the live DOM.
(function () {
  try {
    // Readability mutates the document, so parse a clone.
    const article = new Readability(document.cloneNode(true)).parse();
    const html = (article && article.content) || document.body.innerHTML;
    const td = new TurndownService({
      headingStyle: "atx",
      hr: "---",
      bulletListMarker: "-",
      codeBlockStyle: "fenced",
      emDelimiter: "*",
    });
    td.remove(["script", "style", "noscript", "form"]);
    if (typeof turndownPluginGfm !== "undefined") td.use(turndownPluginGfm.gfm);
    let markdown = td.turndown(html).replace(/\n{3,}/g, "\n\n").trim();
    if (markdown.length > 200000) markdown = markdown.slice(0, 200000) + "\n\n…(clipped)";
    return {
      url: location.href,
      title: (article && article.title) || document.title || location.hostname,
      author: (article && article.byline) || "",
      siteName: (article && article.siteName) || location.hostname.replace(/^www\./, ""),
      excerpt: (article && article.excerpt) || "",
      markdown,
    };
  } catch (e) {
    return { url: location.href, title: document.title, markdown: "", error: String((e && e.message) || e) };
  }
})();
