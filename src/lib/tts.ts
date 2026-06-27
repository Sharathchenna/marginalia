// Read-aloud controller. Speaks long text (a PDF page, then the next, …) through
// either Microsoft Edge neural voices (via the `tts_speak` Tauri command) or the
// OS voice (Web Speech API) as a key-less, offline fallback.
//
// Text is split into short segments (≈ sentences). The edge path prefetches the
// next segment while the current one plays, so playback starts fast and runs
// gaplessly. Word-boundary timings drive a "now reading" caption highlight.
import { invoke, isTauri } from "./tauri";

export type TtsState = "idle" | "loading" | "playing" | "paused";
export type TtsWord = { o: number; t: string }; // offset (seconds), word text

export interface TtsConfig {
  provider: string; // "edge" | "system"
  voice: string; // edge voice short-name, e.g. "en-US-AriaNeural"
  rate: number; // speaking-rate multiplier (1 = normal)
}

export interface TtsCallbacks {
  onState?: (s: TtsState) => void;
  onCaption?: (text: string, words: TtsWord[]) => void; // current segment
  onWord?: (index: number) => void; // current word within the segment (-1 = none)
  onError?: (msg: string) => void;
}

/** Supplies more text (e.g. the next PDF page) when the queue drains; null ends. */
export type MoreProvider = () => Promise<string | null>;

type EdgeReply = { ok: boolean; audio: string; words: TtsWord[]; error?: string };
type Synth = { url: string; words: TtsWord[] };

// Split prose into speakable segments: break on sentence enders, then merge
// fragments up to ~MAX chars so each request is a natural, low-latency unit.
export function chunkIntoSegments(text: string, max = 240): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const sentences = clean.match(/[^.!?]+[.!?]+|\S[^.!?]*$/g) ?? [clean];
  const out: string[] = [];
  let cur = "";
  for (const s of sentences) {
    const piece = s.trim();
    if (!piece) continue;
    if (cur && cur.length + piece.length + 1 > max) {
      out.push(cur);
      cur = piece;
    } else {
      cur = cur ? `${cur} ${piece}` : piece;
    }
  }
  if (cur) out.push(cur);
  return out;
}

function ratePercent(r: number): string {
  const pct = Math.round((r - 1) * 100);
  return `${pct >= 0 ? "+" : ""}${pct}%`;
}

function base64ToBlobUrl(b64: string, type = "audio/mpeg"): string {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type }));
}

export class TtsController {
  private cb: TtsCallbacks;
  private cfg: TtsConfig = { provider: "edge", voice: "en-US-AriaNeural", rate: 1 };
  private segments: string[] = [];
  private idx = 0;
  private more?: MoreProvider;
  private state: TtsState = "idle";
  private gen = 0; // bumped on stop/restart to abandon in-flight async work

  // edge playback
  private audio: HTMLAudioElement | null = null;
  private prefetch = new Map<number, Promise<Synth>>();

  constructor(cb: TtsCallbacks = {}) {
    this.cb = cb;
  }

  getState(): TtsState {
    return this.state;
  }

  private setState(s: TtsState) {
    if (this.state === s) return;
    this.state = s;
    this.cb.onState?.(s);
  }

  /** Effective provider: edge only works inside the native app. */
  private get useEdge(): boolean {
    return this.cfg.provider === "edge" && isTauri();
  }

  /** Start speaking `text`; pull more via `more()` when it runs out. */
  start(text: string, cfg: TtsConfig, more?: MoreProvider) {
    this.stop();
    this.cfg = cfg;
    this.more = more;
    this.segments = chunkIntoSegments(text);
    this.idx = 0;
    if (this.segments.length === 0) {
      // Nothing on this page — try the next one immediately.
      void this.advanceOrFinish();
      return;
    }
    this.setState("loading");
    if (this.useEdge) void this.playEdge();
    else this.playSystem();
  }

  pause() {
    if (this.state !== "playing") return;
    if (this.useEdge) this.audio?.pause();
    else window.speechSynthesis?.pause();
    this.setState("paused");
  }

  resume() {
    if (this.state !== "paused") return;
    if (this.useEdge) void this.audio?.play();
    else window.speechSynthesis?.resume();
    this.setState("playing");
  }

  toggle(text: string, cfg: TtsConfig, more?: MoreProvider) {
    if (this.state === "playing") this.pause();
    else if (this.state === "paused") this.resume();
    else this.start(text, cfg, more);
  }

