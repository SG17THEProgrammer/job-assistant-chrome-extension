// ── Context / Prompt builder ──────────────────────────────────
import { getApiKeyValue } from './crypto.js';

const DEGREE_LABELS = {
  btech:'B.Tech / B.E.', bsc:'B.Sc', bca:'BCA', bcom:'B.Com', ba:'B.A.',
  mtech:'M.Tech / M.E.', msc:'M.Sc', mca:'MCA', mba:'MBA', phd:'Ph.D',
  diploma:'Diploma', other:'Other',
};

function load(keys) {
  return new Promise(r => chrome.storage.local.get(keys, r));
}

export function buildProfileSummary(s) {
  const lines = [];
  const name = [s.firstName, s.lastName].filter(Boolean).join(' ');
  if (name)           lines.push(`Name: ${name}`);
  if (s.email)        lines.push(`Email: ${s.email}`);
  if (s.phone)        lines.push(`Phone: ${s.phone}`);
  const loc = [s.city, s.state, s.country].filter(Boolean).join(', ');
  if (loc)            lines.push(`Location: ${loc}`);
  if (s.experience)   lines.push(`Experience: ${s.experience} years`);
  if (s.degree)       lines.push(`Degree: ${DEGREE_LABELS[s.degree] || s.degree}`);
  if (s.college)      lines.push(`College: ${s.college}`);
  if (s.gradYear)     lines.push(`Graduation: ${s.gradYear}`);
  if (s.cgpa)         lines.push(`CGPA: ${s.cgpa}`);
  if (s.currentCtc)   lines.push(`Current CTC: ${s.currentCtc}`);
  if (s.expectedCtc)  lines.push(`Expected CTC: ${s.expectedCtc}`);
  if (s.noticePeriod) lines.push(`Notice period: ${s.noticePeriod}`);
  if (s.workAuth)     lines.push(`Work auth: ${s.workAuth}`);
  if (s.relocate)     lines.push(`Relocate: ${s.relocate}`);
  if (s.workMode)     lines.push(`Work mode: ${s.workMode}`);
  if (s.portfolioUrl) lines.push(`Portfolio: ${s.portfolioUrl}`);
  if (s.linkedinUrl)  lines.push(`LinkedIn: ${s.linkedinUrl}`);
  if (s.githubUrl)    lines.push(`GitHub: ${s.githubUrl}`);
  return lines.join('\n') || 'No profile saved yet.';
}

export function buildGithubSummary(d) {
  if (!d) return '';
  const repos = (d.repos || []).slice(0, 10).map(r =>
    `  - ${r.name} (${r.language || '?'}, ★${r.stars}${r.topics?.length ? ', tags: ' + r.topics.slice(0, 3).join(', ') : ''}): ${r.description || ''}`
  ).join('\n');
  return `Name: ${d.name}\nBio: ${d.bio}\nPublic repos: ${d.publicRepos}\nTop repos:\n${repos}`;
}

