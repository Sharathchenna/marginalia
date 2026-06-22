// SQLite persistence for the library. Papers are stored as JSON blobs (the same
// shape the frontend uses) plus an FTS5 index over their text for fast search.
use rusqlite::{params, Connection};
use serde_json::{json, Value};

pub fn open(path: &std::path::Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    // WAL + a busy timeout so a concurrent reader (e.g. the node sidecar opening
    // the same DB) doesn't immediately hit "database is locked".
    conn.execute_batch(
        "PRAGMA journal_mode=WAL;
         PRAGMA synchronous=NORMAL;
         PRAGMA busy_timeout=5000;
         PRAGMA foreign_keys=ON;",
    )?;
    migrate(&conn)?;
    Ok(conn)
}

fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS papers (
            id    TEXT PRIMARY KEY,
            json  TEXT NOT NULL,
            added_ts INTEGER NOT NULL DEFAULT 0
        );
        CREATE VIRTUAL TABLE IF NOT EXISTS papers_fts USING fts5(
            id UNINDEXED, title, authors, abstract, tags
        );
        CREATE TABLE IF NOT EXISTS kv (
            key TEXT PRIMARY KEY,
            json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS embeddings (
            paper_id TEXT PRIMARY KEY,
            model TEXT NOT NULL,
            dim   INTEGER NOT NULL,
            hash  TEXT NOT NULL,
            vec   BLOB NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_embeddings_model ON embeddings(model);
        "#,
    )
}

// ---- embeddings (semantic search) ----

/// The (model, hash) an existing vector was built from, so callers can skip
/// re-embedding papers whose text hasn't changed.
pub fn embedding_meta(conn: &Connection, id: &str) -> rusqlite::Result<Option<(String, String)>> {
    let mut stmt = conn.prepare("SELECT model, hash FROM embeddings WHERE paper_id = ?1")?;
    let mut rows = stmt.query(params![id])?;
    if let Some(row) = rows.next()? {
        Ok(Some((row.get(0)?, row.get(1)?)))
    } else {
        Ok(None)
    }
}

pub fn upsert_embedding(
    conn: &Connection,
    id: &str,
    model: &str,
    dim: usize,
    hash: &str,
    vec: &[u8],
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO embeddings(paper_id, model, dim, hash, vec) VALUES(?1,?2,?3,?4,?5)
         ON CONFLICT(paper_id) DO UPDATE SET model=excluded.model, dim=excluded.dim,
           hash=excluded.hash, vec=excluded.vec",
        params![id, model, dim as i64, hash, vec],
    )?;
    Ok(())
}

/// All (paper_id, raw vec bytes) for a given model, for in-memory cosine search.
pub fn all_embeddings(conn: &Connection, model: &str) -> rusqlite::Result<Vec<(String, Vec<u8>)>> {
    let mut stmt = conn.prepare("SELECT paper_id, vec FROM embeddings WHERE model = ?1")?;
    let rows = stmt.query_map(params![model], |row| Ok((row.get(0)?, row.get(1)?)))?;
    rows.collect()
}

pub fn get_embedding_vec(conn: &Connection, id: &str, model: &str) -> rusqlite::Result<Option<Vec<u8>>> {
    let mut stmt = conn.prepare("SELECT vec FROM embeddings WHERE paper_id = ?1 AND model = ?2")?;
    let mut rows = stmt.query(params![id, model])?;
    if let Some(row) = rows.next()? {
        Ok(Some(row.get(0)?))
    } else {
        Ok(None)
    }
}

pub fn embedding_count(conn: &Connection, model: &str) -> rusqlite::Result<i64> {
    conn.query_row(
        "SELECT COUNT(*) FROM embeddings WHERE model = ?1",
        params![model],
        |r| r.get(0),
    )
}

fn fts_fields(p: &Value) -> (String, String, String, String, String) {
    let s = |k: &str| p.get(k).and_then(Value::as_str).unwrap_or("").to_string();
    let id = s("id");
    let title = s("title");
    let authors = format!("{} {}", s("authors"), s("authorsFull"));
    let abstract_ = s("abstract");
    let tags = p
        .get("tags")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(Value::as_str)
                .collect::<Vec<_>>()
                .join(" ")
        })
        .unwrap_or_default();
    (id, title, authors, abstract_, tags)
}

pub fn upsert_paper(conn: &Connection, p: &Value) -> rusqlite::Result<()> {
    let (id, title, authors, abstract_, tags) = fts_fields(p);
    let added_ts = p.get("addedTs").and_then(Value::as_i64).unwrap_or(0);
    conn.execute(
        "INSERT INTO papers(id, json, added_ts) VALUES(?1, ?2, ?3)
         ON CONFLICT(id) DO UPDATE SET json=excluded.json, added_ts=excluded.added_ts",
        params![id, p.to_string(), added_ts],
    )?;
    conn.execute("DELETE FROM papers_fts WHERE id = ?1", params![id])?;
    conn.execute(
        "INSERT INTO papers_fts(id, title, authors, abstract, tags) VALUES(?1,?2,?3,?4,?5)",
        params![id, title, authors, abstract_, tags],
    )?;
    Ok(())
}

