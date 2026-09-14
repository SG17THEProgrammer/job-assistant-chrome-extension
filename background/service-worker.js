// ═══════════════════════════════════════════════════════════
//  JobAssist AI — Background Service Worker v6
// ═══════════════════════════════════════════════════════════

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent';

// ══════════════════════════════════════════════════════════
//  AES-GCM ENCRYPTION
// ══════════════════════════════════════════════════════════
const ENC_SALT   = new Uint8Array([74,111,98,65,115,115,105,115,116,65,73,75,101,121]);
const ENC_SECRET = 'jobassist-local-key-v1';

async function getCryptoKey() {
  const km = await crypto.subtle.importKey('raw', new TextEncoder().encode(ENC_SECRET), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name:'PBKDF2', salt:ENC_SALT, iterations:100000, hash:'SHA-256' }, km, { name:'AES-GCM', length:256 }, false, ['encrypt','decrypt']);
}
async function encryptApiKey(pt) {
  const key = await getCryptoKey();
  const iv  = crypto.getRandomValues(new Uint8Array(12));
  const enc = await crypto.subtle.encrypt({ name:'AES-GCM', iv }, key, new TextEncoder().encode(pt));
  const buf = new Uint8Array(12 + enc.byteLength);
  buf.set(iv); buf.set(new Uint8Array(enc), 12);
  return btoa(String.fromCharCode(...buf));
}
async function decryptApiKey(ct) {
  try {
    const key  = await getCryptoKey();
    const data = Uint8Array.from(atob(ct), c => c.charCodeAt(0));
    const dec  = await crypto.subtle.decrypt({ name:'AES-GCM', iv:data.slice(0,12) }, key, data.slice(12));
    return new TextDecoder().decode(dec);
  } catch { return ct; }
}

// ══════════════════════════════════════════════════════════
//  MESSAGE ROUTER
// ══════════════════════════════════════════════════════════
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const handlers = {
    GENERATE_ANSWER:      () => handleGenerateAnswer(msg),
    TAILOR_RESUME:        () => handleTailorResume(msg),
    EDIT_RESUME:          () => handleEditResume(msg),
    GENERATE_PDF:         () => handleGeneratePdf(),
    GET_MY_CONTEXT:       () => handleGetMyContext(),
    GET_PROMPT_TEXT:      () => handleGetPromptText(msg),
    TEST_API:             () => testApi(msg.apiKey),
    SAVE_API_KEY:         () => saveApiKey(msg.apiKey),
    GET_API_KEY:          () => getApiKey(),
    FETCH_URL:            () => handleFetchUrl(msg.url),
    LOG_APPLICATION:      () => handleLogApplication(msg),
    RUN_ATS:              () => handleRunAts(msg),
    // NEW: GitHub refresh + README fetch
    REFRESH_GITHUB:       () => handleRefreshGitHub(msg.githubUrl),
    FETCH_GITHUB_README:  () => handleFetchGithubReadme(msg.owner, msg.repo),
    // NEW: Extract text from PDF stored in base64
    EXTRACT_PDF_TEXT:     () => handleExtractPdfText(),
  };
  const handler = handlers[msg.type];
  if (!handler) return false;
  const keepAlive = setInterval(() => chrome.runtime.getPlatformInfo(() => {}), 4000);
  handler()
    .then(r  => sendResponse(r ?? { ok: true }))
    .catch(e => sendResponse({ error: e?.message || 'Unknown error' }))
    .finally(() => clearInterval(keepAlive));
  return true;
});

