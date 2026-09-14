// ═══════════════════════════════════════════════════════════
//  JobAssist AI — Content Script v7
// ═══════════════════════════════════════════════════════════
(function () {
  if (window.__jaLoaded) return;
  window.__jaLoaded = true;

  // ── State ───────────────────────────────────────────────
  let activeField      = null;
  let jobDesc          = null;
  let companyName      = null;
  let detectedRole     = null;
  let aiFilledFields   = new WeakSet();
  let panel            = null;
  let bubble           = null;
  let sidebar          = null;
  let generating       = false;
  let panelOpen        = false;
  let bubbleMouseDown  = false;
  let appLogged        = false; // only log once per page

  const host = location.hostname.replace(/^www\./, '').toLowerCase();

  // ── Blocklist ────────────────────────────────────────────
  const BLOCKED = ['www.google.com','google.com','bing.com','yahoo.com',
    'duckduckgo.com','twitter.com','x.com','facebook.com','instagram.com',
    'whatsapp.com','telegram.org','discord.com','slack.com','reddit.com',
    'quora.com','pinterest.com','youtube.com','netflix.com','hotstar.com',
    'spotify.com','twitch.tv','amazon.com','amazon.in','flipkart.com',
    'myntra.com','swiggy.com','zomato.com','medium.com','substack.com',
    'github.com','gitlab.com','stackoverflow.com','npmjs.com','w3schools.com',
    'maps.google.com','gmail.com','outlook.com','drive.google.com',
    'chat.openai.com','chatgpt.com','claude.ai','gemini.google.com',
    'bard.google.com','copilot.microsoft.com','perplexity.ai',
  ];

  const isGoogleForms = host === 'docs.google.com' && location.pathname.includes('/forms/');
  if (!isGoogleForms && BLOCKED.some(d => host === d || host.endsWith('.'+d))) return;
  if (host === 'docs.google.com' && !location.pathname.includes('/forms/')) return;

  // ── Known ATS ────────────────────────────────────────────
  const ATS_DOMAINS = [
    'linkedin.com','indeed.com','naukri.com','internshala.com','glassdoor.com',
    'monster.com','shine.com','foundit.in','unstop.com','wellfound.com','angel.co',
    'instahyre.com','hirist.com','iimjobs.com','cutshort.io','apna.co',
    'lever.co','greenhouse.io','workday.com','myworkdayjobs.com','icims.com',
    'taleo.net','smartrecruiters.com','ashbyhq.com','breezy.hr','bamboohr.com',
    'jobvite.com','recruitee.com','workable.com','applytojob.com','jazzhr.com',
    'careers.google.com','jobs.apple.com','amazon.jobs','careers.microsoft.com',
    'metacareers.com','jobs.netflix.com','jobs.ycombinator.com','hiring.cafe',
  ];
  const isKnownATS = ATS_DOMAINS.some(d => host === d || host.endsWith('.'+d));

  // ── Boot ─────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => delayedBoot(isKnownATS));
  } else {
    delayedBoot(isKnownATS);
  }

  function delayedBoot(skipScoring) {
    if (skipScoring) { activate(); return; }
    let done = false;
    function tryActivate() {
      if (done) return;
      if (getJobScore() >= 2) { done = true; activate(); }
    }
    tryActivate();
    [500, 1500, 3000].forEach(d => setTimeout(tryActivate, d));
    const obs = new MutationObserver(() => { tryActivate(); if (done) obs.disconnect(); });
    obs.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => obs.disconnect(), 8000);
  }

  // ── Scoring ──────────────────────────────────────────────
  function getJobScore() {
    const path  = location.pathname.toLowerCase();
    const href  = location.href.toLowerCase();
    const title = document.title.toLowerCase();
    let score   = 0;

    const STRONG_PATHS = ['/apply','/application','/careers/','/career/','/jobs/',
      '/job/','/vacancy/','/opening/','/internship/','/recruitment/','/hiring/',
      '/viewform','/work-with-us','/join-us'];
    if (STRONG_PATHS.some(p => path.includes(p))) score += 2;

    const STRONG_PARAMS = ['gh_jid=','jobid=','job_id=','jobcode=','positionid=',
      'requisitionid=','openingid=','lever-origin='];
    if (STRONG_PARAMS.some(p => href.includes(p))) score += 2;

    const MED_SUBS = ['jobs.','careers.','career.','hiring.','recruit.','apply.','talent.'];
    if (MED_SUBS.some(p => host.startsWith(p))) score += 1;

    const TITLE_KW = ['apply','application','job','career','vacancy',
      'internship','hiring','recruitment','opening','position'];
    if (TITLE_KW.some(k => title.includes(k))) score += 1;

    const ATS_DOM = ['#application','.application-form',
      '[data-automation-id="applicationPage"]','[data-automation-id="job-posting-details"]',
      '.posting-apply','form[action*="apply"]','[class*="apply-form"]',
      '[class*="job-application"]','.freebirdFormviewerViewHeaderTitle'];
    if (ATS_DOM.some(s => { try { return !!document.querySelector(s); } catch { return false; } })) score += 2;

    const JD_DOM = ['[class*="job-description"]','[class*="jobDescription"]',
      '[class*="description__text"]','.jobsearch-jobDescriptionText',
      '.posting-description','[class*="job-details"]'];
    if (JD_DOM.some(s => {
      try { const el = document.querySelector(s); return el && el.innerText.length > 100; }
      catch { return false; }
    })) score += 1;

    if (isGoogleForms) {
      const t = [document.title,
        document.querySelector('.freebirdFormviewerViewHeaderTitle')?.innerText || '',
        ...[...document.querySelectorAll('.freebirdFormviewerViewItemsItemItemTitle')].map(e=>e.innerText)
      ].join(' ').toLowerCase();
      const JOB_KW = ['job','career','apply','intern','hiring','placement','campus',
        'drive','recruit','resume','cv','experience','cgpa','branch','college','fresher'];
      if (JOB_KW.some(w => t.includes(w))) score += 2;
    }
    return score;
  }

  // ══════════════════════════════════════════════════════════
  //  ACTIVATE
  // ══════════════════════════════════════════════════════════
  function activate() {
    chrome.storage.local.get(['autoJd'], d => {
      buildBubble();
      buildPanel();
      buildTrackerDialog();
      document.addEventListener('focusin',  onFocusIn,  true);
      document.addEventListener('focusout', onFocusOut, true);
      document.addEventListener('mouseup',  onMouseUp,  true);
      if (d.autoJd !== false) {
        scanForJobDesc();
        new MutationObserver(() => {
          if (!jobDesc) scanForJobDesc();
          if (!appLogged && jobDesc) maybeShowTracker();
        }).observe(document.body, { childList: true, subtree: true });
      }
      autoFillAllStandardFields();
    });
  }

  // ══════════════════════════════════════════════════════════
  //  FIELD DETECTION
  // ══════════════════════════════════════════════════════════
  function onFocusIn(e) {
    if (panelOpen) return;
    const el = e.target;
    if (!isApplicationField(el)) return;
    activeField = el;
    showBubble(el, aiFilledFields.has(el));
  }
  function onFocusOut() {
    setTimeout(() => {
      if (panelOpen || bubbleMouseDown) return;
      const f = document.activeElement;
      if (bubble?.contains(f) || panel?.contains(f)) return;
      hideBubble();
    }, 250);
  }
  function onMouseUp() {
    if (window.getSelection()?.toString().length > 0) hideBubble();
  }

  function isApplicationField(el) {
    if (!el?.tagName) return false;
    const tag = el.tagName.toUpperCase();
    if (isGoogleForms) {
      if (tag === 'TEXTAREA') return true;
      if (tag === 'INPUT' && el.type === 'text') return true;
      return false;
    }
    if (tag === 'TEXTAREA') return el.getBoundingClientRect().height > 28;
    if (el.getAttribute?.('contenteditable') === 'true') {
      const r = el.getBoundingClientRect();
      return r.height > 50 && r.width > 150;
    }
    if (tag === 'INPUT' && (el.type||'text') === 'text') {
      const combined = [el.name,el.id,el.placeholder,el.getAttribute('aria-label')]
        .filter(Boolean).join(' ').toLowerCase();
      const SKIP = ['search','query','email','mobile','tel','zip','postal','first',
        'last','user','pass','url','website','linkedin','github','city','state',
        'country','address','ctc','salary','notice','code','date','birth','referral','pincode'];
      if (SKIP.some(w => combined.includes(w))) return false;
      const label = getLabel(el).toLowerCase();
      const TRIGGERS = ['why','describe','tell','how would','what is your','background',
        'experience','skill','strength','weakness','passion','contribute','motivation',
        'cover','statement','goal','interest','about yourself','elaborate','explain',
        'project','achievement','responsibility','summary'];
      return TRIGGERS.some(t => label.includes(t));
    }
    return false;
  }

  function getLabel(el) {
    if (isGoogleForms) {
      let cur = el.parentElement;
      for (let i = 0; i < 15 && cur; i++) {
        const isContainer = cur.hasAttribute('data-params') || cur.hasAttribute('jsmodel')
          || cur.classList.contains('freebirdFormviewerViewItemsItemItem')
          || cur.getAttribute('role') === 'listitem';
        if (isContainer) {
          const h = cur.querySelector('[role="heading"]');
          if (h) { const t = h.innerText.trim(); if (t && t !== 'Your answer') return t; }
          const lt = cur.querySelector('.freebirdFormviewerViewItemsItemItemTitle');
          if (lt) return lt.innerText.trim();
          break;
        }
        cur = cur.parentElement;
      }
      const a = el.getAttribute('aria-label');
      return (a && a !== 'Your answer') ? a : '';
    }
    try {
      if (el.id) {
        const lbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (lbl) return lbl.innerText.trim();
      }
    } catch {}
    if (el.getAttribute('aria-label')) return el.getAttribute('aria-label');
    const by = el.getAttribute('aria-labelledby');
    if (by) { const r = document.getElementById(by); if (r) return r.innerText.trim(); }
    if (el.placeholder) return el.placeholder;
    let cur = el.parentElement;
    for (let i = 0; i < 5 && cur; i++) {
      const lbl = cur.querySelector('label');
      if (lbl && !lbl.contains(el)) return lbl.innerText.trim();
      cur = cur.parentElement;
    }
    return '';
  }

  // ══════════════════════════════════════════════════════════
  //  BUBBLE
  // ══════════════════════════════════════════════════════════
  function buildBubble() {
    bubble = document.createElement('div');
    bubble.id = 'ja-bubble';
    bubble.innerHTML = `<span class="ja-bubble-label">✦ Answer with AI</span>`;
    bubble.addEventListener('mouseenter', () => { bubbleMouseDown = false; });
    bubble.addEventListener('mousedown',  e => { e.preventDefault(); e.stopPropagation(); bubbleMouseDown = true; });
    bubble.addEventListener('mouseup',    e => { e.preventDefault(); e.stopPropagation(); if (bubbleMouseDown) { bubbleMouseDown = false; openPanel(); } });
    document.body.appendChild(bubble);
    hideBubble();
  }
  function showBubble(field, isRegen) {
    if (!bubble) return;
    bubble.querySelector('.ja-bubble-label').textContent = isRegen ? '↺ Re-answer with AI' : '✦ Answer with AI';
    bubble.dataset.regen = isRegen ? '1' : '';
    positionBubble(field);
    bubble.style.visibility = 'visible';
    bubble.style.opacity    = '1';
  }
  function hideBubble() {
    if (!bubble) return;
    bubble.style.opacity    = '0';
    bubble.style.visibility = 'hidden';
  }
  function positionBubble(field) {
    const rect = field.getBoundingClientRect();
    let top  = rect.top - 36;
    let left = rect.right - 185;
    if (left < 4) left = 4;
    if (left + 185 > window.innerWidth) left = window.innerWidth - 190;
    if (top  < 4) top  = rect.bottom + 4;
    bubble.style.position = 'fixed';
    bubble.style.top      = top  + 'px';
    bubble.style.left     = left + 'px';
  }

  // ══════════════════════════════════════════════════════════
  //  PANEL
  // ══════════════════════════════════════════════════════════
  function buildPanel() {
    panel = document.createElement('div');
    panel.id = 'ja-panel';
    panel.innerHTML = `
      <div id="ja-ph">
        <div id="ja-ptitle"><span id="ja-pmark">JA</span> JobAssist AI</div>
        <button id="ja-close-btn" type="button">✕</button>
      </div>
      <div id="ja-pb">
        <div class="ja-field-group">
          <label class="ja-label">Application question</label>
          <textarea id="ja-question" rows="3" placeholder="Paste the question here…"></textarea>
        </div>

        <div class="ja-field-group">
          <label class="ja-label">Custom instruction <span class="ja-opt">optional</span></label>
          <textarea id="ja-custom-prompt" rows="2"
            placeholder='e.g. "Focus on my n8n project" or "Keep it under 3 sentences"'></textarea>
        </div>

        <div class="ja-collapsible">
          <button class="ja-collapse-btn" id="ja-jd-toggle" type="button">
            <span>Job description / link</span>
            <span class="ja-arrow">›</span>
          </button>
          <div class="ja-collapse-body ja-hidden" id="ja-jd-body">
            <div id="ja-jd-link-row">
              <input type="url" id="ja-jd-link" placeholder="Paste a URL to fetch JD (Notion, Word, career page…)" />
              <button id="ja-jd-fetch-btn" type="button">Fetch</button>
            </div>
            <div id="ja-jd-fetch-status" class="ja-hidden"></div>
            <textarea id="ja-jd" rows="4" placeholder="…or paste the job description text directly here"></textarea>
          </div>
        </div>

        <button id="ja-gen-btn" type="button">✦ Generate &amp; fill</button>
        <div id="ja-status" class="ja-hidden"></div>

        <div id="ja-result-box" class="ja-hidden">
          <label class="ja-label">Your answer <small>(editable)</small></label>
          <div id="ja-answer-text" contenteditable="true"></div>
          <div id="ja-result-actions">
            <button id="ja-insert-btn" type="button">Insert into field</button>
            <button id="ja-regen-btn"  type="button">Regenerate</button>
            <button id="ja-copy-btn"   type="button">Copy</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(panel);
    panel.classList.add('ja-hidden');

    panel.querySelector('#ja-close-btn').onclick  = e => { e.preventDefault(); e.stopPropagation(); closePanel(); };
    panel.querySelector('#ja-gen-btn').onclick     = () => runGenerate();
    panel.querySelector('#ja-regen-btn').onclick   = () => runGenerate();
    panel.querySelector('#ja-insert-btn').onclick  = () => insertAnswer();
    panel.querySelector('#ja-copy-btn').onclick    = () => copyAnswer();
    panel.querySelector('#ja-jd-toggle').onclick   = toggleJd;
    panel.querySelector('#ja-jd-fetch-btn').onclick = fetchJdUrl;
    panel.addEventListener('mousedown', e => e.stopPropagation());
    panel.addEventListener('click',     e => e.stopPropagation());
  }

  function toggleJd() {
    const body  = panel.querySelector('#ja-jd-body');
    const arrow = panel.querySelector('.ja-arrow');
    const isHidden = body.classList.contains('ja-hidden');
    body.classList.toggle('ja-hidden', !isHidden);
    arrow.textContent = isHidden ? '‹' : '›';
  }

  async function fetchJdUrl() {
    const url = panel.querySelector('#ja-jd-link').value.trim();
    if (!url) return;
    const statusEl = panel.querySelector('#ja-jd-fetch-status');
    statusEl.textContent = '⏳ Fetching…';
    statusEl.className = 'ja-fetch-loading';
    statusEl.classList.remove('ja-hidden');
    panel.querySelector('#ja-jd-fetch-btn').disabled = true;

    const res = await chrome.runtime.sendMessage({ type: 'FETCH_URL', url });

    panel.querySelector('#ja-jd-fetch-btn').disabled = false;
    if (res.error) {
      statusEl.textContent = `⚠ ${res.error}`;
      statusEl.className   = 'ja-fetch-error';
    } else {
      panel.querySelector('#ja-jd').value = res.text;
      statusEl.textContent = `✓ Loaded ${res.text.length} characters from URL`;
      statusEl.className   = 'ja-fetch-ok';
    }
  }

  function openPanel() {
    if (!panel) return;
    hideBubble();
    panel.classList.remove('ja-hidden');
    panelOpen = true;
    const qEl = panel.querySelector('#ja-question');
    if (activeField) {
      const label = getLabel(activeField);
      if (label && label.length > 3 && label.length < 500) qEl.value = label;
      else if (!label) qEl.value = '';
    }
    if (jobDesc && !panel.querySelector('#ja-jd').value.trim())
      panel.querySelector('#ja-jd').value = jobDesc.slice(0, 3000);
  }
  function closePanel() {
    if (!panel) return;
    panel.classList.add('ja-hidden');
    panelOpen  = false;
    generating = false;
    panel.querySelector('#ja-result-box').classList.add('ja-hidden');
    panel.querySelector('#ja-status').classList.add('ja-hidden');
    panel.querySelector('#ja-gen-btn').disabled = false;
  }

  // ══════════════════════════════════════════════════════════
  //  GENERATE
  // ══════════════════════════════════════════════════════════
  async function runGenerate() {
    if (generating) return;
    const question = panel.querySelector('#ja-question').value.trim();
    if (!question) { setStatus('⚠ Paste the question first.', 'err'); return; }
    generating = true;
    panel.querySelector('#ja-result-box').classList.add('ja-hidden');
    panel.querySelector('#ja-gen-btn').disabled = true;
    setStatus('Writing your answer…', 'loading');
    const res = await chrome.runtime.sendMessage({
      type: 'GENERATE_ANSWER',
      question,
      jobDescription: panel.querySelector('#ja-jd').value.trim() || jobDesc,
      fieldHint:      activeField ? getLabel(activeField) : '',
      companyName,
      customPrompt:   panel.querySelector('#ja-custom-prompt').value.trim(),
    });
    generating = false;
    panel.querySelector('#ja-gen-btn').disabled = false;
    panel.querySelector('#ja-status').classList.add('ja-hidden');
    if (res.error) { setStatus('⚠ ' + res.error, 'err'); return; }
    panel.querySelector('#ja-answer-text').textContent = res.answer;
    panel.querySelector('#ja-result-box').classList.remove('ja-hidden');
  }
  function setStatus(msg, type) {
    const el = panel.querySelector('#ja-status');
    el.textContent = msg;
    el.className   = type === 'err' ? 'ja-status-err' : 'ja-status-loading';
    el.classList.remove('ja-hidden');
  }
  function insertAnswer() {
    const text = panel.querySelector('#ja-answer-text').textContent.trim();
    if (!text || !activeField) return;
    setValue(activeField, text);
    aiFilledFields.add(activeField);
    closePanel();
    setTimeout(() => activeField?.focus(), 50);
  }
  function copyAnswer() {
    navigator.clipboard.writeText(panel.querySelector('#ja-answer-text').textContent.trim())
      .then(() => {
        const btn = panel.querySelector('#ja-copy-btn');
        const o = btn.textContent; btn.textContent = 'Copied ✓';
        setTimeout(() => btn.textContent = o, 1800);
      });
  }

  // ══════════════════════════════════════════════════════════
  //  APPLICATION TRACKER DIALOG
  // ══════════════════════════════════════════════════════════
  function buildTrackerDialog() {
    const d = document.createElement('div');
    d.id = 'ja-tracker';
    d.innerHTML = `
      <div id="ja-tracker-inner">
        <div id="ja-tracker-header">
          <span>📋 Log this application</span>
          <button id="ja-tracker-close" type="button">✕</button>
        </div>
        <p id="ja-tracker-sub">We detected you're applying — save this for your tracker.</p>
        <div class="ja-tfield">
          <label>Company</label>
          <input type="text" id="ja-t-company" placeholder="e.g. Google" />
        </div>
        <div class="ja-tfield">
          <label>Role / Position</label>
          <input type="text" id="ja-t-role" placeholder="e.g. Software Engineer Intern" />
        </div>
        <div class="ja-tfield">
          <label>Notes <span class="ja-opt">optional</span></label>
          <input type="text" id="ja-t-notes" placeholder="e.g. Referral from Rahul" />
        </div>
        <div id="ja-tracker-actions">
          <button id="ja-tracker-save" type="button">Save application</button>
          <button id="ja-tracker-skip" type="button">Skip</button>
        </div>
      </div>
    `;
    document.body.appendChild(d);
    d.classList.add('ja-hidden');
    d.querySelector('#ja-tracker-close').onclick = () => d.classList.add('ja-hidden');
    d.querySelector('#ja-tracker-skip').onclick  = () => d.classList.add('ja-hidden');
    d.querySelector('#ja-tracker-save').onclick  = saveApplication;
    sidebar = d; // reuse sidebar variable for tracker
  }

  function maybeShowTracker() {
    if (appLogged) return;
    const dlg = document.getElementById('ja-tracker');
    if (!dlg || !dlg.classList.contains('ja-hidden')) return;

    // Auto-detect company from page
    const detected = detectCompanyAndRole();
    if (detected.company) document.getElementById('ja-t-company').value = detected.company;
    if (detected.role)    document.getElementById('ja-t-role').value    = detected.role;

    dlg.classList.remove('ja-hidden');
    // Auto-dismiss after 15s if user ignores it
    setTimeout(() => dlg.classList.add('ja-hidden'), 15000);
  }

  function detectCompanyAndRole() {
    // Company: from page title, h1, or meta og:site_name
    const ogSite  = document.querySelector('meta[property="og:site_name"]')?.content;
    const h1Text  = document.querySelector('h1')?.innerText?.trim();
    const title   = document.title;
    let company   = ogSite || '';

    // Try to extract from title pattern "Role - Company | Careers"
    const titleMatch = title.match(/(.+?)\s*[–\-|at]\s*(.+?)(\s*[–\-|]|$)/);
    let role = '';
    if (titleMatch) {
      role    = titleMatch[1].trim().slice(0, 80);
      company = company || titleMatch[2].trim().slice(0, 60);
    }

    // Fallback: h1 is usually the job title
    if (!role && h1Text && h1Text.length < 120) role = h1Text;
    // Fallback: hostname as company name
    if (!company) {
      company = host.replace(/^(jobs|careers|career|hiring)\./,'')
        .split('.')[0].replace(/-/g,' ')
        .replace(/\b\w/g, c => c.toUpperCase());
    }

    companyName   = company;
    detectedRole  = role;
    return { company, role };
  }

  async function saveApplication() {
    const company = document.getElementById('ja-t-company').value.trim();
    const role    = document.getElementById('ja-t-role').value.trim();
    const notes   = document.getElementById('ja-t-notes').value.trim();
    const btn     = document.getElementById('ja-tracker-save');
    btn.textContent = 'Saving…';
    btn.disabled    = true;

    await chrome.runtime.sendMessage({
      type: 'LOG_APPLICATION',
      company, role,
      url:   location.href,
      jd:    jobDesc || '',
      date:  new Date().toISOString(),
      notes,
    });
    // Also save to companies store for context
    chrome.storage.local.get(['companies'], d => {
      const c = d.companies || {};
      if (company && !c[company]) { c[company] = notes || ''; chrome.storage.local.set({ companies: c }); }
    });

    appLogged = true;
    document.getElementById('ja-tracker').classList.add('ja-hidden');
  }

  // ══════════════════════════════════════════════════════════
  //  SMART AUTOFILL
  // ══════════════════════════════════════════════════════════
  const DEGREE_LABELS = {
    btech:'B.Tech / B.E.', bsc:'B.Sc', bca:'BCA', bcom:'B.Com', ba:'B.A.',
    mtech:'M.Tech / M.E.', msc:'M.Sc', mca:'MCA', mba:'MBA', phd:'Ph.D',
    diploma:'Diploma', other:'Other',
  };

  function getFieldMapping(c, p) {
    if (/\bfirst.?name\b/.test(c))                                return p.firstName;
    if (/\blast.?name\b|surname/.test(c))                         return p.lastName;
    if (/\bfull.?name\b/.test(c))                                 return [p.firstName,p.lastName].filter(Boolean).join(' ');
    if (/\bemail\b/.test(c))                                      return p.email;
    if (/\bphone\b|\bmobile\b|\bcontact.?no\b/.test(c))          return p.phone;
    if (/dob|date.?of.?birth|birth.?date/.test(c))               return p.dob;
    if (/\bcity\b/.test(c))                                       return p.city;
    if (/\bstate\b|\bprovince\b/.test(c))                         return p.state;
    if (/\bcountry\b/.test(c))                                    return p.country;
    if (/\bzip\b|\bpincode\b|\bpostal\b/.test(c))                return p.zipcode;
    if (/\blinkedin\b/.test(c))                                   return p.linkedinUrl;
    if (/\bgithub\b/.test(c))                                     return p.githubUrl;
    if (/\bportfolio\b|\bwebsite\b|\bpersonal.?site\b/.test(c))  return p.portfolioUrl;
    if (/current.?(ctc|salary|compensation)/.test(c))             return p.currentCtc;
    if (/expected.?(ctc|salary|compensation)/.test(c))            return p.expectedCtc;
    if (/notice.?period/.test(c))                                  return p.noticePeriod;
    if (/years?.?of?.?exp|total.?exp/.test(c))                   return p.experience;
    if (/\bcollege\b|\buniversity\b|\binstitut/.test(c))          return p.college;
    if (/\bdegree\b|\bqualification\b/.test(c))                   return DEGREE_LABELS[p.degree] || p.degree;
    if (/graduation.?year|passing.?year/.test(c))                 return p.gradYear;
    if (/\bcgpa\b|\bpercentage\b|\bgpa\b/.test(c))               return p.cgpa;
    if (/\buniversity\b/.test(c))                                  return p.college;
    return null;
  }

  function loadProfile() {
    return new Promise(r => chrome.storage.local.get([
      'firstName','lastName','email','phone','dob',
      'city','state','country','zipcode',
      'linkedinUrl','githubUrl','portfolioUrl',
      'currentCtc','expectedCtc','noticePeriod','experience',
      'degree','college','gradYear','cgpa',
    ], r));
  }

  function autoFillAllStandardFields() {
    let attempts = 0;
    async function tryFill() {
      attempts++;
      const profile = await loadProfile();
      const fields = document.querySelectorAll(
        'input[type="text"],input[type="email"],input[type="tel"],input[type="url"],textarea,select'
      );
      let filled = 0;
      for (const el of fields) {
        if (el.value?.trim()) continue;
        const style = window.getComputedStyle(el);
        if (style.display==='none' || style.visibility==='hidden') continue;
        const rect = el.getBoundingClientRect();
        if (rect.width===0 && rect.height===0) continue;
        if (el.disabled || el.readOnly) continue;
        const combined = [el.name,el.id,el.placeholder,
          el.getAttribute('aria-label'),el.getAttribute('autocomplete'),
          el.getAttribute('data-automation-id'),getLabel(el)
        ].filter(Boolean).join(' ').toLowerCase();
        const val = getFieldMapping(combined, profile);
        if (val) {
          setValue(el, val);
          flashField(el);
          filled++;
          await new Promise(r => setTimeout(r, 80));
        }
      }
      if (filled === 0 && attempts < 6) setTimeout(tryFill, 700);
    }
    setTimeout(tryFill, 800);
  }

  function flashField(el) {
    const prev = el.style.outline;
    el.style.outline = '2px solid #4F46E5';
    setTimeout(() => { el.style.outline = prev; }, 1200);
  }

  // ══════════════════════════════════════════════════════════
  //  SET VALUE (React / Vue / Google Forms compatible)
  // ══════════════════════════════════════════════════════════
  function setValue(el, text) {
    if (el.tagName==='TEXTAREA' || el.tagName==='INPUT') {
      if (isGoogleForms) { setValueGoogleForms(el, text); return; }
      const proto = Object.getOwnPropertyDescriptor(
        el.tagName==='TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value'
      );
      if (proto?.set) proto.set.call(el, text); else el.value = text;
      ['input','change','blur'].forEach(ev => el.dispatchEvent(new Event(ev, { bubbles:true })));
    } else if (el.getAttribute?.('contenteditable')==='true') {
      el.innerText = text;
      el.dispatchEvent(new InputEvent('input', { bubbles:true }));
    }
  }
  function setValueGoogleForms(el, text) {
    el.focus(); el.click();
    el.value = '';
    el.dispatchEvent(new Event('input', { bubbles:true }));
    const proto = Object.getOwnPropertyDescriptor(
      el.tagName==='TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value'
    );
    if (proto?.set) proto.set.call(el, text); else el.value = text;
    el.dispatchEvent(new Event('focus',  { bubbles:true }));
    el.dispatchEvent(new KeyboardEvent('keydown',  { bubbles:true }));
    el.dispatchEvent(new InputEvent('input', { bubbles:true, inputType:'insertText', data:text }));
    el.dispatchEvent(new KeyboardEvent('keyup', { bubbles:true }));
    el.dispatchEvent(new Event('change', { bubbles:true }));
    el.dispatchEvent(new Event('blur',   { bubbles:true }));
  }

  // ══════════════════════════════════════════════════════════
  //  JD SCANNER + TRACKER TRIGGER
  // ══════════════════════════════════════════════════════════
  function scanForJobDesc() {
    const SELS = [
      '[class*="description__text"]','[class*="job-description"]','[class*="jobDescription"]',
      '.jobsearch-jobDescriptionText','[data-testid="job-description"]',
      '.posting-description','#job-details','[class*="job-details"]',
      '[data-automation-id="job-posting-details"]','[class*="JobDetails"]',
    ];
    for (const sel of SELS) {
      try {
        const el = document.querySelector(sel);
        if (el && el.innerText.trim().length > 200) {
          jobDesc = el.innerText.trim().slice(0, 5000);
          const h1 = document.querySelector('h1');
          if (h1) companyName = h1.innerText.trim().slice(0, 80);
          // Show tracker dialog after JD detected
          setTimeout(() => maybeShowTracker(), 2000);
          return;
        }
      } catch {}
    }
  }

})();