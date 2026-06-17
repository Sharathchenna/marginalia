// Bridge to the Claude Agent SDK sidecar (src-tauri/sidecar/agent.mjs).
//
// `ai_chat` spawns `node agent.mjs` for one chat turn, writes the JSON payload to
// its stdin, and streams the sidecar's JSON-lines events to the webview as
// `agent-event` Tauri events (tagged with the caller's requestId).
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};

/// Find a usable `node` binary. A GUI app launched from Finder has a minimal
/// PATH, so fall back to common install locations.
fn find_node() -> Option<String> {
    let candidates = [
        "/opt/homebrew/bin/node",
        "/usr/local/bin/node",
        "/usr/bin/node",
    ];
    for c in candidates {
        if std::path::Path::new(c).exists() {
            return Some(c.to_string());
        }
    }
    // last resort: rely on PATH
    if Command::new("node").arg("--version").output().is_ok() {
        return Some("node".to_string());
    }
    None
}

/// Locate the sidecar script: bundled resource first, then the compiled-in
/// project path (works for a locally-built personal app).
fn resolve_sidecar(app: &AppHandle) -> Option<(PathBuf, PathBuf)> {
    if let Ok(p) = app
        .path()
        .resolve("sidecar/agent.mjs", tauri::path::BaseDirectory::Resource)
    {
        if p.exists() {
            return Some((p.parent()?.to_path_buf(), p));
        }
    }
    let dev = PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/sidecar/agent.mjs"));
    if dev.exists() {
        return Some((dev.parent()?.to_path_buf(), dev));
    }
    None
}

#[tauri::command]
pub fn ai_chat(app: AppHandle, request_id: String, payload: Value) -> Result<(), String> {
    let node = find_node().ok_or(
        "Node.js was not found. Install Node 18+ (e.g. `brew install node`) to use AI chat.",
    )?;
    let (dir, script) = resolve_sidecar(&app).ok_or("Agent sidecar not found.")?;

    let mut child = Command::new(&node)
        .arg(&script)
        .current_dir(&dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to start sidecar: {e}"))?;

    // write the payload, then close stdin (EOF) so the sidecar starts the turn
    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(payload.to_string().as_bytes());
    }

    let stdout = child.stdout.take().ok_or("No sidecar stdout")?;
    let app2 = app.clone();
    let rid = request_id.clone();
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines().map_while(Result::ok) {
            if let Ok(mut v) = serde_json::from_str::<Value>(&line) {
                let is_ours = v.get("__marg").and_then(Value::as_bool).unwrap_or(false);
                if is_ours {
                    if let Some(obj) = v.as_object_mut() {
                        obj.insert("requestId".into(), json!(rid));
                    }
                    let _ = app2.emit("agent-event", v);
                }
            }
        }
        let _ = child.wait();
        let _ = app2.emit(
            "agent-event",
            json!({ "__marg": true, "requestId": rid, "type": "closed" }),
        );
    });

    Ok(())
}