export function buildSystemPrompt(s, style, tone) {
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
You write in FIRST PERSON on behalf of the user.`,
    `Style: ${styleGuide}`,
    `Tone: ${tone}.`,
    `CRITICAL RULES:`,
    `1. ONLY use information from the resume and profile below. Never invent company names, job titles, projects, technologies, dates, or achievements.`,
    `2. Do NOT mention any company (Amazon, Google etc.) unless it appears in the resume.`,
    `3. If the resume does not contain enough information, say what IS there and acknowledge the gap honestly.`,
    `4. Generate answers that sound human and natural, not robotic or repetitive.`,
    `5. Do not repeat the same tech or projects across multiple answers in the same session.`,
    `6. Output ONLY the answer text — no preamble, no quotes, no meta-comments.`,
    `\n=== USER PROFILE ===`,
    buildProfileSummary(s),
    resumeSection,
    s.githubData ? `\n=== GITHUB (${s.githubData.publicRepos} public repos) ===\n${buildGithubSummary(s.githubData)}` : '',
    s.linkedinUrl ? `\nLinkedIn: ${s.linkedinUrl}` : '',
    s.extraContext ? `\n=== USER NOTES ===\n${s.extraContext}` : '',
    s.customInstruction ? `\n=== WRITING INSTRUCTIONS ===\n${s.customInstruction}` : '',
  ].filter(x => x !== '').join('\n');
}

export async function handleGetMyContext() {
  const s = await load([
    'resumeText','resumeBase64','resumeFileName',
    'firstName','lastName','email','phone','city','state','country','zipcode',
    'linkedinUrl','githubUrl','portfolioUrl','githubData','linkedinData',
    'currentCtc','expectedCtc','noticePeriod','experience',
    'workAuth','relocate','workMode','degree','college','gradYear','cgpa',
    'extraContext','customInstruction','answerStyle','tone',
    'companies','apiKeyEnc','apiKey',
  ]);

  const hasResume = !!(s.resumeText || s.resumeBase64);
  const hasKey    = !!(s.apiKeyEnc  || s.apiKey);
  const pdfWithoutText = !!(s.resumeBase64 && !s.resumeText);

  let resumeDetail = '';
  if (!hasResume) {
    resumeDetail = 'No resume uploaded. Go to Profile tab.';
  } else if (pdfWithoutText) {
    resumeDetail = `File: ${s.resumeFileName || 'uploaded'}\nType: PDF\n⚠️ Text not yet extracted — AI reads PDF directly.\nClick "Extract & save text" in Profile tab for best results.`;
  } else {
    resumeDetail = `File: ${s.resumeFileName || 'uploaded'}\nType: ${s.resumeBase64 ? 'PDF (text extracted ✓)' : 'Text'}\nLength: ${s.resumeText.length} characters\n\nPreview:\n${s.resumeText.slice(0, 400)}…`;
  }

  const githubAge = s.githubData?.fetchedAt
    ? Math.round((Date.now() - s.githubData.fetchedAt) / 60000) + ' min ago'
    : null;

  const sections = [
    { title: 'Resume',            status: hasResume ? (pdfWithoutText ? 'pdf-only' : 'loaded') : 'missing', detail: resumeDetail },
    { title: 'Personal info',     status: (s.firstName || s.email) ? 'set' : 'empty', detail: buildProfileSummary(s) || 'No personal info saved yet.' },
    {
      title: 'GitHub',
      status: s.githubData ? 'connected' : s.githubUrl ? 'url-saved' : 'missing',
      detail: s.githubData
        ? buildGithubSummary(s.githubData) + (githubAge ? `\n\nLast refreshed: ${githubAge}` : '')
        : s.githubUrl ? `URL saved: ${s.githubUrl}\nClick Refresh to fetch repo data.`
        : 'Not connected.',
    },
    { title: 'LinkedIn',          status: s.linkedinUrl ? 'url-saved' : 'missing', detail: s.linkedinUrl ? `URL: ${s.linkedinUrl}` : 'Not added.' },
    { title: 'Writing preferences', status: 'set', detail: `Answer style: ${s.answerStyle || 'balanced'}\nTone: ${s.tone || 'professional'}\nCustom instruction: ${s.customInstruction || 'none'}` },
    { title: 'Saved companies',   status: Object.keys(s.companies||{}).length ? 'set' : 'empty', detail: Object.keys(s.companies||{}).length ? Object.entries(s.companies).map(([n,v]) => `• ${n}${v?': '+v:''}`).join('\n') : 'No companies saved.' },
    { title: 'API key',           status: hasKey ? 'set' : 'missing', detail: hasKey ? 'Set ✓ (encrypted)' : 'Not set. Add in API tab.' },
    { title: '📋 Actual system prompt sent to Gemini', status: hasResume ? 'set' : 'missing', detail: hasResume ? buildSystemPrompt(s, s.answerStyle || 'balanced', s.tone || 'professional') : '(upload resume first)' },
  ];

  return { sections };
}

export async function handleGetPromptText({ question, jobDescription }) {
  const s = await load([
    'resumeText','resumeBase64','resumeFileName',
    'firstName','lastName','email','phone','city','state','country',
    'linkedinUrl','githubUrl','portfolioUrl','githubData',
    'currentCtc','expectedCtc','noticePeriod','experience',
    'workAuth','relocate','workMode','degree','college','gradYear','cgpa',
    'extraContext','customInstruction','answerStyle','tone',
  ]);
  const systemText = buildSystemPrompt(s, 'balanced', 'professional');
  const userText   = [
    jobDescription ? `JOB DESCRIPTION:\n${jobDescription.slice(0, 500)}...\n` : '',
    question ? `QUESTION:\n${question}` : '[question will appear here]',
  ].filter(Boolean).join('\n');
  return { system: systemText, user: userText, totalChars: systemText.length + userText.length };
}
