// ── Safe message sender ──────────────────────────────────────
// Single choke-point for ALL chrome.runtime.sendMessage calls.
// Never call sendMessage directly anywhere else.

function safeSend(type, payload = {}) {
  return new Promise(resolve => {
    try {
      chrome.runtime.sendMessage({ type, ...payload }, res => {
        if (chrome.runtime.lastError) {
          resolve({ error: chrome.runtime.lastError.message || 'Extension context invalidated. Reload the page.' });
        } else {
          resolve(res || { error: 'No response from background.' });
        }
      });
    } catch (e) {
      resolve({ error: e.message || 'Extension context invalidated. Reload the page.' });
    }
  });
}

export const Msg = {
  generateAnswer: (question, opts = {}) => safeSend('GENERATE_ANSWER', { question, ...opts }),
  runAts:         (jd)                  => safeSend('RUN_ATS', { jd }),
  tailorResume:   (jd, style)           => safeSend('TAILOR_RESUME', { jd, style }),
  editResume:     (editPrompt)          => safeSend('EDIT_RESUME', { editPrompt }),
  generatePdf:    ()                    => safeSend('GENERATE_PDF'),
  fetchUrl:       (url)                 => safeSend('FETCH_URL', { url }),
  refreshGitHub:  (githubUrl)           => safeSend('REFRESH_GITHUB', { githubUrl }),
  fetchReadme:    (owner, repo)         => safeSend('FETCH_GITHUB_README', { owner, repo }),
  logApplication: (data)               => safeSend('LOG_APPLICATION', data),
  getMyContext:   ()                    => safeSend('GET_MY_CONTEXT'),
  extractPdf:     ()                    => safeSend('EXTRACT_PDF_TEXT'),
  saveApiKey:     (apiKey)              => safeSend('SAVE_API_KEY', { apiKey }),
  testApi:        (apiKey)              => safeSend('TEST_API', { apiKey }),
};
