// ═══════════════════════════════════════════════════════════
//  JobAssist AI — Background Service Worker v3
//  Gemini API · strict no-hallucination prompt
// ═══════════════════════════════════════════════════════════

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent';

// ══════════════════════════════════════════════════════════
//  AES-GCM ENCRYPTION — protects API key at rest
//  Key is derived from a fixed extension-scoped secret
//  using PBKDF2. Not perfect but far better than plaintext.
// ══════════════════════════════════════════════════════════
const ENC_SALT = new Uint8Array([74, 111, 98, 65, 115, 115, 105, 115, 116, 65, 73, 75, 101, 121]);
const ENC_SECRET = 'jobassist-local-key-v1';

async function getCryptoKey() {
  const keyMaterial = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(ENC_SECRET), 'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: ENC_SALT, iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false, ['encrypt', 'decrypt']
  );
}

async function encryptApiKey(plaintext) {
  const key = await getCryptoKey();
  const iv  = crypto.getRandomValues(new Uint8Array(12));
  const enc = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext)
  );
  // Store iv + ciphertext as base64
  const combined = new Uint8Array(iv.byteLength + enc.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(enc), iv.byteLength);
  return btoa(String.fromCharCode(...combined));
}

async function decryptApiKey(ciphertext) {
  try {
    const key  = await getCryptoKey();
    const data = Uint8Array.from(atob(ciphertext), c => c.charCodeAt(0));
    const iv   = data.slice(0, 12);
    const enc  = data.slice(12);
    const dec  = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, enc);
    return new TextDecoder().decode(dec);
  } catch {
    // Fallback: might be old plaintext key stored before encryption was added
    return ciphertext;
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const handlers = {
    GENERATE_ANSWER:  () => handleGenerateAnswer(msg),
    TAILOR_RESUME:    () => handleTailorResume(msg),
    EDIT_RESUME:      () => handleEditResume(msg),
    GENERATE_PDF:     () => handleGeneratePdf(),
    GET_MY_CONTEXT:   () => handleGetMyContext(),
    TEST_API:         () => testApi(msg.apiKey),
    SAVE_API_KEY:     () => saveApiKey(msg.apiKey),
    GET_API_KEY:      () => getApiKey(),
  };
  const handler = handlers[msg.type];
  if (handler) { handler().then(sendResponse); return true; }
});

async function saveApiKey(plaintext) {
  const encrypted = await encryptApiKey(plaintext);
  await new Promise(r => chrome.storage.local.set({ apiKeyEnc: encrypted, apiKey: null }, r));
  return { ok: true };
}

async function getApiKey() {
  const s = await load(['apiKeyEnc', 'apiKey']);
  if (s.apiKeyEnc) return { key: await decryptApiKey(s.apiKeyEnc) };
  if (s.apiKey)    return { key: s.apiKey }; // legacy plaintext fallback
  return { key: null };
}

