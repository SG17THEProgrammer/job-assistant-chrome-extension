// ── AES-GCM key encryption ────────────────────────────────────
const ENC_SALT   = new Uint8Array([74,111,98,65,115,115,105,115,116,65,73,75,101,121]);
const ENC_SECRET = 'jobassist-local-key-v1';

async function getCryptoKey() {
  const km = await crypto.subtle.importKey('raw', new TextEncoder().encode(ENC_SECRET), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: ENC_SALT, iterations: 100000, hash: 'SHA-256' },
    km,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptApiKey(pt) {
  const key = await getCryptoKey();
  const iv  = crypto.getRandomValues(new Uint8Array(12));
  const enc = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(pt));
  const buf = new Uint8Array(12 + enc.byteLength);
  buf.set(iv);
  buf.set(new Uint8Array(enc), 12);
  return btoa(String.fromCharCode(...buf));
}

export async function decryptApiKey(ct) {
  try {
    const key  = await getCryptoKey();
    const data = Uint8Array.from(atob(ct), c => c.charCodeAt(0));
    const dec  = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: data.slice(0, 12) }, key, data.slice(12));
    return new TextDecoder().decode(dec);
  } catch {
    return ct; // fallback: treat as plaintext
  }
}

function load(keys) {
  return new Promise(r => chrome.storage.local.get(keys, r));
}

export async function getApiKeyValue(s) {
  if (s.apiKeyEnc) return decryptApiKey(s.apiKeyEnc);
  if (s.apiKey)    return s.apiKey;
  return null;
}

export async function saveApiKey(apiKey) {
  const enc = await encryptApiKey(apiKey);
  await new Promise(r => chrome.storage.local.set({ apiKeyEnc: enc, apiKey: null }, r));
  return { ok: true };
}

export async function getApiKey() {
  const s = await load(['apiKeyEnc', 'apiKey']);
  if (s.apiKeyEnc) return { key: await decryptApiKey(s.apiKeyEnc) };
  if (s.apiKey)    return { key: s.apiKey };
  return { key: null };
}

export async function testApi(apiKey) {
  const { gemini } = await import('./gemini.js');
  const r = await gemini(apiKey, 'You are helpful.', 'Reply with exactly: OK', 10);
  return r.error ? { ok: false, error: r.error } : { ok: true };
}