// ══════════════════════════════════════════════════════════
//  FIX 1: EXTRACT PDF TEXT using Gemini's vision
//  Called after PDF upload to convert base64 PDF → text
//  and store as resumeText so the system prompt works.
// ══════════════════════════════════════════════════════════
async function handleExtractPdfText() {
  const s = await load(['resumeBase64', 'apiKeyEnc', 'apiKey']);
  if (!s.resumeBase64) return { error: 'No PDF uploaded.' };
  const apiKey = await getApiKeyValue(s);
  if (!apiKey) return { error: 'No API key set. Add it in the API tab first, then re-upload your resume.' };

  const b64 = s.resumeBase64.includes(',') ? s.resumeBase64.split(',')[1] : s.resumeBase64;

  try {
    const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: 'You are a resume parser. Extract ALL text from this resume PDF exactly as written. Preserve section headings, bullet points, dates, company names, and all content. Output plain text only — no commentary, no markdown formatting.' }] },
        contents: [{
          role: 'user',
          parts: [
            { inline_data: { mime_type: 'application/pdf', data: b64 } },
            { text: 'Extract all text from this resume. Output every word, date, company, skill, and description exactly as written.' }
          ]
        }],
        generationConfig: { maxOutputTokens: 4000, temperature: 0 },
      }),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      return { error: e.error?.message || `Gemini error ${res.status}` };
    }
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!text || text.length < 50) return { error: 'Could not extract text from PDF. Try uploading as .txt instead.' };

    // Store the extracted text so system prompt has it
    await new Promise(r => chrome.storage.local.set({ resumeText: text }, r));
    return { ok: true, text, length: text.length };
  } catch (e) {
    return { error: `Network error: ${e.message}` };
  }
}

// ══════════════════════════════════════════════════════════
//  FIX 2a: REFRESH GITHUB DATA (dynamic, not static)
// ══════════════════════════════════════════════════════════
async function handleRefreshGitHub(githubUrl) {
  if (!githubUrl) {
    const s = await load(['githubUrl']);
    githubUrl = s.githubUrl;
  }
  if (!githubUrl) return { error: 'No GitHub URL saved.' };

  let handle;
  try {
    const u = new URL(githubUrl);
    handle = u.pathname.split('/').filter(Boolean)[0];
  } catch { return { error: 'Invalid GitHub URL.' }; }

  try {
    const [uRes, rRes] = await Promise.all([
      fetch(`https://api.github.com/users/${handle}`, { headers: { 'Accept': 'application/vnd.github.v3+json' } }),
      fetch(`https://api.github.com/users/${handle}/repos?sort=updated&per_page=20`, { headers: { 'Accept': 'application/vnd.github.v3+json' } }),
    ]);
    if (!uRes.ok) return { error: `GitHub user not found (${uRes.status})` };
    const user  = await uRes.json();
    const repos = await rRes.json();
    const githubData = {
      name:        user.name || handle,
      bio:         user.bio  || '',
      followers:   user.followers,
      following:   user.following,
      publicRepos: user.public_repos,
      avatarUrl:   user.avatar_url,
      htmlUrl:     user.html_url,
      fetchedAt:   Date.now(),
      repos: repos.map(r => ({
        name:        r.name,
        description: r.description || '',
        stars:       r.stargazers_count,
        forks:       r.forks_count,
        language:    r.language,
        url:         r.html_url,
        topics:      r.topics || [],
        updatedAt:   r.updated_at,
      })),
    };
    await new Promise(r => chrome.storage.local.set({ githubData }, r));
    return { ok: true, githubData };
  } catch (e) {
    return { error: `GitHub fetch failed: ${e.message}` };
  }
}

