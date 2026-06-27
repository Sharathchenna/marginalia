// One-click web capture. A tiny localhost HTTP server (std only, no extra deps)
// receives the URL of a page the user is browsing — from a bookmarklet — and
// emits it to the webview, which resolves it with the same metadata pipeline the
// "Add by identifier" flow uses. Top-level navigation to http://127.0.0.1 from an
// https page is allowed (it's not a mixed-content subresource), so a bookmarklet
// works without a packaged browser extension or a TLS cert.
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::atomic::{AtomicU16, Ordering};

use tauri::{AppHandle, Emitter};

// First free port wins; the frontend asks `capture_port` to build the bookmarklet.
const PORTS: [u16; 4] = [8787, 8788, 8789, 8790];
static CAPTURE_PORT: AtomicU16 = AtomicU16::new(0);

pub fn port() -> u16 {
    CAPTURE_PORT.load(Ordering::Relaxed)
}

const OK_HTML: &str = "<!doctype html><meta charset=utf-8><title>Marginalia</title>\
<body style=\"font:15px -apple-system,system-ui,sans-serif;display:grid;place-items:center;height:90vh;color:#1b1c21\">\
<div style=text-align:center><div style=font-size:30px>✓</div><p>Sent to Marginalia.<br>You can close this tab.</p></div>\
<script>setTimeout(function(){window.close()},900)</script>";
const ERR_HTML: &str = "<!doctype html><meta charset=utf-8><title>Marginalia</title>\
<body style=\"font:15px -apple-system,system-ui,sans-serif;display:grid;place-items:center;height:90vh\">\
<p>No URL received.</p>";
const FORBIDDEN_HTML: &str = "<!doctype html><meta charset=utf-8><title>Marginalia</title>\
<body style=\"font:15px -apple-system,system-ui,sans-serif;display:grid;place-items:center;height:90vh\">\
<p>Blocked: this request didn't come from the bookmarklet or the Marginalia extension.</p>";

pub fn start(app: AppHandle) {
    std::thread::spawn(move || {
        let listener = PORTS
            .iter()
            .find_map(|p| TcpListener::bind(("127.0.0.1", *p)).ok().map(|l| (l, *p)));
        let Some((listener, bound)) = listener else {
            return;
        };
        CAPTURE_PORT.store(bound, Ordering::Relaxed);
        for stream in listener.incoming() {
            let Ok(stream) = stream else { continue };
            let app = app.clone();
            // One thread per connection: a slow/hung client can't block the accept
            // loop (which would make the app look "not running" to the extension).
            std::thread::spawn(move || handle_conn(stream, &app));
        }
    });
}

fn handle_conn(mut stream: std::net::TcpStream, app: &AppHandle) {
    let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(5)));
    let _ = stream.set_write_timeout(Some(std::time::Duration::from_secs(5)));
    let data = read_request(&mut stream);
    let req = String::from_utf8_lossy(&data);
    // CSRF guard: a side-effecting capture must originate from a top-level
    // navigation (the bookmarklet's window.open → Sec-Fetch-Dest: document) or
    // carry the extension's X-Marginalia header (which a malicious page can't send
    // cross-origin without a preflight we never approve). A drive-by `fetch()` is
    // Sec-Fetch-Dest: empty → rejected. No Sec-Fetch-* at all = curl → allowed.
    let authorized = header(&req, "x-marginalia").is_some()
        || header(&req, "sec-fetch-dest") == Some("document")
        || header(&req, "sec-fetch-mode").is_none();
    let first = req.lines().next().unwrap_or("");
    let path = first.split_whitespace().nth(1).unwrap_or("");
    let (status, body) = if first.starts_with("POST") && path.starts_with("/clip") {
        // Clip a page to Markdown (extension-only — needs X-Marginalia).
        match (authorized, body_json(&data)) {
            (true, Some(payload)) => {
                let _ = app.emit("capture-clip", payload);
                ("200 OK", OK_HTML)
            }
            (false, _) => ("403 Forbidden", FORBIDDEN_HTML),
            (true, None) => ("400 Bad Request", ERR_HTML),
        }
    } else if path.starts_with("/subscribe") {
        // Subscribe to a blog/RSS feed (resolved by the frontend's feed pipeline).
        match parse_param(&req) {
            Some(u) if !u.is_empty() && authorized => {
                let _ = app.emit("capture-feed", u);
                ("200 OK", OK_HTML)
            }
            Some(_) if !authorized => ("403 Forbidden", FORBIDDEN_HTML),
            _ => ("200 OK", ERR_HTML),
        }
    } else {
        // GET /add?u=… — bookmarklet / single-link capture. (/marg-ping → ERR/200.)
        match parse_param(&req) {
            Some(u) if !u.is_empty() && authorized => {
                let _ = app.emit("capture-url", u);
                ("200 OK", OK_HTML)
            }
            Some(_) if !authorized => ("403 Forbidden", FORBIDDEN_HTML),
            _ => ("200 OK", ERR_HTML),
        }
    };
    // CSRF is prevented by the Sec-Fetch / X-Marginalia checks above, so a wildcard
    // origin is safe here — it only governs READING the reply, not the action — and
    // it avoids any CORS edge case making the extension think we're offline.
    let resp = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\n\
         Access-Control-Allow-Origin: *\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{}",
        body.len(),
        body
    );
    let _ = stream.write_all(resp.as_bytes());
    let _ = stream.flush();
}

