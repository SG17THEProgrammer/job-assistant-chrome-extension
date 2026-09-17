import { getApiKeyValue } from './crypto.js';
import { geminiWithPdf } from './gemini.js';

function load(keys) { return new Promise(r => chrome.storage.local.get(keys, r)); }

export async function handleExtractPdfText() {
  const s = await load(['resumeBase64','apiKeyEnc','apiKey']);
  if (!s.resumeBase64) return { error: 'No PDF uploaded.' };

  const apiKey = await getApiKeyValue(s);
  if (!apiKey) return { error: 'No API key set. Add it in the API tab first, then re-upload your resume.' };

  const system = 'You are a resume parser. Extract ALL text from this resume PDF exactly as written. Preserve section headings, bullet points, dates, company names, and all content. Output plain text only — no commentary, no markdown formatting.';
  const user   = 'Extract all text from this resume. Output every word, date, company, skill, and description exactly as written.';

  const result = await geminiWithPdf(apiKey, system, user, s.resumeBase64, 4000);
  if (result.error) return result;

  const text = result.answer?.trim();
  if (!text || text.length < 50) return { error: 'Could not extract text from PDF. Try uploading as .txt instead.' };

  await new Promise(r => chrome.storage.local.set({ resumeText: text }, r));
  return { ok: true, text, length: text.length };
}
