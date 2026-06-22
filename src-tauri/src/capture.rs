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
            let Ok(mut stream) = stream else { continue };
            // Don't let a slow/hung client freeze this single-threaded loop.
            let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(3)));
            let _ = stream.set_write_timeout(Some(std::time::Duration::from_secs(3)));
            let mut buf = [0u8; 16384];
            let n = stream.read(&mut buf).unwrap_or(0);
            let req = String::from_utf8_lossy(&buf[..n]);
            let url = parse_param(&req);
            let body = match &url {
                Some(u) if !u.is_empty() => {
                    let _ = app.emit("capture-url", u.clone());
                    OK_HTML
                }
                _ => ERR_HTML,
            };
            let resp = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\n\
                 Access-Control-Allow-Origin: *\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{}",
                body.len(),
                body
            );
            let _ = stream.write_all(resp.as_bytes());
            let _ = stream.flush();
        }
    });
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
