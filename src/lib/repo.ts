import type { Collection, Feed, Paper } from "../types";
import type { CiteStyle, Density, Theme, ViewMode } from "../types";
import { isTauri } from "./tauri";
import { LocalRepository } from "./localRepo";
import { TauriRepository } from "./tauriRepo";

export interface Settings {
  theme: Theme;
  density: Density;
  view: ViewMode;
  defaultCite: CiteStyle;
  libraryLocation: string;
  watchFolders: string[];
  /** Whether the user has chosen a library folder (gates onboarding). */
  librarySet: boolean;
  /** Translucent (real OS glass) interface. Optional — defaults per platform. */
  glass?: boolean;
  /** Model id for AI actions; "" / undefined = SDK default. */
  model?: string;
  /** Semantic search: provider ("off" | "voyage"), embedding model, API key. */
  embedProvider?: string;
  embedModel?: string;
  voyageKey?: string;
  /** Keep <library>/library.bib in sync with the library on every change. */
  autoBib?: boolean;
  /** Optional user-hosted WebDAV sync target (snapshot file URL) + credentials. */
  webdavUrl?: string;
  webdavUser?: string;
  webdavPass?: string;
  /** Passphrase for end-to-end-encrypting the sync snapshot (never leaves device). */
  syncPassphrase?: string;
  /** Self-hosted server (see server/ + server-rs/): AI backend on iOS/web AND the
   * per-record sync + PDF + feed server (host, port 8443). */
  apiUrl?: string;
  apiToken?: string;
  /** Auto-sync on this device: pull on launch, push on backgrounding (opt-in). */
  syncAuto?: boolean;
  /** Read aloud: provider ("edge" = MS Edge neural | "system" = OS voice | "off"). */
  ttsProvider?: string;
  /** Edge voice short-name, e.g. "en-US-AriaNeural". */
  ttsVoice?: string;
  /** Speaking rate multiplier (1 = normal). */
  ttsRate?: number;
  /** Epoch-ms of the last successful sync (server clock) — guards redundant pulls. */
  lastSyncTs?: number;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: "light",
  density: "compact",
  view: "table",
  defaultCite: "APA",
  // keep in sync with the Rust default_settings() (src-tauri/src/lib.rs)
  libraryLocation: "~/Documents/Marginalia",
  watchFolders: ["~/Downloads/Papers", "~/Dropbox/Zotero-inbox"],
  // Browser dev preview skips onboarding; the native app sets this false so the
  // folder picker shows on first run.
  librarySet: true,
  ttsProvider: "edge",
  ttsVoice: "en-US-AriaNeural",
  ttsRate: 1.0,
};

// All app data access goes through this interface. The localStorage and Tauri
// (SQLite) backends are interchangeable — the UI never knows which is live.
export interface Repository {
  listPapers(): Promise<Paper[]>;
  replacePapers(papers: Paper[]): Promise<void>;
  addPaper(p: Paper): Promise<void>;
  updatePaper(id: string, patch: Partial<Paper>): Promise<void>;
  deletePaper(id: string): Promise<void>;
  listCollections(): Promise<Collection[]>;
  saveCollections(collections: Collection[]): Promise<void>;
  listFeeds(): Promise<Feed[]>;
  saveFeeds(feeds: Feed[]): Promise<void>;
  getSettings(): Promise<Settings>;
  saveSettings(patch: Partial<Settings>): Promise<void>;
}

let _repo: Repository | null = null;

// Single shared repository, chosen once based on the runtime environment.
export function repo(): Repository {
  if (!_repo) _repo = isTauri() ? new TauriRepository() : new LocalRepository();
  return _repo;
}
