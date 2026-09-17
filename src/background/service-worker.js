// ═══════════════════════════════════════════════════════════
//  JobAssist AI — Background Service Worker v4 (Router only)
//  Each handler lives in its own file. This file just routes.
// ═══════════════════════════════════════════════════════════

import { handleGenerateAnswer }              from './handlers/answer.js';
import { handleTailorResume, handleEditResume, handleGeneratePdf } from './handlers/resume.js';
import { handleRunAts }                      from './handlers/ats.js';
import { handleRefreshGitHub, handleFetchGithubReadme } from './handlers/github.js';
import { handleExtractPdfText }              from './handlers/pdf-extract.js';
import { handleGetMyContext, handleGetPromptText } from './handlers/context.js';
import { saveApiKey, getApiKey, testApi }    from './handlers/crypto.js';
import { handleFetchUrl }                    from './handlers/fetch.js';
import { handleLogApplication }              from './handlers/tracker.js';

// ── Keys that are safe to mirror to sync storage ─────────────
// These survive extension removal/reinstall (up to 100KB quota).
// Excluded: resumeBase64 (too large), apiKeyEnc/apiKey (security),
//           resumeText (can be large), githubData (re-fetchable).
const SYNC_KEYS = [
  'firstName','lastName','email','phone','dob',
  'city','state','country','zipcode',
  'linkedinUrl','githubUrl','portfolioUrl',
  'currentCtc','expectedCtc','noticePeriod','experience',
  'workAuth','relocate','workMode',
  'degree','college','gradYear','cgpa',
  'extraContext','customInstruction','answerStyle','tone',
  'autoFill','autoJd','companies','resumeFileName',
];

// On install/update: if local is empty, restore from sync
chrome.runtime.onInstalled.addListener(async () => {
  try {
    const local = await new Promise(r => chrome.storage.local.get(SYNC_KEYS, r));
    const hasLocalData = SYNC_KEYS.some(k => local[k] != null && local[k] !== '');
    if (!hasLocalData) {
      const synced = await new Promise(r => chrome.storage.sync.get(SYNC_KEYS, r));
      const hasSyncData = SYNC_KEYS.some(k => synced[k] != null && synced[k] !== '');
      if (hasSyncData) {
        await new Promise(r => chrome.storage.local.set(synced, r));
        console.log('[JobAssist] Profile data restored from sync storage.');
      }
    }
  } catch (e) {
    console.warn('[JobAssist] Restore from sync failed:', e.message);
  }
});

// Whenever local storage changes, mirror safe keys to sync
chrome.storage.local.onChanged.addListener(changes => {
  const toSync = {};
  for (const key of SYNC_KEYS) {
    if (key in changes && changes[key].newValue !== undefined) {
      toSync[key] = changes[key].newValue;
    }
  }
  if (Object.keys(toSync).length > 0) {
    chrome.storage.sync.set(toSync).catch(() => {
      // sync quota exceeded — ignore silently, local still has the data
    });
  }
});

// ── Message router ────────────────────────────────────────────
const HANDLERS = {
  GENERATE_ANSWER:     handleGenerateAnswer,
  TAILOR_RESUME:       handleTailorResume,
  EDIT_RESUME:         handleEditResume,
  GENERATE_PDF:        handleGeneratePdf,
  RUN_ATS:             handleRunAts,
  REFRESH_GITHUB:      handleRefreshGitHub,
  FETCH_GITHUB_README: handleFetchGithubReadme,
  EXTRACT_PDF_TEXT:    handleExtractPdfText,
  GET_MY_CONTEXT:      handleGetMyContext,
  GET_PROMPT_TEXT:     handleGetPromptText,
  TEST_API:            ({ apiKey }) => testApi(apiKey),
  SAVE_API_KEY:        ({ apiKey }) => saveApiKey(apiKey),
  GET_API_KEY:         () => getApiKey(),
  FETCH_URL:           ({ url }) => handleFetchUrl({ url }),
  LOG_APPLICATION:     handleLogApplication,
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const handler = HANDLERS[msg.type];
  if (!handler) return false;

  // Keep service worker alive while handler runs
  const keepAlive = setInterval(() => chrome.runtime.getPlatformInfo(() => {}), 4000);

  handler(msg)
    .then(r  => sendResponse(r ?? { ok: true }))
    .catch(e => sendResponse({ error: e?.message || 'Unknown error' }))
    .finally(() => clearInterval(keepAlive));

  return true; // async response
});