// ══════════════════════════════════════════════════════════
//  FIX 2b: FETCH GITHUB README for a specific repo
//  Used when answering questions about a specific project
// ══════════════════════════════════════════════════════════
async function handleFetchGithubReadme(owner, repo) {
  if (!owner || !repo) return { error: 'owner and repo required.' };
  try {
    // Try main branch first, then master
    for (const branch of ['main', 'master']) {
      const res = await fetch(
        `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/README.md`,
        { signal: AbortSignal.timeout(8000) }
      );
      if (res.ok) {
        const text = await res.text();
        return { ok: true, readme: text.slice(0, 4000), repo, branch };
      }
    }
    // Try GitHub API as fallback
    const apiRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/readme`,
      { headers: { 'Accept': 'application/vnd.github.v3.raw' } }
    );
    if (apiRes.ok) {
      const text = await apiRes.text();
      return { ok: true, readme: text.slice(0, 4000), repo, branch: 'api' };
    }
    return { error: `No README found for ${owner}/${repo}` };
  } catch (e) {
    return { error: `Failed to fetch README: ${e.message}` };
  }
}

// ══════════════════════════════════════════════════════════
//  FETCH EXTERNAL URL (for JD link fetching)
// ══════════════════════════════════════════════════════════
async function handleFetchUrl(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html,application/xhtml+xml' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return { error: `Could not access the link (HTTP ${res.status}). Please paste the job description directly.` };
    const html = await res.text();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/\s+/g, ' ').trim()
      .slice(0, 6000);
    if (text.length < 100) return { error: 'Could not read content from this link. Paste the job description directly.' };
    return { text };
  } catch (e) {
    if (e.name === 'TimeoutError') return { error: 'Link timed out after 10s. Paste the job description directly.' };
    return { error: `Could not access the link: ${e.message}. Paste the job description directly.` };
  }
}

// ══════════════════════════════════════════════════════════
//  LOG APPLICATION
// ══════════════════════════════════════════════════════════
async function handleLogApplication({ company, role, url, jd, date }) {
  const s = await load(['applications']);
  const apps = s.applications || [];
  const entry = {
    id:      Date.now(),
    company: company || 'Unknown',
    role:    role    || 'Unknown',
    url:     url     || '',
    jd:      (jd || '').slice(0, 500),
    date:    date || new Date().toISOString(),
    status:  'Applied',
  };
  apps.unshift(entry);
  await new Promise(r => chrome.storage.local.set({ applications: apps.slice(0, 200) }, r));
  return { ok: true, entry };
}

// ══════════════════════════════════════════════════════════
//  RUN ATS CHECK
// ══════════════════════════════════════════════════════════
async function handleRunAts({ jd }) {
  const s = await load(['resumeText', 'resumeBase64', 'apiKeyEnc', 'apiKey']);
  const apiKey = await getApiKeyValue(s);
  if (!apiKey) return { error: 'No API key set.' };
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
  } catch { return { error: 'Could not parse ATS result.' }; }
}

// ══════════════════════════════════════════════════════════
//  GET ACTUAL PROMPT TEXT (for Context tab)
// ══════════════════════════════════════════════════════════
async function handleGetPromptText({ question, jobDescription }) {
  const s = await load([
    'resumeText', 'resumeBase64', 'resumeFileName',
    'firstName', 'lastName', 'email', 'phone',
    'city', 'state', 'country',
    'linkedinUrl', 'githubUrl', 'portfolioUrl', 'githubData',
    'currentCtc', 'expectedCtc', 'noticePeriod', 'experience',
    'workAuth', 'relocate', 'workMode',
    'degree', 'college', 'gradYear', 'cgpa',
    'extraContext', 'customInstruction', 'answerStyle', 'tone',
  ]);
  const systemText = buildSystemPrompt(s, 'balanced', 'professional');
  const userText   = [
    jobDescription ? `JOB DESCRIPTION:\n${jobDescription.slice(0,500)}...\n` : '',
    question ? `QUESTION:\n${question}` : '[question will appear here]',
  ].filter(Boolean).join('\n');
  return {
    system: systemText,
    user:   userText,
    totalChars: systemText.length + userText.length,
  };
}

// ══════════════════════════════════════════════════════════
//  GENERATE ANSWER
//  FIX: If resumeText is empty but resumeBase64 exists,
//  always use PDF path. Smart README injection for GitHub.
// ══════════════════════════════════════════════════════════
async function handleGenerateAnswer({ question, jobDescription, fieldHint, companyName, customPrompt, readmeContext }) {
  const s = await load([
    'resumeText', 'resumeBase64',
    'firstName', 'lastName', 'email', 'phone',
    'city', 'state', 'country',
    'linkedinUrl', 'githubUrl', 'portfolioUrl', 'githubData',
    'currentCtc', 'expectedCtc', 'noticePeriod', 'experience',
    'workAuth', 'relocate', 'workMode',
    'degree', 'college', 'gradYear', 'cgpa',
    'extraContext', 'answerStyle', 'tone', 'customInstruction',
    'apiKeyEnc', 'apiKey', 'companies',
  ]);

  const apiKey = await getApiKeyValue(s);
  if (!apiKey)                          return { error: 'No API key set. Add it in the extension popup (API tab).' };
  if (!s.resumeText && !s.resumeBase64) return { error: 'No resume uploaded. Add it in the extension popup (Profile tab).' };

  const companyNote = companyName && s.companies?.[companyName]
    ? `\nCOMPANY NOTES:\n${s.companies[companyName]}` : '';

  // FIX 2b: If readmeContext was passed in, inject it
  const readmeNote = readmeContext
    ? `\n\n=== PROJECT README (use this for detailed project questions) ===\n${readmeContext}` : '';

  const systemText = buildSystemPrompt(s, s.answerStyle || 'balanced', s.tone || 'professional') + companyNote + readmeNote;

  const userText = [
    jobDescription ? `JOB DESCRIPTION:\n${jobDescription.slice(0,5000)}\n` : '',
    fieldHint      ? `Form field: "${fieldHint}"\n` : '',
    `QUESTION:\n${question}`,
    customPrompt   ? `\nSPECIFIC INSTRUCTION (highest priority):\n${customPrompt}` : '',
    `\nWrite my answer:`,
  ].filter(Boolean).join('\n');

  // Use PDF path if we only have base64 (no extracted text)
  if (s.resumeBase64 && !s.resumeText) return geminiWithPdf(apiKey, systemText, userText, s.resumeBase64, 700);
  return gemini(apiKey, systemText, userText, 700);
}

// ══════════════════════════════════════════════════════════
//  TAILOR RESUME
// ══════════════════════════════════════════════════════════
async function handleTailorResume({ jd, style }) {
  const s = await load(['resumeText', 'resumeBase64', 'apiKeyEnc', 'apiKey', 'fullName', 'githubData']);
  const apiKey = await getApiKeyValue(s);
  if (!apiKey)                          return { error: 'No API key set.' };
  if (!s.resumeText && !s.resumeBase64) return { error: 'No resume uploaded.' };

  const system = `You are an expert resume writer and ATS specialist.
Rewrite the resume to match the job description.
RULES: Only use experience in the original resume. Do NOT invent anything.
${style ? `Style: ${style}` : ''}
Return ONLY JSON, no markdown:
{"tailoredResume":"...","matchedKeywords":["..."],"missingKeywords":["..."],"atsScore":75}`;

  const user = `RESUME:\n${(s.resumeText||'[See attached PDF]').slice(0,6000)}\n\nJD:\n${jd.slice(0,6000)}`;

  let r;
  if (s.resumeBase64 && !s.resumeText) {
    r = await geminiWithPdf(apiKey, system, user, s.resumeBase64, 2500);
  } else {
    r = await gemini(apiKey, system, user, 2500);
  }
  if (r.error) return r;
  try { return JSON.parse(r.answer.replace(/```json|```/g,'').trim()); }
  catch { return { error: 'Could not parse response. Try again.' }; }
}

// ══════════════════════════════════════════════════════════
//  EDIT RESUME
// ══════════════════════════════════════════════════════════
async function handleEditResume({ editPrompt }) {
  const s = await load(['tailoredResumeText', 'apiKeyEnc', 'apiKey']);
  const apiKey = await getApiKeyValue(s);
  if (!apiKey)               return { error: 'No API key set.' };
  if (!s.tailoredResumeText) return { error: 'Generate a tailored resume first.' };
  const r = await gemini(apiKey,
    'Edit the resume per the instruction. Output ONLY the updated resume text.',
    `RESUME:\n${s.tailoredResumeText}\n\nINSTRUCTION:\n${editPrompt}`, 2500);
  if (r.error) return r;
  return { tailoredResume: r.answer };
}

// ══════════════════════════════════════════════════════════
//  GENERATE PDF
// ══════════════════════════════════════════════════════════
async function handleGeneratePdf() {
  const s = await load(['tailoredResumeText', 'firstName', 'lastName']);
  if (!s.tailoredResumeText) return { error: 'Generate a tailored resume first.' };
  const name  = [s.firstName, s.lastName].filter(Boolean).join(' ') || 'Resume';
  const lines = s.tailoredResumeText.split('\n');
  const html  = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${esc(name)}</title>
<style>body{font-family:Georgia,serif;max-width:750px;margin:40px auto;padding:0 40px;color:#1a1a1a;font-size:14px;line-height:1.7}
h2{font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;margin:22px 0 5px;border-bottom:1px solid #ccc;padding-bottom:3px;color:#333}
p{margin:2px 0}li{margin:2px 0 2px 20px}@media print{body{margin:20px;padding:0 20px}}</style>
</head><body>${lines.map(l => {
    if (!l.trim()) return '<br/>';
    if (l===l.toUpperCase()&&l.trim().length>2&&l.trim().length<50) return `<h2>${esc(l)}</h2>`;
    if (/^[•\-\*]\s/.test(l)) return `<li>${esc(l.replace(/^[•\-\*]\s*/,''))}</li>`;
    return `<p>${esc(l)}</p>`;
  }).join('\n')}</body></html>`;
  const tab = await chrome.tabs.create({ url: 'data:text/html;charset=utf-8,'+encodeURIComponent(html), active: true });
  setTimeout(async () => {
    try { await chrome.scripting.executeScript({ target:{tabId:tab.id}, func:()=>window.print() }); } catch {}
  }, 1200);
  return { ok: true };
}

// ══════════════════════════════════════════════════════════
//  GET MY CONTEXT
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
    'extraContext', 'customInstruction', 'answerStyle', 'tone',
    'companies', 'apiKeyEnc', 'apiKey',
  ]);

  const hasResume  = !!(s.resumeText || s.resumeBase64);
  const hasKey     = !!(s.apiKeyEnc  || s.apiKey);
  const profileSummary = buildProfileSummary(s);
  const actualSystemPrompt = hasResume
    ? buildSystemPrompt(s, s.answerStyle || 'balanced', s.tone || 'professional')
    : '(no prompt yet — upload resume first)';

  // FIX: Show warning if PDF uploaded but text not extracted
  const pdfWithoutText = !!(s.resumeBase64 && !s.resumeText);
  let resumeDetail = '';
  if (!hasResume) {
    resumeDetail = 'No resume uploaded. Go to Profile tab.';
  } else if (pdfWithoutText) {
    resumeDetail = `File: ${s.resumeFileName || 'uploaded'}\nType: PDF\n⚠️ Text not yet extracted — AI is reading the PDF directly via Gemini vision.\nFor best results, click "Extract & Save Text" in the Profile tab.`;
  } else {
    resumeDetail = `File: ${s.resumeFileName || 'uploaded'}\nType: ${s.resumeBase64 ? 'PDF (text extracted ✓)' : 'Text'}\nLength: ${s.resumeText.length} characters\n\nPreview:\n${s.resumeText.slice(0,400)}…`;
  }

  const githubFetchedAge = s.githubData?.fetchedAt
    ? Math.round((Date.now() - s.githubData.fetchedAt) / 60000) + ' min ago'
    : null;

  const sections = [
    {
      title: 'Resume',
      status: hasResume ? (pdfWithoutText ? 'pdf-only' : 'loaded') : 'missing',
      detail: resumeDetail,
    },
    {
      title: 'Personal info',
      status: (s.firstName || s.email) ? 'set' : 'empty',
      detail: profileSummary || 'No personal info saved yet.',
    },
    {
      title: 'GitHub',
      status: s.githubData ? 'connected' : s.githubUrl ? 'url-saved' : 'missing',
      detail: s.githubData
        ? buildGithubSummary(s.githubData) + (githubFetchedAge ? `\n\nLast refreshed: ${githubFetchedAge}` : '')
        : s.githubUrl ? `URL saved: ${s.githubUrl}\nClick "Refresh GitHub" to fetch repo data.`
        : 'Not connected.',
    },
    {
      title: 'LinkedIn',
      status: s.linkedinUrl ? 'url-saved' : 'missing',
      detail: s.linkedinUrl ? `URL: ${s.linkedinUrl}` : 'Not added.',
    },
    {
      title: 'Writing preferences',
      status: 'set',
      detail: `Answer style: ${s.answerStyle || 'balanced'}\nTone: ${s.tone || 'professional'}\nCustom instruction: ${s.customInstruction || 'none'}`,
    },
    {
      title: 'Saved companies',
      status: Object.keys(s.companies||{}).length ? 'set' : 'empty',
      detail: Object.keys(s.companies||{}).length
        ? Object.entries(s.companies).map(([n,v]) => `• ${n}${v?': '+v:''}`).join('\n')
        : 'No companies saved.',
    },
    {
      title: 'API key',
      status: hasKey ? 'set' : 'missing',
      detail: hasKey ? 'Set ✓ (encrypted)' : 'Not set. Add in API tab.',
    },
    {
      title: '📋 Actual system prompt sent to Gemini',
      status: hasResume ? 'set' : 'missing',
      detail: actualSystemPrompt,
    },
  ];
  return { sections };
}

