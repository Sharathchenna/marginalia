// Voyage AI embeddings + cosine helpers for semantic search. The Tauri commands
// that use these live in lib.rs (where AppState/the DB connection are in scope);
// this module is the pure HTTP + math layer.
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

use serde_json::{json, Value};

/// Stable content hash so unchanged papers are skipped on re-index.
pub fn text_hash(text: &str) -> String {
    let mut h = DefaultHasher::new();
    text.hash(&mut h);
    format!("{:x}", h.finish())
}

pub fn f32_to_bytes(v: &[f32]) -> Vec<u8> {
    let mut out = Vec::with_capacity(v.len() * 4);
    for x in v {
        out.extend_from_slice(&x.to_le_bytes());
    }
    out
}

pub fn bytes_to_f32(b: &[u8]) -> Vec<f32> {
    b.chunks_exact(4)
        .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
        .collect()
}

/// Cosine similarity of two equal-length vectors (0 if either is degenerate).
pub fn cosine(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() || a.is_empty() {
        return 0.0;
    }
    let mut dot = 0.0f32;
    let mut na = 0.0f32;
    let mut nb = 0.0f32;
    for i in 0..a.len() {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
    }
    if na == 0.0 || nb == 0.0 {
        return 0.0;
    }
    dot / (na.sqrt() * nb.sqrt())
}

/// Call Voyage's embeddings endpoint for a batch of texts. `input_type` is
/// "document" when indexing papers and "query" when embedding a search query.
pub fn embed(
    key: &str,
    model: &str,
    texts: &[String],
    input_type: &str,
) -> Result<Vec<Vec<f32>>, String> {
    if texts.is_empty() {
        return Ok(vec![]);
    }
    let body = json!({ "input": texts, "model": model, "input_type": input_type });
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .connect_timeout(std::time::Duration::from_secs(15))
        .user_agent("Marginalia/0.1")
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .post("https://api.voyageai.com/v1/embeddings")
        .bearer_auth(key)
        .json(&body)
        .send()
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        let code = resp.status();
        let msg = resp.text().unwrap_or_default();
        return Err(format!("Voyage error {code}: {}", msg.chars().take(300).collect::<String>()));
    }
    let v: Value = resp.json().map_err(|e| e.to_string())?;
    let data = v
        .get("data")
        .and_then(Value::as_array)
        .ok_or("Voyage response missing 'data'")?;
    // Preserve request order via each item's `index`.
    let mut out: Vec<Vec<f32>> = vec![Vec::new(); texts.len()];
    for item in data {
        let idx = item.get("index").and_then(Value::as_u64).unwrap_or(0) as usize;
        let emb = item
            .get("embedding")
            .and_then(Value::as_array)
            .ok_or("Voyage item missing 'embedding'")?
            .iter()
            .map(|n| n.as_f64().unwrap_or(0.0) as f32)
            .collect::<Vec<f32>>();
        if idx < out.len() {
            out[idx] = emb;
        }
    }
    Ok(out)
}
