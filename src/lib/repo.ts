import type { Collection, Paper } from "../types";
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
  /** Read aloud: provider ("edge" = MS Edge neural | "system" = OS voice | "off"). */
  ttsProvider?: string;
  /** Edge voice short-name, e.g. "en-US-AriaNeural". */
  ttsVoice?: string;
  /** Speaking rate multiplier (1 = normal). */
  ttsRate?: number;
  /** Self-hosted server sync: base URL (AI backend host) + bearer token. */
  apiUrl?: string;
  apiToken?: string;
  /** Last successful server sync (server clock, ms). */
  lastSyncTs?: number;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: "light",
  density: "compact",
  view: "table",
  defaultCite: "APA",
  libraryLocation: "~/Documents/Papers",
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
  getSettings(): Promise<Settings>;
  saveSettings(patch: Partial<Settings>): Promise<void>;
}

let _repo: Repository | null = null;

// Single shared repository, chosen once based on the runtime environment.
export function repo(): Repository {
  if (!_repo) _repo = isTauri() ? new TauriRepository() : new LocalRepository();
  return _repo;
}