// ══════════════════════════════════════════════════════════
//  GENERATE ANSWER — strict, no hallucination
// ══════════════════════════════════════════════════════════
async function handleGenerateAnswer({ question, jobDescription, fieldHint, companyName }) {
  const s = await load([
    'resumeText', 'resumeBase64',
    'firstName', 'lastName', 'email', 'phone',
    'city', 'state', 'country',
    'linkedinUrl', 'githubUrl', 'portfolioUrl', 'githubData',
    'currentCtc', 'expectedCtc', 'noticePeriod', 'experience',
    'workAuth', 'relocate', 'workMode',
    'degree', 'college', 'gradYear', 'cgpa',
    'extraContext', 'answerStyle', 'tone', 'customInstruction', 'apiKey', 'companies'
  ]);
  // Build a structured profile summary for the prompt
  const profileSummary = buildProfileSummary(s);

  const apiKeyResult = await getApiKey();
  const apiKey = apiKeyResult.key;
  if (!apiKey)                            return { error: 'No API key set. Add it in the extension popup (API tab).' };
  if (!s.resumeText && !s.resumeBase64)   return { error: 'No resume uploaded. Add it in the extension popup (Profile tab).' };
  s.apiKey = apiKey; // inject decrypted key

  const styleGuide = {
    concise:  'Write 2–3 sentences only. Be direct and specific.',
    balanced: 'Write one focused paragraph (4–6 sentences) with one real, specific example from the resume.',
    detailed: 'Write 2–3 paragraphs: briefly set context, give a specific example with a measurable outcome, then connect to the role.',
  }[s.answerStyle || 'balanced'];

  const companyNote = (companyName && s.companies?.[companyName])
    ? `\nCOMPANY NOTES (saved by user):\n${s.companies[companyName]}`
    : '';

  // ── STRICT system prompt — no hallucination ──
  const systemText = `You are a job application assistant helping a user answer application questions.
You write in FIRST PERSON on behalf of the user.

CRITICAL RULES — follow these absolutely:
1. ONLY use information explicitly present in the resume text provided below.
2. Do NOT invent, assume, or embellish any company names, job titles, projects, technologies, dates, or achievements.
3. If the resume does not contain enough information to answer a specific part of the question, say what IS in the resume and acknowledge the limitation honestly (e.g. "While my resume focuses on X, I am eager to grow in Y").
4. Do NOT mention any company (e.g. Amazon, Google, Microsoft) unless it literally appears in the resume text.
5. Do NOT mention any technology, skill, or project unless it literally appears in the resume text or the user's extra context.
6. If the resume is empty or missing, say: "Please upload your resume in the JobAssist extension popup so I can write an accurate answer."

STYLE: ${styleGuide}
TONE: ${s.tone || 'professional'}
OUTPUT: Return ONLY the answer text. No preamble, no quotes around it, no meta-comments.

=== USER PROFILE ===
${profileSummary}

${s.resumeText
  ? `=== USER'S RESUME (the ONLY source of truth for experience/projects) ===\n${s.resumeText.slice(0, 8000)}`
  : '=== NO RESUME TEXT AVAILABLE — tell user to upload resume ==='
}
${s.githubData ? `\n=== GITHUB PROFILE (verified) ===\n${buildGithubSummary(s.githubData)}` : ''}
${s.linkedinUrl ? `\nLinkedIn URL: ${s.linkedinUrl}` : ''}
${s.extraContext ? `\n=== USER'S OWN NOTES ===\n${s.extraContext}` : ''}
${s.customInstruction ? `\n=== USER'S WRITING INSTRUCTIONS ===\n${s.customInstruction}` : ''}
${companyNote}`;

  const userText = [
    jobDescription ? `JOB DESCRIPTION (for context):\n${jobDescription.slice(0, 2500)}\n` : '',
    fieldHint      ? `Form field label: "${fieldHint}"\n` : '',
    `APPLICATION QUESTION:\n${question}\n\nWrite my answer now:`,
  ].filter(Boolean).join('\n');

  // If resume is a PDF (base64), include it as inline_data in the Gemini request
  if (s.resumeBase64 && !s.resumeText) {
    return geminiWithPdf(s.apiKey, systemText, userText, s.resumeBase64, 700);
  }
  return gemini(s.apiKey, systemText, userText, 700);
}

// ══════════════════════════════════════════════════════════
//  GET MY CONTEXT — returns what the AI knows about user
// ══════════════════════════════════════════════════════════
async function handleGetMyContext() {
  const s = await load([
    'resumeText', 'resumeBase64', 'resumeFileName',
    'firstName', 'lastName', 'email', 'phone',
    'city', 'state', 'country', 'zipcode',
    'linkedinUrl', 'githubUrl', 'portfolioUrl', 'githubData', 'linkedinData',
    'currentCtc', 'expectedCtc', 'noticePeriod', 'experience',
    'workAuth', 'relocate', 'workMode',
    'degree', 'college', 'gradYear', 'cgpa',
    'extraContext', 'customInstruction',
    'answerStyle', 'tone', 'companies', 'apiKey'
  ]);

  const sections = [];

  const hasResume = !!(s.resumeText || s.resumeBase64);
  sections.push({
    title: 'Resume',
    status: hasResume ? 'loaded' : 'missing',
    detail: hasResume
      ? `File: ${s.resumeFileName || 'uploaded'}\nFormat: ${s.resumeBase64 ? 'PDF (binary stored)' : 'Text'}\n${s.resumeText ? `Characters: ${s.resumeText.length}\nPreview:\n${s.resumeText.slice(0, 400)}…` : 'PDF is stored and will be sent to AI with each request.'}`
      : 'No resume uploaded. The AI cannot answer accurately without it. Go to the Profile tab and upload your resume.'
  });

  sections.push({
    title: 'GitHub',
    status: s.githubData ? 'connected' : (s.githubUrl ? 'url-only' : 'missing'),
    detail: s.githubData
      ? buildGithubSummary(s.githubData)
      : s.githubUrl
        ? `URL saved: ${s.githubUrl}\nData not fetched yet — click the verify button in the Profile tab.`
        : 'Not connected.'
  });

  sections.push({
    title: 'LinkedIn',
    status: s.linkedinUrl ? 'url-saved' : 'missing',
    detail: s.linkedinUrl
      ? `URL: ${s.linkedinUrl}\nNote: Full LinkedIn profile data requires OAuth (see README). For now the AI references your URL as context.`
      : 'Not added.'
  });

  const profileLines = buildProfileSummary(s);
  const hasProfile = !!(s.firstName || s.email || s.phone);
  sections.push({
    title: 'Personal info',
    status: hasProfile ? 'set' : 'empty',
    detail: hasProfile ? profileLines : 'No personal info saved yet. Fill in the Profile tab.'
  });

  sections.push({
    title: 'Extra context',
    status: s.extraContext ? 'set' : 'empty',
    detail: s.extraContext || 'None added. Use this to tell the AI about career goals, preferred work style, salary expectations, etc.'
  });

  sections.push({
    title: 'Writing preferences',
    status: 'set',
    detail: `Answer style: ${s.answerStyle || 'balanced'}\nTone: ${s.tone || 'professional'}\nCustom instruction: ${s.customInstruction || 'none'}`
  });

  const companyNames = Object.keys(s.companies || {});
  sections.push({
    title: 'Saved companies',
    status: companyNames.length ? 'set' : 'empty',
    detail: companyNames.length
      ? companyNames.map(n => `• ${n}`).join('\n')
      : 'No companies saved yet.'
  });

  sections.push({
    title: 'API key',
    status: s.apiKey ? 'set' : 'missing',
    detail: s.apiKey ? `Set ✓ (${s.apiKey.slice(0, 8)}…)` : 'Not set. Add in the API tab.'
  });

  return { sections };
}

// ══════════════════════════════════════════════════════════
//  TAILOR RESUME
// ══════════════════════════════════════════════════════════
async function handleTailorResume({ jd, style }) {
  const s = await load(['resumeText', 'resumeBase64', 'apiKey', 'fullName', 'githubData']);
  if (!s.apiKey)                        return { error: 'No API key set.' };
  if (!s.resumeText && !s.resumeBase64) return { error: 'No resume uploaded.' };

  const systemText = `You are an expert resume writer and ATS specialist.