// ══════════════════════════════════════════════════════════
//  TEST API
// ══════════════════════════════════════════════════════════
async function testApi(apiKey) {
  const r = await gemini(apiKey, 'You are helpful.', 'Reply with exactly: OK', 10);
  return r.error ? { ok: false, error: r.error } : { ok: true };
}

// ══════════════════════════════════════════════════════════
//  API KEY HELPERS
// ══════════════════════════════════════════════════════════
async function saveApiKey(pt) {
  const enc = await encryptApiKey(pt);
  await new Promise(r => chrome.storage.local.set({ apiKeyEnc: enc, apiKey: null }, r));
  return { ok: true };
}
async function getApiKey() {
  const s = await load(['apiKeyEnc', 'apiKey']);
  if (s.apiKeyEnc) return { key: await decryptApiKey(s.apiKeyEnc) };
  if (s.apiKey)    return { key: s.apiKey };
  return { key: null };
}
async function getApiKeyValue(s) {
  if (s.apiKeyEnc) return decryptApiKey(s.apiKeyEnc);
  if (s.apiKey)    return s.apiKey;
  return null;
}

// ══════════════════════════════════════════════════════════
//  PROMPT BUILDERS
//  FIX: resumeText being null/empty now shows a clear note
//  instead of silently passing nothing
// ══════════════════════════════════════════════════════════
function buildSystemPrompt(s, style, tone) {
  const styleGuide = {
    concise:  'Write 2–3 sentences only. Be direct.',
    balanced: 'Write one focused paragraph (4–6 sentences) with one real example.',
    detailed: 'Write 2–3 paragraphs: context, specific example with outcome, forward-looking statement.',
  }[style] || 'Write one focused paragraph.';

  const resumeSection = s.resumeText
    ? `\n=== RESUME (only source of truth for experience) ===\n${s.resumeText.slice(0, 8000)}`
    : s.resumeBase64
      ? '\n=== RESUME ===\n[Resume PDF is attached — read it carefully for all experience, skills, projects, and education data. Use ONLY what is in this PDF.]'
      : '\n=== NO RESUME UPLOADED ===\nTell the user: "Please upload your resume in the JobAssist extension popup (Profile tab) so I can write an accurate answer."';

  return [
    `You are a job application assistant helping a user answer application questions.
You write in FIRST PERSON on behalf of the user.
`,
    `Style: ${styleGuide}`,
    `Tone: ${tone}.`,
    `CRITICAL RULES:`,
    `1. ONLY use information from the resume and profile below. Never invent company names, job titles, projects, technologies, dates, or achievements.`,
    `2. Do NOT mention any company (Amazon, Google etc.) unless it appears in the resume.`,
    `3. If the resume does not contain enough information, say what IS there and acknowledge the gap honestly.`,
    `4. Generate answers that sound human and natural, not robotic or repetitive.`,
    `5. Do not repeat the same tech or projects across multiple answers in the same session.`,
    `6. Output ONLY the answer text — no preamble, no quotes, no meta-comments.`,
    ``,
    `=== USER PROFILE ===`,
    buildProfileSummary(s),
    resumeSection,
    s.githubData ? `\n=== GITHUB (${s.githubData.publicRepos} public repos, refreshed recently) ===\n${buildGithubSummary(s.githubData)}` : '',
    s.linkedinUrl ? `\nLinkedIn: ${s.linkedinUrl}` : '',
    s.extraContext ? `\n=== USER NOTES ===\n${s.extraContext}` : '',
    s.customInstruction ? `\n=== WRITING INSTRUCTIONS ===\n${s.customInstruction}` : '',
  ].filter(x => x !== '').join('\n');
}

