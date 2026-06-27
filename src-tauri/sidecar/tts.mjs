// Text-to-speech sidecar — Microsoft Edge online neural voices, free & key-less,
// via the `edge-tts-universal` library (handles the rotating Sec-MS-GEC token).
//
// Spawned by the Tauri backend (src-tauri/src/tts.rs) per request. Reads one JSON
// op from stdin and writes ONE JSON line to stdout, then exits:
//
//   {"op":"speak","text":"…","voice":"en-US-AriaNeural","rate":"+0%","pitch":"+0Hz"}
//     -> {"ok":true,"audio":"<base64 mp3>","words":[{"o":0.1,"t":"Hello"}, …]}
//
//   {"op":"voices"}
//     -> {"ok":true,"voices":[{"name":"en-US-AriaNeural","label":"Aria",
//                              "locale":"en-US","gender":"Female"}, …]}
//
// On failure: {"ok":false,"error":"…"}. Network is required (cloud synthesis).

import { Communicate, listVoices } from "edge-tts-universal";

function readStdin() {
  return new Promise((resolve) => {
    let buf = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (d) => (buf += d));
    process.stdin.on("end", () => resolve(buf));
  });
}

function reply(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

async function speak({ text, voice, rate, pitch }) {
  const c = new Communicate(text, {
    voice: voice || "en-US-AriaNeural",
    rate: rate || "+0%",
    pitch: pitch || "+0Hz",
  });
  const audio = [];
  const words = [];
  for await (const chunk of c.stream()) {
    if (chunk.type === "audio" && chunk.data) {
      audio.push(Buffer.from(chunk.data));
    } else if (chunk.type === "WordBoundary") {
      // offset/duration are in 100-nanosecond units; expose offset in seconds.
      words.push({ o: (chunk.offset || 0) / 1e7, t: chunk.text || "" });
    }
  }
  const mp3 = Buffer.concat(audio);
  if (mp3.length === 0) throw new Error("No audio received");
  reply({ ok: true, audio: mp3.toString("base64"), words });
}

async function voices() {
  const list = await listVoices();
  const voices = list.map((v) => ({
    name: v.ShortName,
    // "Microsoft Aria Online (Natural) - English (United States)" → "Aria"
    label: (v.FriendlyName || v.ShortName).replace(/^Microsoft\s+/, "").replace(/\s+Online.*$/, ""),
    locale: v.Locale,
    gender: v.Gender,
  }));
  reply({ ok: true, voices });
}

async function main() {
  try {
    const raw = (await readStdin()).trim();
    const req = raw ? JSON.parse(raw) : {};
    if (req.op === "voices") await voices();
    else if (req.op === "speak") await speak(req);
    else throw new Error(`Unknown op: ${req.op}`);
  } catch (e) {
    reply({ ok: false, error: e?.message || String(e) });
    process.exitCode = 1;
  }
}

main();
