import { getApiKeyValue } from './crypto.js';
import { gemini, geminiWithPdf } from './gemini.js';

function load(keys) { return new Promise(r => chrome.storage.local.get(keys, r)); }

export async function handleRunAts({ jd }) {
  const s = await load(['resumeText','resumeBase64','apiKeyEnc','apiKey']);
  const apiKey = await getApiKeyValue(s);
  if (!apiKey)                          return { error: 'No API key set.' };
  if (!s.resumeText && !s.resumeBase64) return { error: 'No resume uploaded.' };

  const system = `You are an ATS (Applicant Tracking System) expert.
Analyze the resume against the job description.
Return ONLY a JSON object, no markdown, no backticks:
{
  "score": 72,
  "matched": ["keyword1", "keyword2"],
  "missing": ["keyword3", "keyword4"],
  "totalKeywords": 15,
  "matchedCount": 10,
  "tip": "One specific actionable tip to improve the match"
}
score = percentage (matchedCount/totalKeywords*100, rounded).
Extract only meaningful keywords (skills, tools, qualifications) — not generic words.`;

  const user = `RESUME:\n${(s.resumeText || '[PDF uploaded — see attached]').slice(0, 5000)}\n\nJOB DESCRIPTION:\n${jd.slice(0, 6000)}`;

  let result;
  if (s.resumeBase64 && !s.resumeText) {
    result = await geminiWithPdf(apiKey, system, user, s.resumeBase64, 1000);
  } else {
    result = await gemini(apiKey, system, user, 1000);
  }

  if (result.error) return result;
  try {
    return JSON.parse(result.answer.replace(/```json|```/g, '').trim());
  } catch {
    return { error: 'Could not parse ATS result.' };
  }
}
