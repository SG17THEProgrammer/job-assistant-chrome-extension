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