  stop() {
    this.gen++;
    if (this.audio) {
      this.audio.pause();
      this.audio.removeAttribute("src");
      this.audio.load();
      // Drop the element so a fresh one (no stale listeners) is made next run.
      this.audio = null;
    }
    for (const p of this.prefetch.values()) void p.then((s) => URL.revokeObjectURL(s.url)).catch(() => {});
    this.prefetch.clear();
    window.speechSynthesis?.cancel();
    this.segments = [];
    this.idx = 0;
    this.cb.onWord?.(-1);
    this.cb.onCaption?.("", []);
    this.setState("idle");
  }

  /** Live speed change. Edge bakes rate into synthesis (applies to upcoming
   * segments); the OS path can retime immediately on the next utterance. */
  setRate(r: number) {
    this.cfg.rate = r;
  }

  private async advanceOrFinish(): Promise<void> {
    const gen = this.gen;
    if (this.more) {
      const next = await this.more();
      if (gen !== this.gen) return;
      if (next) {
        const segs = chunkIntoSegments(next);
        if (segs.length) {
          this.segments.push(...segs);
          if (this.useEdge) void this.playEdge();
          else this.playSystem();
          return;
        }
        // Empty page (e.g. a figure) — keep going.
        return this.advanceOrFinish();
      }
    }
    this.stop();
  }

  // ---- Microsoft Edge neural path ----

  private synthesize(i: number): Promise<Synth> {
    let p = this.prefetch.get(i);
    if (!p) {
      const seg = this.segments[i];
      p = invoke<EdgeReply>("tts_speak", {
        text: seg,
        voice: this.cfg.voice,
        rate: ratePercent(this.cfg.rate),
        pitch: "+0Hz",
      }).then((r) => ({ url: base64ToBlobUrl(r.audio), words: r.words || [] }));
      this.prefetch.set(i, p);
    }
    return p;
  }

  private async playEdge() {
    const gen = this.gen;
    if (this.idx >= this.segments.length) return this.advanceOrFinish();

    if (!this.audio) this.audio = new Audio();
    const audio = this.audio;
    let synth: Synth;
    try {
      synth = await this.synthesize(this.idx);
    } catch (e) {
      if (gen !== this.gen) return;
      this.cb.onError?.(e instanceof Error ? e.message : String(e));
      this.stop();
      return;
    }
    if (gen !== this.gen) return;

    this.cb.onCaption?.(this.segments[this.idx], synth.words);
    audio.src = synth.url;
    audio.playbackRate = 1; // rate is baked into the synthesized audio

    // Prefetch the next segment while this one plays.
    if (this.idx + 1 < this.segments.length) void this.synthesize(this.idx + 1).catch(() => {});

    const words = synth.words;
    const onTime = () => {
      if (gen !== this.gen) return;
      const t = audio.currentTime;
      let wi = -1;
      for (let k = 0; k < words.length; k++) {
        if (words[k].o <= t) wi = k;
        else break;
      }
      this.cb.onWord?.(wi);
    };
    const onEnded = () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("ended", onEnded);
      this.prefetch.delete(this.idx);
      URL.revokeObjectURL(synth.url);
      if (gen !== this.gen) return;
      this.idx++;
      void this.playEdge();
    };
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("ended", onEnded);

    try {
      await audio.play();
      if (gen === this.gen) this.setState("playing");
    } catch {
      /* play() can reject if paused before it starts — harmless */
    }
  }

  // ---- OS voice (Web Speech API) fallback ----

  private playSystem() {
    const gen = this.gen;
    if (this.idx >= this.segments.length) {
      void this.advanceOrFinish();
      return;
    }
    const synth = window.speechSynthesis;
    if (!synth) {
      this.cb.onError?.("This platform has no built-in speech voices.");
      this.stop();
      return;
    }
    const seg = this.segments[this.idx];
    const u = new SpeechSynthesisUtterance(seg);
    u.rate = Math.max(0.1, Math.min(10, this.cfg.rate));
    // Best-effort: match a system voice to the configured locale.
    const locale = this.cfg.voice.split("-").slice(0, 2).join("-");
    const voices = synth.getVoices();
    const match = voices.find((v) => v.lang === locale) || voices.find((v) => v.lang.startsWith(locale.split("-")[0]));
    if (match) u.voice = match;

    this.cb.onCaption?.(seg, []);
    u.onboundary = (e) => {
      if (gen !== this.gen) return;
      if (e.name && e.name !== "word") return;
      const wi = seg.slice(0, e.charIndex).trim().split(/\s+/).filter(Boolean).length;
      this.cb.onWord?.(wi);
    };
    u.onend = () => {
      if (gen !== this.gen) return;
      this.idx++;
      this.playSystem();
    };
    u.onerror = () => {
      if (gen !== this.gen) return;
      this.idx++;
      this.playSystem();
    };
    synth.speak(u);
    this.setState("playing");
  }
}
