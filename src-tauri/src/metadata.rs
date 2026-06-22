// Resolve a DOI / arXiv ID / URL into a Paper-shaped JSON value via the arXiv
// or CrossRef APIs. Mirrors src/lib/metadata.ts so both backends return the
// same shape to the frontend.
use serde_json::{json, Value};

pub fn lookup(identifier: &str) -> Result<Value, String> {
    let s = identifier.trim();
    if let Some(id) = arxiv_id(s) {
        fetch_arxiv(&id)
    } else if let Some(doi) = doi_id(s) {
        fetch_doi(&doi)
    } else {
        Err("Unrecognized identifier — paste a DOI, arXiv ID, or URL.".into())
    }
}

fn arxiv_id(s: &str) -> Option<String> {
    if let Some(i) = s.find("arxiv.org/abs/") {
        return Some(strip_version(&s[i + 14..]));
    }
    let lower = s.to_lowercase();
    if let Some(rest) = lower.strip_prefix("arxiv:") {
        return Some(strip_version(rest.trim()));
    }
    // bare id like 1706.03762 or 2310.06825v2 — but NOT a DOI (which contains '/')
    if !s.contains('/')
        && s.len() >= 9
        && s.chars().next().map(|c| c.is_ascii_digit()).unwrap_or(false)
        && s.contains('.')
    {
        let core: String = s.chars().take_while(|c| c.is_ascii_digit() || *c == '.').collect();
        if core.contains('.') {
            return Some(core);
        }
    }
    // legacy bare id like hep-th/9901001 or math.AG/0309001
    {
        let bytes = s.as_bytes();
        if let Some(slash) = s.find('/') {
            let head = &s[..slash];
            let tail = &s[slash + 1..];
            let head_ok = !head.is_empty()
                && head.chars().next().map(|c| c.is_ascii_alphabetic()).unwrap_or(false)
                && head.chars().all(|c| c.is_ascii_alphabetic() || c == '-' || c == '.');
            let tail_digits = strip_version(tail);
            if head_ok && tail_digits.len() == 7 && tail_digits.chars().all(|c| c.is_ascii_digit()) {
                let _ = bytes;
                return Some(format!("{head}/{tail_digits}"));
            }
        }
    }
    // arXiv-minted DOI: 10.48550/arXiv.2310.06825
    if let Some(i) = lower.find("arxiv.") {
        let tail: String = s[i + 6..]
            .chars()
            .take_while(|c| c.is_ascii_digit() || *c == '.')
            .collect();
        if tail.contains('.') {
            return Some(tail);
        }
    }
    None
}

fn strip_version(s: &str) -> String {
    let s = s.split(['?', '#', ' ']).next().unwrap_or(s);
    match s.rfind('v') {
        Some(i) if s[i + 1..].chars().all(|c| c.is_ascii_digit()) && i > 0 => s[..i].to_string(),
        _ => s.to_string(),
    }
}

fn doi_id(s: &str) -> Option<String> {
    let i = s.find("10.")?;
    let doi: String = s[i..]
        .chars()
        .take_while(|c| !c.is_whitespace() && *c != '"' && *c != '<' && *c != '>')
        .collect();
    if doi.contains('/') {
        Some(doi)
    } else {
        None
    }
}

fn short_authors(families: &[String]) -> String {
    match families.len() {
        0 => "Unknown".into(),
        1 => families[0].clone(),
        2 => format!("{} & {}", families[0], families[1]),
        _ => format!("{} et al.", families[0]),
    }
}

fn between<'a>(hay: &'a str, open: &str, close: &str) -> Option<&'a str> {
    let start = hay.find(open)? + open.len();
    let end = hay[start..].find(close)? + start;
    Some(hay[start..end].trim())
}

fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

// One configured HTTP client: 30s timeout (so a stalled server can't hang the
// command thread forever) and a descriptive UA + mailto (CrossRef's polite pool).
fn http_client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .connect_timeout(std::time::Duration::from_secs(15))
        .user_agent("Marginalia/0.1 (research paper manager; mailto:hello@marginalia.app)")
        .build()
        .map_err(|e| e.to_string())
}

// Decode the XML/HTML entities arXiv Atom and JATS abstracts contain.
fn decode_entities(s: &str) -> String {
    let named = s
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&#39;", "'");
    // numeric: &#8212; and &#x2014;
    let chars: Vec<char> = named.chars().collect();
    let mut out = String::with_capacity(named.len());
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '&' && i + 1 < chars.len() && chars[i + 1] == '#' {
            if let Some(semi) = chars[i + 2..].iter().position(|&c| c == ';') {
                let token: String = chars[i + 2..i + 2 + semi].iter().collect();
                let code = if let Some(hex) = token.strip_prefix(['x', 'X']) {
                    u32::from_str_radix(hex, 16).ok()
                } else {
                    token.parse::<u32>().ok()
                };
                if let Some(cp) = code.and_then(char::from_u32) {
                    out.push(cp);
                    i += 2 + semi + 1;
                    continue;
                }
            }
        }
        out.push(chars[i]);
        i += 1;
    }
    out
}

