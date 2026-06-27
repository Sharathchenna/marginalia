import { COLLECTIONS, PAPERS } from "../data";
import type { Collection, Feed, Paper } from "../types";
import {
  DEFAULT_SETTINGS,
  type Repository,
  type Settings,
} from "./repo";

const K_PAPERS = "marginalia.papers";
const K_COLLECTIONS = "marginalia.collections";
const K_FEEDS = "marginalia.feeds";
const K_SETTINGS = "marginalia.settings";

function read<T>(key: string, fallback: T): T {
  const raw = localStorage.getItem(key);
  if (raw == null) return fallback; // key absent → seed/fallback is correct
  try {
    return JSON.parse(raw) as T;
  } catch {
    // Key present but unparseable: preserve the raw bytes so the user's data is
    // recoverable instead of being silently overwritten by the fallback.
    try {
      localStorage.setItem(key + ".corrupt", raw);
    } catch {
      /* ignore */
    }
    return fallback;
  }
}
function write<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota exceeded / private mode — the write is dropped (state stays in the
       React store for this session); nothing else we can safely do here */
  }
}

// Local-first browser backend. Seeds from the bundled demo library on first
// run, then persists every change to localStorage so it survives reloads.
export class LocalRepository implements Repository {
  constructor() {
    if (localStorage.getItem(K_PAPERS) === null) {
      write(K_PAPERS, PAPERS);
      write(K_COLLECTIONS, COLLECTIONS);
      write(K_SETTINGS, DEFAULT_SETTINGS);
    }
  }

  async listPapers(): Promise<Paper[]> {
    return read<Paper[]>(K_PAPERS, PAPERS);
  }
  async replacePapers(papers: Paper[]): Promise<void> {
    write(K_PAPERS, papers);
  }
  async addPaper(p: Paper): Promise<void> {
    const list = await this.listPapers();
    write(K_PAPERS, [p, ...list.filter((x) => x.id !== p.id)]);
  }
  async updatePaper(id: string, patch: Partial<Paper>): Promise<void> {
    const list = await this.listPapers();
    write(
      K_PAPERS,
      list.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    );
  }
  async deletePaper(id: string): Promise<void> {
    const list = await this.listPapers();
    write(
      K_PAPERS,
      list.filter((p) => p.id !== id),
    );
  }
  async listCollections(): Promise<Collection[]> {
    return read<Collection[]>(K_COLLECTIONS, COLLECTIONS);
  }
  async saveCollections(collections: Collection[]): Promise<void> {
    write(K_COLLECTIONS, collections);
  }
  async listFeeds(): Promise<Feed[]> {
    return read<Feed[]>(K_FEEDS, []);
  }
  async saveFeeds(feeds: Feed[]): Promise<void> {
    write(K_FEEDS, feeds);
  }
  async getSettings(): Promise<Settings> {
    return { ...DEFAULT_SETTINGS, ...read<Partial<Settings>>(K_SETTINGS, {}) };
  }
  async saveSettings(patch: Partial<Settings>): Promise<void> {
    write(K_SETTINGS, { ...(await this.getSettings()), ...patch });
  }
}
