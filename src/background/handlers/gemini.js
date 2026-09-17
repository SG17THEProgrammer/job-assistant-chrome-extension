// ── Gemini API callers ────────────────────────────────────────
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent';

export async function gemini(apiKey, systemText, userText, maxTokens = 800) {
  try {
    const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemText }] },
        contents: [{ role: 'user', parts: [{ text: userText }] }],
        generationConfig: { maxOutputTokens: maxTokens, temperature: 0.4 },
      }),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      return { error: e.error?.message || `Gemini error ${res.status}` };
    }
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!text) return { error: 'Empty response from Gemini.' };
    return { answer: text };
  } catch (e) {
    return { error: `Network error: ${e.message}` };
  }
}

export async function geminiWithPdf(apiKey, systemText, userText, base64DataUrl, maxTokens = 800) {
  try {
    const b64 = base64DataUrl.includes(',') ? base64DataUrl.split(',')[1] : base64DataUrl;
    const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemText }] },
        contents: [{ role: 'user', parts: [
          { inline_data: { mime_type: 'application/pdf', data: b64 } },
          { text: userText },
        ]}],
        generationConfig: { maxOutputTokens: maxTokens, temperature: 0.4 },
      }),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      return { error: `${e.error?.message || res.status}. Try uploading resume as .txt instead.` };
    }
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!text) return { error: 'Empty response.' };
    return { answer: text };
  } catch (e) {
    return { error: `Network error: ${e.message}` };
  }
}