Your task: rewrite the provided resume to match the job description.

RULES:
1. Only use experience and skills that exist in the original resume. Do NOT add fake companies, projects, or skills.
2. Reorder and reword content to highlight what's most relevant to the JD.
3. Incorporate JD keywords naturally where they are genuinely reflected in experience.
4. Quantify achievements if numbers are already present in the resume.
5. Remove or de-emphasise things irrelevant to this role.
${style ? `6. Style instructions from user: ${style}` : ''}

Return ONLY a JSON object with no markdown, no backticks:
{
  "tailoredResume": "full rewritten resume text",
  "matchedKeywords": ["keyword1", "keyword2"],
  "missingKeywords": ["keyword3"],
  "atsScore": 75
}

matchedKeywords = keywords from JD that appear in the tailored resume.
missingKeywords = important JD keywords the user genuinely lacks (don't add fake experience for these).
atsScore = honest 0-100 estimate.`;

  const userText = `ORIGINAL RESUME:\n${(s.resumeText || '').slice(0, 6000)}\n\nJOB DESCRIPTION:\n${jd.slice(0, 3000)}`;
  const result = await gemini(s.apiKey, systemText, userText, 2500);
  if (result.error) return result;

  try {
    const clean = result.answer.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
  } catch {
    return { error: 'Could not parse AI response. Try again.' };
  }
}

// ══════════════════════════════════════════════════════════
//  EDIT RESUME
// ══════════════════════════════════════════════════════════
async function handleEditResume({ editPrompt }) {
  const s = await load(['tailoredResumeText', 'apiKey']);
  if (!s.apiKey)             return { error: 'No API key set.' };
  if (!s.tailoredResumeText) return { error: 'Generate a tailored resume first.' };

  const systemText = `You are a resume editor. Apply the user's edit instruction exactly.
Do NOT add any experience, companies, or skills not already in the resume.
Output ONLY the updated resume text — no explanation, no markdown wrapper.`;
  const userText = `RESUME:\n${s.tailoredResumeText}\n\nEDIT INSTRUCTION:\n${editPrompt}`;
  const result   = await gemini(s.apiKey, systemText, userText, 2500);
  if (result.error) return result;
  return { tailoredResume: result.answer };
}

// ══════════════════════════════════════════════════════════
//  GENERATE PDF
// ══════════════════════════════════════════════════════════
async function handleGeneratePdf() {
  const s = await load(['tailoredResumeText', 'fullName']);
  if (!s.tailoredResumeText) return { error: 'Generate a tailored resume first.' };

  const name  = s.fullName || 'Resume';
  const lines = s.tailoredResumeText.split('\n');
  const htmlLines = lines.map(line => {
    if (!line.trim()) return '<br/>';
    if (line === line.toUpperCase() && line.trim().length > 2 && line.trim().length < 50)
      return `<h2>${escHtml(line)}</h2>`;
    if (/^[•\-\*]\s/.test(line))
      return `<li>${escHtml(line.replace(/^[•\-\*]\s*/, ''))}</li>`;
    return `<p>${escHtml(line)}</p>`;
  });

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${escHtml(name)}</title>
<style>
  body{font-family:Georgia,serif;max-width:750px;margin:40px auto;padding:0 40px;color:#1a1a1a;font-size:14px;line-height:1.7}
  h2{font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;margin:22px 0 5px;border-bottom:1px solid #ccc;padding-bottom:3px;color:#333}
  p{margin:2px 0}
  li{margin:2px 0 2px 20px}
  @media print{body{margin:20px;padding:0 20px}}
</style></head><body>${htmlLines.join('\n')}</body></html>`;

  const dataUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
  const tab = await chrome.tabs.create({ url: dataUrl, active: true });
  setTimeout(async () => {
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => window.print() });
    } catch {}
  }, 1200);
  return { ok: true };
}