function buildProfileSummary(s) {
  const DEGREE_LABELS = {
    btech:'B.Tech / B.E.', bsc:'B.Sc', bca:'BCA', bcom:'B.Com', ba:'B.A.',
    mtech:'M.Tech / M.E.', msc:'M.Sc', mca:'MCA', mba:'MBA', phd:'Ph.D',
    diploma:'Diploma', other:'Other',
  };
  const lines = [];
  const name = [s.firstName, s.lastName].filter(Boolean).join(' ');
  if (name)            lines.push(`Name: ${name}`);
  if (s.email)         lines.push(`Email: ${s.email}`);
  if (s.phone)         lines.push(`Phone: ${s.phone}`);
  const loc = [s.city, s.state, s.country].filter(Boolean).join(', ');
  if (loc)             lines.push(`Location: ${loc}`);
  if (s.experience)    lines.push(`Experience: ${s.experience} years`);
  if (s.degree)        lines.push(`Degree: ${DEGREE_LABELS[s.degree] || s.degree}`);
  if (s.college)       lines.push(`College: ${s.college}`);
  if (s.gradYear)      lines.push(`Graduation: ${s.gradYear}`);
  if (s.cgpa)          lines.push(`CGPA: ${s.cgpa}`);
  if (s.currentCtc)    lines.push(`Current CTC: ${s.currentCtc}`);
  if (s.expectedCtc)   lines.push(`Expected CTC: ${s.expectedCtc}`);
  if (s.noticePeriod)  lines.push(`Notice period: ${s.noticePeriod}`);
  if (s.workAuth)      lines.push(`Work auth: ${s.workAuth}`);
  if (s.relocate)      lines.push(`Relocate: ${s.relocate}`);
  if (s.workMode)      lines.push(`Work mode: ${s.workMode}`);
  if (s.portfolioUrl)  lines.push(`Portfolio: ${s.portfolioUrl}`);
  if (s.linkedinUrl)   lines.push(`LinkedIn: ${s.linkedinUrl}`);
  if (s.githubUrl)     lines.push(`GitHub: ${s.githubUrl}`);
  return lines.join('\n') || 'No profile saved yet.';
}