// Read a full HTTP request: headers, plus (for POST) the Content-Length body.
// Bounded by the socket timeouts and a 4 MB hard cap.
fn read_request(stream: &mut std::net::TcpStream) -> Vec<u8> {
    let mut data = Vec::new();
    let mut tmp = [0u8; 8192];
    loop {
        match stream.read(&mut tmp) {
            Ok(0) => break,
            Ok(n) => {
                data.extend_from_slice(&tmp[..n]);
                if data.len() > 4_000_000 {
                    break;
                }
                if let Some(end) = headers_end(&data) {
                    let head = String::from_utf8_lossy(&data[..end]);
                    if !head.starts_with("POST") {
                        break; // GET/other: no body to wait for
                    }
                    if data.len() - (end + 4) >= content_length(&head) {
                        break; // full body received
                    }
                }
            }
            Err(_) => break, // timeout or connection error
        }
    }
    data
}

fn headers_end(data: &[u8]) -> Option<usize> {
    data.windows(4).position(|w| w == b"\r\n\r\n")
}

fn content_length(head: &str) -> usize {
    head.lines()
        .find_map(|l| {
            l.split_once(':').and_then(|(k, v)| {
                k.trim()
                    .eq_ignore_ascii_case("content-length")
                    .then(|| v.trim().parse().ok())
                    .flatten()
            })
        })
        .unwrap_or(0)
}

// Parse the POST body as JSON (for /clip).
fn body_json(data: &[u8]) -> Option<serde_json::Value> {
    let end = headers_end(data)?;
    serde_json::from_slice(&data[end + 4..]).ok()
}

// Case-insensitive lookup of a request header value (stops at the blank line
// separating headers from the body).
fn header<'a>(req: &'a str, name: &str) -> Option<&'a str> {
    let want = name.to_ascii_lowercase();
    for line in req.lines().skip(1) {
        if line.is_empty() {
            break;
        }
        if let Some((k, v)) = line.split_once(':') {
            if k.trim().eq_ignore_ascii_case(&want) {
                return Some(v.trim());
            }
        }
    }
    None
}

// Pull the `u` (or `url`) query param out of the HTTP request line and decode it.
fn parse_param(req: &str) -> Option<String> {
    let line = req.lines().next()?; // "GET /add?u=... HTTP/1.1"
    let path = line.split_whitespace().nth(1)?; // "/add?u=..."
    let query = path.split_once('?')?.1;
    for pair in query.split('&') {
        if let Some((k, v)) = pair.split_once('=') {
            if k == "u" || k == "url" {
                return Some(percent_decode(v));
            }
        }
    }
    None
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 2 < bytes.len() => {
                let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).ok();
                match hex.and_then(|h| u8::from_str_radix(h, 16).ok()) {
                    Some(b) => {
                        out.push(b);
                        i += 3;
                    }
                    None => {
                        out.push(bytes[i]);
                        i += 1;
                    }
                }
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).to_string()
}