// ══════════════════════════════════════════════════════════
//  TEST API
// ══════════════════════════════════════════════════════════
async function testApi(apiKey) {
  const r = await gemini(apiKey, 'You are helpful.', 'Reply with exactly: OK', 10);
  return r.error ? { ok: false, error: r.error } : { ok: true };
}

// ══════════════════════════════════════════════════════════
//  GEMINI CALLER
// ══════════════════════════════════════════════════════════
async function gemini(apiKey, systemText, userText, maxTokens = 800) {
  try {
    const body = {
      system_instruction: { parts: [{ text: systemText }] },
      contents: [{ role: 'user', parts: [{ text: userText }] }],
      generationConfig: { maxOutputTokens: maxTokens, temperature: 0.4 }, // lower temp = less hallucination
    };
    const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return { error: err.error?.message || `Gemini API error ${res.status}` };
    }
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!text) return { error: 'Empty response from Gemini. Try again.' };
    return { answer: text };
  } catch (e) {
    return { error: `Network error: ${e.message}` };
  }
}

// ══════════════════════════════════════════════════════════
//  GEMINI WITH PDF (inline base64 document)
// ══════════════════════════════════════════════════════════
async function geminiWithPdf(apiKey, systemText, userText, base64DataUrl, maxTokens = 800) {
  try {
    // Strip the data:application/pdf;base64, prefix
    const base64Data = base64DataUrl.includes(',')
      ? base64DataUrl.split(',')[1]
      : base64DataUrl;

    const body = {
      system_instruction: { parts: [{ text: systemText }] },
      contents: [{
        role: 'user',
        parts: [
          {
            inline_data: {
              mime_type: 'application/pdf',
              data: base64Data,
            }
          },
          { text: userText }
        ]
      }],
      generationConfig: { maxOutputTokens: maxTokens, temperature: 0.4 },
    };

    const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      // If PDF fails, return a clear error
      return { error: `Gemini PDF error: ${err.error?.message || res.status}. Try uploading your resume as a .txt file instead.` };
    }

    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!text) return { error: 'Empty response. Try again.' };
    return { answer: text };
  } catch (e) {
    return { error: `Network error: ${e.message}` };
  }
}