fn fetch_arxiv(id: &str) -> Result<Value, String> {
    let url = format!("https://export.arxiv.org/api/query?id_list={id}");
    let body = http_client()?
        .get(&url)
        .send()
        .and_then(|r| r.error_for_status())
        .and_then(|r| r.text())
        .map_err(|e| e.to_string())?;
    let entry = body
        .split("<entry>")
        .nth(1)
        .ok_or("No arXiv record found for that ID.")?;
    let title = decode_entities(
        &between(entry, "<title>", "</title>")
            .unwrap_or("Untitled")
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" "),
    );
    let abstract_ = decode_entities(
        &between(entry, "<summary>", "</summary>")
            .unwrap_or("")
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" "),
    );
    let year: i64 = between(entry, "<published>", "</published>")
        .and_then(|p| p.get(0..4))
        .and_then(|y| y.parse().ok())
        .unwrap_or(0);
    let full_names: Vec<String> = entry
        .split("<name>")
        .skip(1)
        .filter_map(|seg| seg.split("</name>").next())
        .map(|n| n.trim().to_string())
        .collect();
    let families: Vec<String> = full_names
        .iter()
        .map(|n| n.split_whitespace().last().unwrap_or(n).to_string())
        .collect();
    Ok(json!({
        "id": id,
        "title": title,
        "authors": short_authors(&families),
        "authorsFull": full_names.join(", "),
        "year": year,
        "venue": "arXiv",
        "doi": "—",
        "arxiv": id,
        "tags": [],
        "read": false,
        "fav": false,
        "added": "just now",
        "addedTs": now_ms(),
        "abstract": abstract_,
        "notes": "",
        "hl": [],
    }))
}

// Privacy-preserving retraction check: query Crossref (which now hosts the full
// Retraction Watch database) for a single DOI and inspect its `updated-by`
// relations. Returns `{ retracted, type?, reason?, date?, url? }`. Only the DOI
// is sent — the server never learns the rest of the user's library.
pub fn check_retraction(doi: &str) -> Result<Value, String> {
    let doi = doi.trim();
    if doi.is_empty() || doi == "—" {
        return Ok(json!({ "retracted": false }));
    }
    let url = format!("https://api.crossref.org/works/{doi}");
    let v: Value = http_client()?
        .get(&url)
        .send()
        .and_then(|r| r.error_for_status())
        .and_then(|r| r.json())
        .map_err(|e| e.to_string())?;
    Ok(retraction_from_message(&v["message"]))
}

// Pull a retraction notice out of a Crossref work record, if any. Pure, so it's
// unit-testable and reusable when a record is already in hand.
fn retraction_from_message(m: &Value) -> Value {
    let kinds = [
        "retraction",
        "withdrawal",
        "removal",
        "partial_retraction",
        "expression_of_concern",
    ];
    if let Some(arr) = m["updated-by"].as_array() {
        for u in arr {
            let ty = u["type"].as_str().unwrap_or("").to_lowercase();
            if kinds.contains(&ty.as_str()) {
                let date = u["updated"]["date-time"]
                    .as_str()
                    .map(|s| s.split('T').next().unwrap_or(s).to_string())
                    .or_else(|| {
                        u["updated"]["date-parts"][0][0]
                            .as_i64()
                            .map(|y| y.to_string())
                    })
                    .unwrap_or_default();
                let notice = u["DOI"].as_str().unwrap_or("");
                let label = u["label"].as_str().map(str::to_string).unwrap_or_else(|| {
                    // Title-case the type as a fallback label ("partial_retraction"
                    // → "Partial Retraction").
                    ty.split('_')
                        .map(|w| {
                            let mut c = w.chars();
                            match c.next() {
                                Some(f) => f.to_uppercase().chain(c).collect::<String>(),
                                None => String::new(),
                            }
                        })
                        .collect::<Vec<_>>()
                        .join(" ")
                });
                return json!({
                    "retracted": true,
                    "type": ty,
                    "reason": label,
                    "date": date,
                    "url": if notice.is_empty() { String::new() } else { format!("https://doi.org/{notice}") },
                });
            }
        }
    }
    json!({ "retracted": false })
}

fn fetch_doi(doi: &str) -> Result<Value, String> {
    let url = format!("https://api.crossref.org/works/{doi}");
    let v: Value = http_client()?
        .get(&url)
        .send()
        .and_then(|r| r.error_for_status())
        .and_then(|r| r.json())
        .map_err(|e| e.to_string())?;
    let m = &v["message"];
    let title = m["title"][0].as_str().unwrap_or("Untitled").to_string();
    let authors = m["author"].as_array().cloned().unwrap_or_default();
    let families: Vec<String> = authors
        .iter()
        .filter_map(|a| a["family"].as_str().or_else(|| a["name"].as_str()))
        .map(String::from)
        .collect();
    let full: Vec<String> = authors
        .iter()
        .map(|a| {
            if let Some(n) = a["name"].as_str() {
                n.to_string()
            } else {
                format!(
                    "{} {}",
                    a["given"].as_str().unwrap_or(""),
                    a["family"].as_str().unwrap_or("")
                )
                .trim()
                .to_string()
            }
        })
        .collect();
    let year = m["issued"]["date-parts"][0][0]
        .as_i64()
        .or_else(|| m["published"]["date-parts"][0][0].as_i64())
        .unwrap_or(0);
    let venue = m["container-title"][0]
        .as_str()
        .or_else(|| m["publisher"].as_str())
        .unwrap_or("—")
        .to_string();
    let abstract_ = m["abstract"]
        .as_str()
        .map(|s| {
            // strip JATS tags
            let mut out = String::new();
            let mut in_tag = false;
            for c in s.chars() {
                match c {
                    '<' => in_tag = true,
                    '>' => in_tag = false,
                    _ if !in_tag => out.push(c),
                    _ => {}
                }
            }
            out.split_whitespace().collect::<Vec<_>>().join(" ")
        })
        .map(|s| decode_entities(&s))
        .unwrap_or_default();
    Ok(json!({
        "id": doi,
        "title": decode_entities(&title),
        "authors": short_authors(&families),
        "authorsFull": full.join(", "),
        "year": year,
        "venue": venue,
        "doi": doi,
        "arxiv": "—",
        "tags": [],
        "read": false,
        "fav": false,
        "added": "just now",
        "addedTs": now_ms(),
        "abstract": abstract_,
        "notes": "",
        "hl": [],
    }))
}