pub fn replace_papers(conn: &Connection, papers: &[Value]) -> rusqlite::Result<()> {
    // Atomic wipe+refill: a crash mid-way must not leave an empty/partial library.
    conn.execute_batch("BEGIN IMMEDIATE")?;
    let result = (|| -> rusqlite::Result<()> {
        conn.execute("DELETE FROM papers", [])?;
        conn.execute("DELETE FROM papers_fts", [])?;
        for p in papers {
            upsert_paper(conn, p)?;
        }
        // drop vectors for papers that no longer exist (avoid polluting search)
        conn.execute("DELETE FROM embeddings WHERE paper_id NOT IN (SELECT id FROM papers)", [])?;
        Ok(())
    })();
    match result {
        Ok(()) => conn.execute_batch("COMMIT"),
        Err(e) => {
            let _ = conn.execute_batch("ROLLBACK");
            Err(e)
        }
    }
}

pub fn list_papers(conn: &Connection) -> rusqlite::Result<Vec<Value>> {
    let mut stmt = conn.prepare("SELECT json FROM papers ORDER BY added_ts DESC")?;
    let rows = stmt.query_map([], |row| {
        let s: String = row.get(0)?;
        Ok(serde_json::from_str::<Value>(&s).unwrap_or(json!({})))
    })?;
    rows.collect()
}

pub fn get_paper(conn: &Connection, id: &str) -> rusqlite::Result<Option<Value>> {
    let mut stmt = conn.prepare("SELECT json FROM papers WHERE id = ?1")?;
    let mut rows = stmt.query(params![id])?;
    if let Some(row) = rows.next()? {
        let s: String = row.get(0)?;
        Ok(serde_json::from_str(&s).ok())
    } else {
        Ok(None)
    }
}

pub fn update_paper(conn: &Connection, id: &str, patch: &Value) -> rusqlite::Result<()> {
    if let Some(mut existing) = get_paper(conn, id)? {
        if let (Some(obj), Some(p)) = (existing.as_object_mut(), patch.as_object()) {
            for (k, v) in p {
                obj.insert(k.clone(), v.clone());
            }
        }
        upsert_paper(conn, &existing)?;
    }
    Ok(())
}

pub fn delete_paper(conn: &Connection, id: &str) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM papers WHERE id = ?1", params![id])?;
    conn.execute("DELETE FROM papers_fts WHERE id = ?1", params![id])?;
    conn.execute("DELETE FROM embeddings WHERE paper_id = ?1", params![id])?;
    Ok(())
}

// Build a safe FTS5 MATCH expression: strip operator characters per token and
// wrap each as a quoted prefix term, so queries like "C++", "a OR b", "(x)" or
// "foo:bar" don't raise a syntax error.
fn build_fts_query(query: &str) -> String {
    query
        .split_whitespace()
        .map(|t| t.chars().filter(|c| c.is_alphanumeric()).collect::<String>())
        .filter(|t| !t.is_empty())
        .map(|t| format!("\"{t}\"*"))
        .collect::<Vec<_>>()
        .join(" ")
}

pub fn search(conn: &Connection, query: &str) -> rusqlite::Result<Vec<Value>> {
    let q = build_fts_query(query);
    if q.is_empty() {
        return list_papers(conn); // blank/operator-only query → everything
    }
    let mut stmt = conn.prepare(
        "SELECT p.json FROM papers_fts f JOIN papers p ON p.id = f.id
         WHERE papers_fts MATCH ?1 ORDER BY rank",
    )?;
    let rows = stmt.query_map(params![q], |row| {
        let s: String = row.get(0)?;
        Ok(serde_json::from_str::<Value>(&s).unwrap_or(json!({})))
    })?;
    rows.collect()
}

pub fn get_kv(conn: &Connection, key: &str) -> rusqlite::Result<Option<Value>> {
    let mut stmt = conn.prepare("SELECT json FROM kv WHERE key = ?1")?;
    let mut rows = stmt.query(params![key])?;
    if let Some(row) = rows.next()? {
        let s: String = row.get(0)?;
        Ok(serde_json::from_str(&s).ok())
    } else {
        Ok(None)
    }
}

pub fn set_kv(conn: &Connection, key: &str, value: &Value) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO kv(key, json) VALUES(?1, ?2)
         ON CONFLICT(key) DO UPDATE SET json=excluded.json",
        params![key, value.to_string()],
    )?;
    Ok(())
}
