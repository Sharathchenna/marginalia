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
    // bare id like 1706.03762 or 2310.06825v2
    if s.len() >= 9 && s.chars().next().map(|c| c.is_ascii_digit()).unwrap_or(false) && s.contains('.') {
        let core: String = s.chars().take_while(|c| c.is_ascii_digit() || *c == '.').collect();
        if core.contains('.') {
            return Some(core);
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

fn fetch_arxiv(id: &str) -> Result<Value, String> {
    let url = format!("https://export.arxiv.org/api/query?id_list={id}");
    let body = reqwest::blocking::get(&url)
        .and_then(|r| r.text())
        .map_err(|e| e.to_string())?;
    let entry = body
        .split("<entry>")
        .nth(1)
        .ok_or("No arXiv record found for that ID.")?;
    let title = between(entry, "<title>", "</title>")
        .unwrap_or("Untitled")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let abstract_ = between(entry, "<summary>", "</summary>")
        .unwrap_or("")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
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
        "addedTs": 230,
        "abstract": abstract_,
        "notes": "",
        "hl": [],
    }))
}

fn fetch_doi(doi: &str) -> Result<Value, String> {
    let url = format!("https://api.crossref.org/works/{doi}");
    let v: Value = reqwest::blocking::get(&url)
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
        .unwrap_or_default();
    Ok(json!({
        "id": doi,
        "title": title,
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
        "addedTs": 230,
        "abstract": abstract_,
        "notes": "",
        "hl": [],
    }))
}
