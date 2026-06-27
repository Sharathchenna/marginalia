// End-to-end encryption for the sync snapshot (Bet D). The library is encrypted
// on-device with a passphrase before it ever touches the WebDAV server, so the
// server (and anyone with access to it) only ever sees ciphertext. AES-256-GCM
// with a PBKDF2-derived key, via the Web Crypto API (available in the Tauri
// webview and on localhost — both secure contexts).
const enc = new TextEncoder();
const dec = new TextDecoder();

function toB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  const CHUNK = 0x8000; // chunk so large libraries don't overflow the call stack
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(s);
}
function fromB64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

async function deriveKey(passphrase: string, salt: BufferSource): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey(
    "raw",
    enc.encode(passphrase) as BufferSource,
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 200_000, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** Encrypt a plaintext snapshot into a self-describing JSON envelope. */
export async function encryptJson(plaintext: string, passphrase: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    enc.encode(plaintext) as BufferSource,
  );
  return JSON.stringify({
    "marg-enc": 1,
    salt: toB64(salt.buffer),
    iv: toB64(iv.buffer),
    ct: toB64(ct),
  });
}

/** True if `blob` is a Marginalia encrypted envelope. */
export function isEncrypted(blob: string): boolean {
  try {
    return JSON.parse(blob)?.["marg-enc"] === 1;
  } catch {
    return false;
  }
}

/** Decrypt an envelope produced by encryptJson. Throws on a wrong passphrase. */
export async function decryptJson(blob: string, passphrase: string): Promise<string> {
  const env = JSON.parse(blob);
  if (!env || env["marg-enc"] !== 1) return blob; // already plaintext
  const key = await deriveKey(passphrase, fromB64(env.salt) as BufferSource);
  try {
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromB64(env.iv) as BufferSource },
      key,
      fromB64(env.ct) as BufferSource,
    );
    return dec.decode(pt);
  } catch {
    throw new Error("Wrong passphrase — couldn't decrypt the synced library.");
  }
}
