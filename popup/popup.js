// ═══════════════════════════════════════════════════════════
//  JobAssist AI — Popup Controller v4
// ═══════════════════════════════════════════════════════════

// ── Tab navigation ───────────────────────────────────────────
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.pane').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
    if (tab.dataset.tab === 'context')   loadContext();
    if (tab.dataset.tab === 'companies') renderApplicationLog();
  });
});

// ── Segment buttons (multiple groups) ────────────────────────
document.querySelectorAll('.seg').forEach(btn => {
  btn.addEventListener('click', () => {
    const group = btn.dataset.group;
    document.querySelectorAll(`.seg[data-group="${group}"]`).forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
});

// ── Toggles ──────────────────────────────────────────────────
['autoFillToggle', 'autoJdToggle'].forEach(id => {
  document.getElementById(id)?.addEventListener('click', function () {
    this.classList.toggle('on');
  });
});

// ── All storage keys ─────────────────────────────────────────
const PROFILE_KEYS = [
  'resumeText', 'resumeBase64', 'resumeFileName',
  'firstName', 'lastName', 'email', 'phone', 'dob',
  'city', 'state', 'country', 'zipcode',
  'linkedinUrl', 'githubUrl', 'portfolioUrl',
  'currentCtc', 'expectedCtc', 'noticePeriod', 'experience',
  'workAuth', 'relocate', 'workMode',
  'degree', 'college', 'gradYear', 'cgpa',
  'extraContext', 'githubData', 'linkedinData',
];
const PREF_KEYS = ['answerStyle', 'tone', 'customInstruction', 'autoFill', 'autoJd'];
const ALL_KEYS  = [...PROFILE_KEYS, ...PREF_KEYS, 'apiKey', 'apiKeyEnc', 'companies'];

// ── Restore saved data on open ───────────────────────────────
chrome.storage.local.get(ALL_KEYS, data => {
  // Resume
  if (data.resumeFileName) showFilePill(data.resumeFileName);

  // Personal
  setVal('firstName',  data.firstName);
  setVal('lastName',   data.lastName);
  setVal('email',      data.email);
  setVal('phone',      data.phone);
  setVal('dob',        data.dob);

  // Location
  setVal('city',       data.city);
  setVal('state',      data.state);
  setVal('country',    data.country);
  setVal('zipcode',    data.zipcode);

  // Links
  setVal('linkedinUrl',   data.linkedinUrl);
  setVal('githubUrl',     data.githubUrl);
  setVal('portfolioUrl',  data.portfolioUrl);

  // Work prefs
  setVal('currentCtc',   data.currentCtc);
  setVal('expectedCtc',  data.expectedCtc);
  setVal('noticePeriod', data.noticePeriod);
  setVal('experience',   data.experience);
  setVal('workAuth',     data.workAuth);
  setVal('relocate',     data.relocate);

  // Work mode segment
  if (data.workMode) {
    document.querySelectorAll('.seg[data-group="workMode"]').forEach(b => {
      b.classList.toggle('active', b.dataset.val === data.workMode);
    });
  }

  // Education
  setVal('degree',   data.degree);
  setVal('college',  data.college);
  setVal('gradYear', data.gradYear);
  setVal('cgpa',     data.cgpa);

  // Extra context
  setVal('extraContext', data.extraContext);

  // Prefs
  if (data.answerStyle) {
    document.querySelectorAll('.seg[data-group="style"]').forEach(b => {
      b.classList.toggle('active', b.dataset.val === data.answerStyle);
    });
  }
  setVal('toneSelect',        data.tone);
  setVal('customInstruction', data.customInstruction);
  if (data.autoFill) document.getElementById('autoFillToggle')?.classList.add('on');
  if (data.autoJd === false) document.getElementById('autoJdToggle')?.classList.remove('on');

  // API key
  if (data.apiKey) setVal('apiKeyInput', data.apiKey);

  // Companies
  renderCompanies(data.companies || {});

  // Status pill
  updateStatus(data);

  // Verified badges
  if (data.linkedinData) setVerified('linkedin', true, '✓ URL saved');
  if (data.githubData)   setVerified('github', true, `✓ Connected · ${data.githubData.publicRepos} repos`);
});

// ── Status pill ──────────────────────────────────────────────
function updateStatus(data) {
  const pill = document.getElementById('statusPill');
  const hasResume = !!(data.resumeText || data.resumeBase64);
  const hasKey    = !!(data.apiKey || data.apiKeyEnc);
  if (hasResume && hasKey) { pill.textContent = 'Ready ✓'; pill.className = 'status-pill ready'; }
  else if (hasResume || hasKey) { pill.textContent = 'Partial setup'; pill.className = 'status-pill partial'; }
  else { pill.textContent = 'Setup needed'; pill.className = 'status-pill'; }
}

// ── Resume upload ─────────────────────────────────────────────
const uploadZone = document.getElementById('uploadZone');
const fileInput  = document.getElementById('resumeFile');

document.getElementById('browseBtn').addEventListener('click', () => fileInput.click());
uploadZone.addEventListener('click', e => { if (e.target.id !== 'browseBtn') fileInput.click(); });
uploadZone.addEventListener('dragover',  e => { e.preventDefault(); uploadZone.classList.add('drag-over'); });
uploadZone.addEventListener('dragleave', ()  => uploadZone.classList.remove('drag-over'));
uploadZone.addEventListener('drop', e => {
  e.preventDefault(); uploadZone.classList.remove('drag-over');
  if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
});
fileInput.addEventListener('change', () => { if (fileInput.files[0]) handleFile(fileInput.files[0]); });

function handleFile(file) {
  if (file.size > 1024 * 1024) { showFeedback('profileMsg', 'File too large. Max 1MB.', true); return; }
  const reader = new FileReader();
  if (file.type === 'application/pdf') {
    reader.onload = e => {
      chrome.storage.local.set({ resumeBase64: e.target.result, resumeFileName: file.name, resumeText: null },
        () => chrome.storage.local.get(ALL_KEYS, updateStatus));
      showFilePill(file.name);
    };
    reader.readAsDataURL(file);
  } else {
    reader.onload = e => {
      chrome.storage.local.set({ resumeText: e.target.result, resumeFileName: file.name, resumeBase64: null },
        () => chrome.storage.local.get(ALL_KEYS, updateStatus));
      showFilePill(file.name);
    };
    reader.readAsText(file);
  }
}

function showFilePill(name) {
  uploadZone.classList.add('hidden');
  document.getElementById('filePill').classList.remove('hidden');
  document.getElementById('fileName').textContent = name;
}

document.getElementById('removeFile').addEventListener('click', () => {
  chrome.storage.local.remove(['resumeText', 'resumeBase64', 'resumeFileName']);
  document.getElementById('filePill').classList.add('hidden');
  uploadZone.classList.remove('hidden');
  fileInput.value = '';
});

// ── Save profile ──────────────────────────────────────────────
document.getElementById('saveProfile').addEventListener('click', () => {
  const workMode = document.querySelector('.seg[data-group="workMode"].active')?.dataset.val || 'any';
  const data = {
    firstName: getVal('firstName'), lastName: getVal('lastName'),
    email: getVal('email'),         phone: getVal('phone'),
    dob: getVal('dob'),
    city: getVal('city'),           state: getVal('state'),
    country: getVal('country'),     zipcode: getVal('zipcode'),
    linkedinUrl: getVal('linkedinUrl'),
    githubUrl: getVal('githubUrl'),
    portfolioUrl: getVal('portfolioUrl'),
    currentCtc: getVal('currentCtc'),
    expectedCtc: getVal('expectedCtc'),
    noticePeriod: getVal('noticePeriod'),
    experience: getVal('experience'),
    workAuth: getVal('workAuth'),
    relocate: getVal('relocate'),
    workMode,
    degree: getVal('degree'),
    college: getVal('college'),
    gradYear: getVal('gradYear'),
    cgpa: getVal('cgpa'),
    extraContext: getVal('extraContext'),
  };
  chrome.storage.local.set(data, () => {
    showFeedback('profileMsg', 'Profile saved ✓');
    chrome.storage.local.get(ALL_KEYS, updateStatus);
  });
});

// ── GitHub verify ─────────────────────────────────────────────
document.getElementById('connectGitHub').addEventListener('click', async () => {
  const url    = getVal('githubUrl');
  const handle = extractGitHubHandle(url);
  if (!handle) { setVerified('github', false, '✗ Invalid GitHub URL'); return; }
  document.getElementById('githubStatus').textContent = 'Fetching…';
  try {
    const [uRes, rRes] = await Promise.all([
      fetch(`https://api.github.com/users/${handle}`),
      fetch(`https://api.github.com/users/${handle}/repos?sort=updated&per_page=10`),
    ]);
    if (!uRes.ok) throw new Error('User not found');
    const user  = await uRes.json();
    const repos = await rRes.json();
    const githubData = {
      name: user.name || handle, bio: user.bio || '',
      followers: user.followers,  publicRepos: user.public_repos,
      repos: repos.map(r => ({ name: r.name, description: r.description, stars: r.stargazers_count, language: r.language })),
    };
    chrome.storage.local.set({ githubData });
    setVerified('github', true, `✓ Connected · ${user.public_repos} repos`);
  } catch (err) {
    setVerified('github', false, `✗ ${err.message}`);
  }
});

document.getElementById('connectLinkedIn').addEventListener('click', () => {
  const url = getVal('linkedinUrl');
  if (!url.includes('linkedin.com')) { setVerified('linkedin', false, '✗ Invalid URL'); return; }
  chrome.storage.local.set({ linkedinUrl: url, linkedinData: { url } });
  setVerified('linkedin', true, '✓ URL saved');
});

function extractGitHubHandle(url) {
  try { const u = new URL(url); return u.pathname.split('/').filter(Boolean)[0] || null; }
  catch { return null; }
}
function setVerified(platform, ok, msg) {
  const el = document.getElementById(platform === 'github' ? 'githubStatus' : 'linkedinStatus');
  if (el) { el.textContent = msg; el.style.color = ok ? '#16A34A' : '#DC2626'; }
}

// ── Save preferences ──────────────────────────────────────────
document.getElementById('savePrefs').addEventListener('click', () => {
  const style = document.querySelector('.seg[data-group="style"].active')?.dataset.val || 'balanced';
  chrome.storage.local.set({
    answerStyle: style,
    tone: getVal('toneSelect'),
    customInstruction: getVal('customInstruction'),
    autoFill: document.getElementById('autoFillToggle').classList.contains('on'),
    autoJd:   document.getElementById('autoJdToggle').classList.contains('on'),
  }, () => showFeedback('prefsMsg', 'Preferences saved ✓'));
});

// ── Companies ─────────────────────────────────────────────────
function renderCompanies(companies) {
  const list = document.getElementById('companiesList');
  list.innerHTML = '';
  if (!Object.keys(companies).length) {
    list.innerHTML = '<p style="font-size:12px;color:#9CA3AF">No companies saved yet.</p>';
    return;
  }
  Object.entries(companies).forEach(([name, notes]) => {
    const card = document.createElement('div');
    card.className = 'company-card';
    card.innerHTML = `
      <div class="company-card-header">
        <span class="company-name">${name}</span>
        <button class="company-remove" data-name="${name}">×</button>
      </div>
      <textarea class="inp ta" rows="2" placeholder="Notes about this company…">${notes}</textarea>
    `;
    card.querySelector('textarea').addEventListener('change', e => {
      chrome.storage.local.get(['companies'], d => {
        const c = d.companies || {}; c[name] = e.target.value;
        chrome.storage.local.set({ companies: c });
      });
    });
    card.querySelector('.company-remove').addEventListener('click', () => {
      chrome.storage.local.get(['companies'], d => {
        const c = d.companies || {}; delete c[name];
        chrome.storage.local.set({ companies: c }, () => renderCompanies(c));
      });
    });
    list.appendChild(card);
  });
}

function renderApplicationLog() {
  chrome.storage.local.get(['applications'], data => {
    const log = document.getElementById('applicationLog');
    if (!log) return;
    const apps = data.applications || [];
    if (!apps.length) {
      log.innerHTML = '<p style="font-size:12px;color:#9CA3AF;margin-top:4px">No applications logged yet. The tracker dialog will appear automatically when you visit job pages.</p>';
      return;
    }
    log.innerHTML = apps.map(a => {
      const date = new Date(a.date).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' });
      return `<div class="app-log-card">
        <div class="app-log-header">
          <div>
            <div class="app-log-company">${escapeHtml(a.company)}</div>
            <div class="app-log-role">${escapeHtml(a.role || '—')}</div>
          </div>
          <div class="app-log-date">${date}</div>
        </div>
        ${a.url ? `<a class="app-log-url" href="${a.url}" target="_blank">${new URL(a.url).hostname}</a>` : ''}
      </div>`;
    }).join('');
  });
}

document.getElementById('addCompany').addEventListener('click', () => {
  const name = getVal('companyName').trim();
  if (!name) return;
  chrome.storage.local.get(['companies'], d => {
    const c = d.companies || {}; c[name] = '';
    chrome.storage.local.set({ companies: c }, () => {
      renderCompanies(c);
      document.getElementById('companyName').value = '';
    });
  });
});

// ── My Context tab ────────────────────────────────────────────
document.getElementById('refreshContext').addEventListener('click', loadContext);

async function loadContext() {
  const loading   = document.getElementById('contextLoading');
  const container = document.getElementById('contextSections');
  loading.classList.remove('hidden');
  container.innerHTML = '';
  const result = await chrome.runtime.sendMessage({ type: 'GET_MY_CONTEXT' });
  loading.classList.add('hidden');
  if (result.error) {
    container.innerHTML = `<p style="color:#DC2626;font-size:12px">${result.error}</p>`;
    return;
  }
  result.sections.forEach(({ title, status, detail }) => {
    const badgeClass = { loaded: 'badge-ok', connected: 'badge-ok', set: 'badge-ok',
      'url-only': 'badge-warn', 'url-saved': 'badge-warn',
      missing: 'badge-error', empty: 'badge-warn' }[status] || 'badge-warn';
    const badgeLabel = { loaded: '✓ Loaded', connected: '✓ Connected', set: '✓ Set',
      'url-only': '⚠ URL only', 'url-saved': '⚠ URL only',
      missing: '✗ Missing', empty: '— Empty' }[status] || status;
    const section = document.createElement('div');
    section.className = 'context-section';
    section.innerHTML = `
      <div class="context-section-header">
        <span class="context-section-title">${title}</span>
        <span class="context-badge ${badgeClass}">${badgeLabel}</span>
      </div>
      <div class="context-section-body">${escapeHtml(detail)}</div>
    `;
    section.querySelector('.context-section-header').addEventListener('click', () => {
      section.querySelector('.context-section-body').classList.toggle('open');
    });
    if (['missing', 'empty'].includes(status)) {
      section.querySelector('.context-section-body').classList.add('open');
    }
    container.appendChild(section);
  });
}

// ── API key ───────────────────────────────────────────────────
document.getElementById('toggleKey').addEventListener('click', () => {
  const inp = document.getElementById('apiKeyInput');
  inp.type = inp.type === 'password' ? 'text' : 'password';
});
document.getElementById('saveKey').addEventListener('click', async () => {
  const key = getVal('apiKeyInput');
  if (key.length < 10) { showFeedback('apiMsg', 'Key seems too short', true); return; }
  const result = await chrome.runtime.sendMessage({ type: 'SAVE_API_KEY', apiKey: key });
  if (result.ok) {
    showFeedback('apiMsg', 'API key saved ✓ (encrypted)');
    chrome.storage.local.get(ALL_KEYS, updateStatus);
  } else {
    showFeedback('apiMsg', 'Failed to save key', true);
  }
});
document.getElementById('testKey').addEventListener('click', async () => {
  const key = getVal('apiKeyInput');
  if (!key) { showFeedback('apiMsg', 'Enter a key first', true); return; }
  showFeedback('apiMsg', 'Testing…');
  const result = await chrome.runtime.sendMessage({ type: 'TEST_API', apiKey: key });
  showFeedback('apiMsg', result.ok ? 'Connection works ✓' : `Failed: ${result.error}`, !result.ok);
});

// ── Resume tailoring ──────────────────────────────────────────
document.getElementById('tailorResume').addEventListener('click', async () => {
  const jd = getVal('jdForResume');
  if (!jd) { showFeedback('resumeMsg', 'Paste a job description first', true); return; }
  document.getElementById('resumeLoading').classList.remove('hidden');
  document.getElementById('resumeResult').classList.add('hidden');
  document.getElementById('tailorResume').disabled = true;
  const result = await chrome.runtime.sendMessage({ type: 'TAILOR_RESUME', jd, style: getVal('resumeStyle') });
  document.getElementById('resumeLoading').classList.add('hidden');
  document.getElementById('tailorResume').disabled = false;
  if (result.error) { showFeedback('resumeMsg', result.error, true); return; }
  const score = result.atsScore || 0;
  document.getElementById('atsScore').textContent = `${score}%`;
  document.getElementById('atsFill').style.width   = `${score}%`;
  document.getElementById('atsFill').style.background = score >= 70 ? '#16A34A' : score >= 40 ? '#D97706' : '#DC2626';
  renderChips('matchedKw', result.matchedKeywords || [], false);
  renderChips('missingKw', result.missingKeywords || [], true);
  chrome.storage.local.set({ tailoredResumeText: result.tailoredResume });
  document.getElementById('resumeResult').classList.remove('hidden');
});

document.getElementById('applyEdit').addEventListener('click', async () => {
  const prompt = getVal('resumeEditPrompt');
  if (!prompt) return;
  document.getElementById('applyEdit').disabled = true;
  document.getElementById('applyEdit').textContent = '…';
  const result = await chrome.runtime.sendMessage({ type: 'EDIT_RESUME', editPrompt: prompt });
  document.getElementById('applyEdit').disabled = false;
  document.getElementById('applyEdit').textContent = 'Apply';
  if (result.error) { showFeedback('resumeMsg', result.error, true); return; }
  chrome.storage.local.set({ tailoredResumeText: result.tailoredResume });
  document.getElementById('resumeEditPrompt').value = '';
  showFeedback('resumeMsg', 'Resume updated ✓');
});

document.getElementById('downloadPdf').addEventListener('click', async () => {
  const result = await chrome.runtime.sendMessage({ type: 'GENERATE_PDF' });
  if (result.error) showFeedback('resumeMsg', result.error, true);
});

// ── Helpers ───────────────────────────────────────────────────
function getVal(id) {
  const el = document.getElementById(id);
  return el ? el.value.trim() : '';
}
function setVal(id, val) {
  const el = document.getElementById(id);
  if (el && val !== undefined && val !== null) el.value = val;
}
function renderChips(containerId, words, isMissing) {
  const el = document.getElementById(containerId);
  el.innerHTML = '';
  if (!words.length) { el.innerHTML = '<span style="font-size:11px;color:#9CA3AF">None</span>'; return; }
  words.forEach(w => {
    const chip = document.createElement('span');
    chip.className = `kw-chip${isMissing ? ' miss' : ''}`;
    chip.textContent = w;
    el.appendChild(chip);
  });
}
function showFeedback(id, msg, isErr = false) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.className = `feedback${isErr ? ' err' : ''}`;
  el.classList.remove('hidden');
  if (!isErr) setTimeout(() => el.classList.add('hidden'), 3000);
}
function escapeHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}