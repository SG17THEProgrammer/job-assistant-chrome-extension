import { getApiKeyValue } from './crypto.js';
import { buildSystemPrompt } from './context.js';
import { gemini, geminiWithPdf } from './gemini.js';

function load(keys) { return new Promise(r => chrome.storage.local.get(keys, r)); }

export async function handleGenerateAnswer({ question, jobDescription, fieldHint, companyName, customPrompt, readmeContext }) {
  const s = await load([
    'resumeText','resumeBase64',
    'firstName','lastName','email','phone','city','state','country',
    'linkedinUrl','githubUrl','portfolioUrl','githubData',
    'currentCtc','expectedCtc','noticePeriod','experience',
    'workAuth','relocate','workMode','degree','college','gradYear','cgpa',
    'extraContext','answerStyle','tone','customInstruction',
    'apiKeyEnc','apiKey','companies',
  ]);

  const apiKey = await getApiKeyValue(s);
  if (!apiKey)                          return { error: 'No API key set. Add it in the extension popup (API tab).' };
  if (!s.resumeText && !s.resumeBase64) return { error: 'No resume uploaded. Add it in the extension popup (Profile tab).' };

  const companyNote = companyName && s.companies?.[companyName]
    ? `\nCOMPANY NOTES:\n${s.companies[companyName]}` : '';
  const readmeNote  = readmeContext
    ? `\n\n=== PROJECT README ===\n${readmeContext}` : '';

  const systemText = buildSystemPrompt(s, s.answerStyle || 'balanced', s.tone || 'professional') + companyNote + readmeNote;

  const userText = [
    jobDescription ? `JOB DESCRIPTION:\n${jobDescription.slice(0, 5000)}\n` : '',
    fieldHint      ? `Form field: "${fieldHint}"\n` : '',
    `QUESTION:\n${question}`,
    customPrompt   ? `\nSPECIFIC INSTRUCTION (highest priority):\n${customPrompt}` : '',
    `\nWrite my answer:`,
  ].filter(Boolean).join('\n');

  if (s.resumeBase64 && !s.resumeText) {
    return geminiWithPdf(apiKey, systemText, userText, s.resumeBase64, 700);
  }
  return gemini(apiKey, systemText, userText, 700);
}