function buildGithubSummary(d) {
  if (!d) return '';
  const repos = (d.repos||[]).slice(0, 10).map(r =>
    `  - ${r.name} (${r.language||'?'}, ★${r.stars}${r.topics?.length ? ', tags: '+r.topics.slice(0,3).join(', ') : ''}): ${r.description||''}`
  ).join('\n');
  return `Name: ${d.name}\nBio: ${d.bio}\nPublic repos: ${d.publicRepos}\nTop repos:\n${repos}`;
}

// ══════════════════════════════════════════════════════════
//  GEMINI CALLERS
// ══════════════════════════════════════════════════════════
async function gemini(apiKey, systemText, userText, maxTokens=800) {
  try {
    const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemText }] },
        contents: [{ role:'user', parts:[{ text: userText }] }],
        generationConfig: { maxOutputTokens: maxTokens, temperature: 0.4 },
      }),
    });
    if (!res.ok) {
      const e = await res.json().catch(()=>({}));
      return { error: e.error?.message || `Gemini error ${res.status}` };
    }
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!text) return { error: 'Empty response from Gemini.' };
    return { answer: text };
  } catch(e) { return { error: `Network error: ${e.message}` }; }
}

async function geminiWithPdf(apiKey, systemText, userText, base64DataUrl, maxTokens=800) {
  try {
    const b64 = base64DataUrl.includes(',') ? base64DataUrl.split(',')[1] : base64DataUrl;
    const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemText }] },
        contents: [{ role:'user', parts:[
          { inline_data:{ mime_type:'application/pdf', data:b64 } },
          { text: userText }
        ]}],
        generationConfig: { maxOutputTokens: maxTokens, temperature: 0.4 },
      }),
    });
    if (!res.ok) {
      const e = await res.json().catch(()=>({}));
      return { error: `${e.error?.message || res.status}. Try uploading resume as .txt instead.` };
    }
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!text) return { error: 'Empty response.' };
    return { answer: text };
  } catch(e) { return { error: `Network error: ${e.message}` }; }
}

// ══════════════════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════════════════
function load(keys) { return new Promise(r => chrome.storage.local.get(keys, r)); }
function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }