import { getApiKeyValue } from './crypto.js';
import { gemini, geminiWithPdf } from './gemini.js';

function load(keys) { return new Promise(r => chrome.storage.local.get(keys, r)); }
function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

export async function handleTailorResume({ jd, style }) {
  const s = await load(['resumeText','resumeBase64','apiKeyEnc','apiKey']);
  const apiKey = await getApiKeyValue(s);
  if (!apiKey)                          return { error: 'No API key set.' };
  if (!s.resumeText && !s.resumeBase64) return { error: 'No resume uploaded.' };

  const system = `You are an expert resume writer and ATS specialist.
Rewrite the resume to match the job description.
RULES: Only use experience in the original resume. Do NOT invent anything.
${style ? `Style: ${style}` : ''}
Return ONLY JSON, no markdown:
{"tailoredResume":"...","matchedKeywords":["..."],"missingKeywords":["..."],"atsScore":75}`;

  const user = `RESUME:\n${(s.resumeText || '[See attached PDF]').slice(0, 6000)}\n\nJD:\n${jd.slice(0, 6000)}`;

  let r;
  if (s.resumeBase64 && !s.resumeText) {
    r = await geminiWithPdf(apiKey, system, user, s.resumeBase64, 2500);
  } else {
    r = await gemini(apiKey, system, user, 2500);
  }

  if (r.error) return r;
  try { return JSON.parse(r.answer.replace(/```json|```/g, '').trim()); }
  catch { return { error: 'Could not parse response. Try again.' }; }
}

export async function handleEditResume({ editPrompt }) {
  const s = await load(['tailoredResumeText','apiKeyEnc','apiKey']);
  const apiKey = await getApiKeyValue(s);
  if (!apiKey)               return { error: 'No API key set.' };
  if (!s.tailoredResumeText) return { error: 'Generate a tailored resume first.' };

  const r = await gemini(
    apiKey,
    'Edit the resume per the instruction. Output ONLY the updated resume text.',
    `RESUME:\n${s.tailoredResumeText}\n\nINSTRUCTION:\n${editPrompt}`,
    2500
  );
  if (r.error) return r;
  return { tailoredResume: r.answer };
}

export async function handleGeneratePdf() {
  const s = await load(['tailoredResumeText','firstName','lastName']);
  if (!s.tailoredResumeText) return { error: 'Generate a tailored resume first.' };

  const name  = [s.firstName, s.lastName].filter(Boolean).join(' ') || 'Resume';
  const lines = s.tailoredResumeText.split('\n');
  const html  = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${esc(name)}</title>
<style>body{font-family:Georgia,serif;max-width:750px;margin:40px auto;padding:0 40px;color:#1a1a1a;font-size:14px;line-height:1.7}
h2{font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;margin:22px 0 5px;border-bottom:1px solid #ccc;padding-bottom:3px;color:#333}
p{margin:2px 0}li{margin:2px 0 2px 20px}@media print{body{margin:20px;padding:0 20px}}</style>
</head><body>${lines.map(l => {
    if (!l.trim()) return '<br/>';
    if (l === l.toUpperCase() && l.trim().length > 2 && l.trim().length < 50) return `<h2>${esc(l)}</h2>`;
    if (/^[•\-\*]\s/.test(l)) return `<li>${esc(l.replace(/^[•\-\*]\s*/,''))}</li>`;
    return `<p>${esc(l)}</p>`;
  }).join('\n')}</body></html>`;

  const tab = await chrome.tabs.create({ url: 'data:text/html;charset=utf-8,' + encodeURIComponent(html), active: true });
  setTimeout(async () => {
    try { await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => window.print() }); } catch {}
  }, 1200);
  return { ok: true };
}
