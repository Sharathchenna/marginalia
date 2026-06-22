// Injected into the active tab to harvest every paper-ish link. The last
// expression (the IIFE result) is what executeScript hands back to the popup.
(function () {
  const out = [];
  const seen = new Set();
  const add = (raw, type, label) => {
    if (!raw) return;
    let abs;
    try {
      abs = new URL(raw, location.href).href;
    } catch {
      return;
    }
    const key = type + "|" + abs.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ url: abs, type, label: (label || abs).replace(/\s+/g, " ").trim().slice(0, 90) });
  };

  // Highwire / Dublin Core meta tags (arXiv + most journal landing pages).
  const meta = (n) => document.querySelector(`meta[name="${n}"]`)?.content;
  const ax = meta("citation_arxiv_id");
  if (ax) add(`https://arxiv.org/abs/${ax}`, "arxiv", "★ This page · arXiv:" + ax);
  const doi = meta("citation_doi") || meta("dc.identifier") || meta("DC.identifier");
  if (doi && /10\.\d{4,9}\//.test(doi))
    add("https://doi.org/" + doi.replace(/^doi:/i, ""), "doi", "★ This page · " + doi);
  const pdf = meta("citation_pdf_url");
  if (pdf) add(pdf, "pdf", "★ This page · PDF");

  // Every link on the page.
  for (const a of document.querySelectorAll("a[href]")) {
    const href = a.href;
    const text = (a.textContent || "").trim();
    if (/arxiv\.org\/(abs|pdf)\//i.test(href)) add(href, "arxiv", text || href);
    else if (/\bdoi\.org\/10\./i.test(href) || /\/10\.\d{4,9}\/\S/.test(href)) add(href, "doi", text || href);
    else if (/\.pdf($|[?#])/i.test(href)) add(href, "pdf", text || href);
  }

  return out.slice(0, 200);
})();