// ── Helpers ───────────────────────────────────────────────
function load(keys) {
  return new Promise(r => chrome.storage.local.get(keys, r));
}

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function buildProfileSummary(s) {
  const lines = [];
  const name = [s.firstName, s.lastName].filter(Boolean).join(' ');
  if (name)           lines.push(`Name: ${name}`);
  if (s.email)        lines.push(`Email: ${s.email}`);
  if (s.phone)        lines.push(`Phone: ${s.phone}`);
  const location = [s.city, s.state, s.country].filter(Boolean).join(', ');
  if (location)       lines.push(`Location: ${location}`);
  if (s.experience)   lines.push(`Years of experience: ${s.experience}`);
  if (s.degree)       lines.push(`Degree: ${s.degree}`);
  if (s.college)      lines.push(`College: ${s.college}`);
  if (s.gradYear)     lines.push(`Graduation year: ${s.gradYear}`);
  if (s.cgpa)         lines.push(`CGPA/Percentage: ${s.cgpa}`);
  if (s.currentCtc)   lines.push(`Current CTC: ${s.currentCtc}`);
  if (s.expectedCtc)  lines.push(`Expected CTC: ${s.expectedCtc}`);
  if (s.noticePeriod) lines.push(`Notice period: ${s.noticePeriod}`);
  if (s.workAuth)     lines.push(`Work authorization: ${s.workAuth}`);
  if (s.relocate)     lines.push(`Willing to relocate: ${s.relocate}`);
  if (s.workMode)     lines.push(`Preferred work mode: ${s.workMode}`);
  if (s.portfolioUrl) lines.push(`Portfolio: ${s.portfolioUrl}`);
  if (s.linkedinUrl)  lines.push(`LinkedIn: ${s.linkedinUrl}`);
  if (s.githubUrl)    lines.push(`GitHub: ${s.githubUrl}`);
  return lines.join('\n') || 'No profile details saved yet.';
}

function buildGithubSummary(d) {
  if (!d) return '';
  const repos = (d.repos || [])
    .map(r => `  - ${r.name} (${r.language || 'unknown'}, ★${r.stars}): ${r.description || ''}`)
    .join('\n');
  return `Name: ${d.name}\nBio: ${d.bio}\nPublic repos: ${d.publicRepos}\nTop repos:\n${repos}`;
}