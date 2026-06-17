import type { Collection, Paper } from "../types";
import { invoke } from "./tauri";
import type { Repository, Settings } from "./repo";

// Native backend: every method maps to a Rust command registered in
// src-tauri/src/lib.rs, which persists to a local SQLite database.
export class TauriRepository implements Repository {
  listPapers(): Promise<Paper[]> {
    return invoke<Paper[]>("list_papers");
  }
  replacePapers(papers: Paper[]): Promise<void> {
    return invoke<void>("replace_papers", { papers });
  }
  addPaper(p: Paper): Promise<void> {
    return invoke<void>("add_paper", { paper: p });
  }
  updatePaper(id: string, patch: Partial<Paper>): Promise<void> {
    return invoke<void>("update_paper", { id, patch });
  }
  deletePaper(id: string): Promise<void> {
    return invoke<void>("delete_paper", { id });
  }
  listCollections(): Promise<Collection[]> {
    return invoke<Collection[]>("list_collections");
  }
  saveCollections(collections: Collection[]): Promise<void> {
    return invoke<void>("save_collections", { collections });
  }
  getSettings(): Promise<Settings> {
    return invoke<Settings>("get_settings");
  }
  saveSettings(patch: Partial<Settings>): Promise<void> {
    return invoke<void>("save_settings", { patch });
  }
}
