// Read-aloud bridge — spawns the edge-tts sidecar (sidecar/tts.mjs) for one
// request and returns its single JSON reply. See sidecar/tts.mjs for the wire
// protocol. Runs on a blocking thread so synthesis never stalls the UI.
use std::io::{Read, Write};
use std::process::{Command, Stdio};

use serde_json::{json, Value};
use tauri::AppHandle;

use crate::agent::{build_path_env, find_node, resolve_sidecar};

/// Spawn `node tts.mjs`, write `request` to its stdin, and parse the one-line
/// JSON reply. Returns the reply object on success, or its error string.
fn run_tts(app: &AppHandle, request: Value) -> Result<Value, String> {
    let node = find_node().ok_or(
        "Node.js was not found. Install Node 18+ (e.g. `brew install node`) to use read-aloud.",
    )?;
    let (dir, script) = resolve_sidecar(app, "tts.mjs").ok_or("Read-aloud sidecar not found.")?;
    let path_env = build_path_env(&node);

    let mut child = Command::new(&node)
        .arg(&script)
        .current_dir(&dir)
        .env("PATH", &path_env)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to start read-aloud sidecar: {e}"))?;

    // Write the request, then drop stdin (EOF) so the sidecar starts. The script
    // reads all of stdin before emitting anything, so there's no pipe deadlock.
    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(request.to_string().as_bytes())
            .map_err(|e| format!("Failed to send request: {e}"))?;
    }

    let mut out = String::new();
    child
        .stdout
        .take()
        .ok_or("No read-aloud sidecar stdout")?
        .read_to_string(&mut out)
        .map_err(|e| e.to_string())?;
    let _ = child.wait();

    let line = out.trim().lines().last().unwrap_or("");
    let reply: Value =
        serde_json::from_str(line).map_err(|e| format!("Bad read-aloud reply: {e}"))?;
    if reply.get("ok").and_then(Value::as_bool).unwrap_or(false) {
        Ok(reply)
    } else {
        Err(reply
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("Read-aloud failed")
            .to_string())
    }
}

/// Synthesize `text` → `{ ok, audio: <base64 mp3>, words: [{o, t}] }`.
#[tauri::command]
pub async fn tts_speak(
    app: AppHandle,
    text: String,
    voice: String,
    rate: String,
    pitch: String,
) -> Result<Value, String> {
    let req = json!({ "op": "speak", "text": text, "voice": voice, "rate": rate, "pitch": pitch });
    tauri::async_runtime::spawn_blocking(move || run_tts(&app, req))
        .await
        .map_err(|e| e.to_string())?
}

/// List available Edge voices → `{ ok, voices: [{ name, label, locale, gender }] }`.
#[tauri::command]
pub async fn tts_voices(app: AppHandle) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || run_tts(&app, json!({ "op": "voices" })))
        .await
        .map_err(|e| e.to_string())?
}
