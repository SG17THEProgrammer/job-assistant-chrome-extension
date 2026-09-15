// ═══════════════════════════════════════════════════════════
//  JobAssist AI — Content Script v8
//  Major changes:
//  - Fixed right sidebar (Simplify-style) instead of floating panel
//  - Smarter job page detection (URL-first, score-second)
//  - GitHub README fetching for project-specific answers
//  - Bubble still shows on text fields but opens sidebar
// ═══════════════════════════════════════════════════════════
(function () {
  if (window.__jaLoaded) return;
  window.__jaLoaded = true;

  // ── State ───────────────────────────────────────────────
  let activeField     = null;
  let jobDesc         = null;
  let companyName     = null;
  let detectedRole    = null;
  let aiFilledFields  = new WeakSet();
  let sidebar         = null;
  let bubble          = null;
  let generating      = false;
  let sidebarOpen     = false;
  let bubbleMouseDown = false;
  let appLogged       = false;
  let atsData         = null; // cached ATS result

  const host = location.hostname.replace(/^www\./, '').toLowerCase();

  // ── Blocklist ────────────────────────────────────────────
  const BLOCKED = [
    'google.com','bing.com','yahoo.com','duckduckgo.com',
    'twitter.com','x.com','facebook.com','instagram.com',
    'whatsapp.com','telegram.org','discord.com','slack.com','reddit.com',
    'quora.com','pinterest.com','youtube.com','netflix.com','hotstar.com',
    'spotify.com','twitch.tv','amazon.com','amazon.in','flipkart.com',
    'myntra.com','swiggy.com','zomato.com','medium.com','substack.com',
    'github.com','gitlab.com','stackoverflow.com','npmjs.com','w3schools.com',
    'maps.google.com','gmail.com','outlook.com','drive.google.com',
    'chat.openai.com','chatgpt.com','claude.ai','gemini.google.com',
    'bard.google.com','copilot.microsoft.com','perplexity.ai',
  ];
  if (BLOCKED.some(d => host === d || host.endsWith('.' + d))) return;

  const isGoogleForms = host === 'docs.google.com' && location.pathname.includes('/forms/');
  if (host === 'docs.google.com' && !isGoogleForms) return;

  // ════════════════════════════════════════════════════════
  //  FIX 5/6: SMARTER JOB PAGE DETECTION
  //  URL-first strategy — no waiting for DOM scoring
  // ════════════════════════════════════════════════════════

  // Known ATS / career domains.
  // Two tiers:
  //   PURE_JOB_DOMAINS  — every page is a job page (dedicated job boards, ATS tools)
  //   PATH_GATED        — mixed sites (LinkedIn, Glassdoor) where we must also check the path
  const PURE_JOB_DOMAINS = [
    'indeed.com','naukri.com','internshala.com',
    'monster.com','shine.com','foundit.in','unstop.com','wellfound.com','angel.co',
    'instahyre.com','hirist.com','iimjobs.com','cutshort.io','apna.co',
    'lever.co','greenhouse.io','workday.com','myworkdayjobs.com','icims.com',
    'taleo.net','smartrecruiters.com','ashbyhq.com','breezy.hr','bamboohr.com',
    'jobvite.com','recruitee.com','workable.com','applytojob.com','jazzhr.com',
    'careers.google.com','jobs.apple.com','amazon.jobs','careers.microsoft.com',
    'metacareers.com','jobs.netflix.com','jobs.ycombinator.com','hiring.cafe',
  ];

  // Mixed sites: only activate when path matches job-related patterns
  const PATH_GATED_DOMAINS = {
    'linkedin.com':   ['/jobs/', '/job/', '/apply/'],
    'glassdoor.com':  ['/job-listing/', '/job/', '/apply/'],
    'glassdoor.co.in':['/job-listing/', '/job/', '/apply/'],
    'payu.in':        ['/job', '/career', '/apply', '/position', '/opening'],
    'razorpay.com':   ['/job', '/career', '/apply'],
    'meesho.com':     ['/job', '/career', '/apply'],
    'cred.club':      ['/job', '/career', '/apply'],
    'swiggy.com':     ['/job', '/career', '/apply'],
    'zomato.com':     ['/job', '/career', '/apply'],
  };

  const isPureJobDomain = PURE_JOB_DOMAINS.some(d => host === d || host.endsWith('.' + d));

  const isPathGatedMatch = Object.entries(PATH_GATED_DOMAINS).some(([domain, paths]) => {
    if (host !== domain && !host.endsWith('.' + domain)) return false;
    const p = location.pathname.toLowerCase();
    return paths.some(allowed => p.includes(allowed));
  });

  const isKnownATS = isPureJobDomain || isPathGatedMatch;

  // URL signals — strong indicators without DOM access
  function getUrlScore() {
    const path  = location.pathname.toLowerCase();
    const href  = location.href.toLowerCase();
    let score   = 0;

    // Subdomain signals (very strong)
    const careerSubs = ['jobs.', 'careers.', 'career.', 'hiring.', 'recruit.', 'apply.', 'talent.', 'work.'];
    if (careerSubs.some(s => host.startsWith(s))) score += 4;

    // Path signals (strong)
    const careerPaths = [
      '/apply', '/application', '/careers/', '/career/', '/jobs/', '/job/',
      '/vacancy/', '/opening/', '/internship/', '/recruitment/', '/hiring/',
      '/viewform', '/work-with-us', '/join-us', '/join/', '/positions/',
    ];
    if (careerPaths.some(p => path.includes(p))) score += 3;

    // Query param signals (strong — ATS systems)
    const atsParams = [
      'gh_jid=', 'jobid=', 'job_id=', 'jobcode=', 'positionid=',
      'requisitionid=', 'openingid=', 'lever-origin=', 'refsource=', 'from=email',
    ];
    if (atsParams.some(p => href.includes(p))) score += 3;

    return score;
  }

  function shouldActivate() {
    if (isGoogleForms) return true;
    if (isKnownATS)    return true;
    if (getUrlScore() >= 3) return true;
    return false;
  }

  // ── Boot ─────────────────────────────────────────────────
  function boot() {
    if (shouldActivate()) {
      // Immediate activation — no waiting
      activateNow();
    } else {
      // Fallback: check DOM after load for edge cases
      let checked = false;
      function domCheck() {
        if (checked) return;
        if (getDomScore() >= 2) { checked = true; activateNow(); }
      }
      [200, 800, 2000, 4000].forEach(d => setTimeout(domCheck, d));
      const obs = new MutationObserver(() => { domCheck(); if (checked) obs.disconnect(); });
      if (document.body) obs.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => obs.disconnect(), 10000);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  // DOM-based scoring (fallback only)
  function getDomScore() {
    let score = 0;
    const title = document.title.toLowerCase();
    const TITLE_KW = ['apply','application','job','career','vacancy','internship','hiring','position'];
    if (TITLE_KW.some(k => title.includes(k))) score += 1;

    const ATS_SELS = [
      '#application', '.application-form',
      '[data-automation-id="applicationPage"]',
      '[data-automation-id="job-posting-details"]',
      '.posting-apply', 'form[action*="apply"]',
      '[class*="apply-form"]', '[class*="job-application"]',
      '.freebirdFormviewerViewHeaderTitle',
    ];
    if (ATS_SELS.some(s => { try { return !!document.querySelector(s); } catch { return false; } })) score += 2;

    const JD_SELS = [
      '[class*="job-description"]', '[class*="jobDescription"]',
      '[class*="description__text"]', '.jobsearch-jobDescriptionText',
      '.posting-description', '[class*="job-details"]',
    ];
    if (JD_SELS.some(s => {
      try { const el = document.querySelector(s); return el && el.innerText.length > 100; }
      catch { return false; }
    })) score += 1;

    return score;
  }

  // ══════════════════════════════════════════════════════════
  //  ACTIVATE
  // ══════════════════════════════════════════════════════════
  function activateNow() {
    chrome.storage.local.get(['autoJd', 'autoFill'], d => {
      buildBubble();
      buildSidebar();
      buildTrackerDialog();

      document.addEventListener('focusin',  onFocusIn,  true);
      document.addEventListener('focusout', onFocusOut, true);
      document.addEventListener('mouseup',  onMouseUp,  true);

      // Auto-scan for JD
      if (d.autoJd !== false) {
        scanForJobDesc();
        // Watch for SPA navigation / lazy-loaded JDs
        const jdObs = new MutationObserver(() => {
          if (!jobDesc) scanForJobDesc();
        });
        if (document.body) jdObs.observe(document.body, { childList: true, subtree: true });
      }

      // Auto-fill standard fields
      if (d.autoFill) autoFillAllStandardFields();

      // Show sidebar immediately if on a job page with a JD
      setTimeout(() => {
        if (jobDesc) {
          showSidebarWithJobData();
        } else {
          // Try after JD scan has had time
          setTimeout(() => {
            if (jobDesc) showSidebarWithJobData();
          }, 2000);
        }
      }, 800);
    });
  }

  // ══════════════════════════════════════════════════════════
  //  FIELD DETECTION (unchanged logic, works well)
  // ══════════════════════════════════════════════════════════
  function onFocusIn(e) {
    const el = e.target;
    if (!isApplicationField(el)) return;
    activeField = el;
    showBubble(el, aiFilledFields.has(el));
  }
  function onFocusOut() {
    setTimeout(() => {
      if (sidebarOpen || bubbleMouseDown) return;
      const f = document.activeElement;
      if (bubble?.contains(f) || sidebar?.contains(f)) return;
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
      return (tag === 'TEXTAREA') || (tag === 'INPUT' && el.type === 'text');
    }
    if (tag === 'TEXTAREA') return el.getBoundingClientRect().height > 28;
    if (el.getAttribute?.('contenteditable') === 'true') {
      const r = el.getBoundingClientRect();
      return r.height > 50 && r.width > 150;
    }
    if (tag === 'INPUT' && (el.type||'text') === 'text') {
      const combined = [el.name, el.id, el.placeholder, el.getAttribute('aria-label')]
        .filter(Boolean).join(' ').toLowerCase();
      const SKIP = ['search','query','email','mobile','tel','zip','postal','first','last',
        'user','pass','url','website','linkedin','github','city','state','country',
        'address','ctc','salary','notice','code','date','birth','referral','pincode'];
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
  //  BUBBLE (small trigger above focused field)
  // ══════════════════════════════════════════════════════════
  function buildBubble() {
    bubble = document.createElement('div');
    bubble.id = 'ja-bubble';
    bubble.innerHTML = `<span class="ja-bubble-label">✦ Answer with AI</span>`;
    bubble.addEventListener('mouseenter', () => { bubbleMouseDown = false; });
    bubble.addEventListener('mousedown',  e => { e.preventDefault(); e.stopPropagation(); bubbleMouseDown = true; });
    bubble.addEventListener('mouseup',    e => {
      e.preventDefault(); e.stopPropagation();
      if (bubbleMouseDown) { bubbleMouseDown = false; openSidebar(); }
    });
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
    // Don't overlap sidebar
    const sbWidth = 300;
    if (left + 185 > window.innerWidth - sbWidth - 10) left = window.innerWidth - sbWidth - 195;
    if (top  < 4)  top  = rect.bottom + 4;
    bubble.style.position = 'fixed';
    bubble.style.top      = top  + 'px';
    bubble.style.left     = left + 'px';
  }

  // ══════════════════════════════════════════════════════════
  //  FIX 7/8: FIXED RIGHT SIDEBAR (Simplify-style)
  //  300px wide, fixed to right edge, full height
  // ══════════════════════════════════════════════════════════
  function buildSidebar() {
    sidebar = document.createElement('div');
    sidebar.id = 'ja-sidebar';
    sidebar.innerHTML = `
      <!-- Header -->
      <div id="ja-sb-header">
        <div id="ja-sb-logo">
          <div id="ja-sb-mark">JA</div>
          <span id="ja-sb-title">JobAssist <em>AI</em></span>
        </div>
        <div id="ja-sb-header-actions">
          <button id="ja-sb-refresh" title="Refresh ATS score" type="button">↻</button>
          <button id="ja-sb-minimize" title="Minimize" type="button">‹</button>
        </div>
      </div>

      <!-- Job info bar -->
      <div id="ja-sb-jobbar" class="ja-hidden">
        <div id="ja-sb-role"></div>
        <div id="ja-sb-company-tag"></div>
      </div>

      <!-- Tab nav -->
      <div id="ja-sb-tabs">
        <button class="ja-sb-tab active" data-tab="answer">Answer</button>
        <button class="ja-sb-tab" data-tab="score">ATS Score</button>
        <button class="ja-sb-tab" data-tab="jd">Job Info</button>
        <button class="ja-sb-tab" data-tab="tailor">Tailor</button>
      </div>

      <!-- ── TAB: Answer ── -->
      <div class="ja-sb-pane active" id="ja-sb-pane-answer">
        <div class="ja-sb-field">
          <label class="ja-sb-label">Question</label>
          <textarea id="ja-sb-question" rows="3" placeholder="Paste question or click a field to auto-fill…"></textarea>
        </div>
        <div class="ja-sb-field">
          <label class="ja-sb-label">Custom instruction <span class="ja-sb-opt">optional</span></label>
          <textarea id="ja-sb-custom" rows="2" placeholder='e.g. "Focus on my n8n project"'></textarea>
        </div>
        <!-- GitHub README toggle for project questions -->
        <div id="ja-sb-readme-row" class="ja-hidden">
          <label class="ja-sb-label">📂 Fetch project README</label>
          <div class="ja-sb-row">
            <select id="ja-sb-repo-select" class="ja-sb-select">
              <option value="">Select repo…</option>
            </select>
            <button id="ja-sb-fetch-readme" class="ja-sb-btn-sm" type="button">Load</button>
          </div>
          <div id="ja-sb-readme-status" class="ja-hidden"></div>
        </div>

        <button id="ja-sb-gen-btn" type="button">✦ Generate &amp; fill</button>

        <div id="ja-sb-status" class="ja-hidden"></div>

        <div id="ja-sb-result" class="ja-hidden">
          <label class="ja-sb-label">Your answer <span class="ja-sb-opt">editable</span></label>
          <div id="ja-sb-answer" contenteditable="true"></div>
          <div class="ja-sb-actions">
            <button id="ja-sb-insert" type="button" class="ja-sb-btn-primary">Insert</button>
            <button id="ja-sb-regen"  type="button" class="ja-sb-btn-ghost">Redo</button>
            <button id="ja-sb-copy"   type="button" class="ja-sb-btn-ghost">Copy</button>
          </div>
        </div>
      </div>

      <!-- ── TAB: ATS Score ── -->
      <div class="ja-sb-pane" id="ja-sb-pane-score">
        <div id="ja-sb-ats-loading" class="ja-sb-loading-row ja-hidden">
          <div class="ja-sb-spinner"></div><span>Analyzing resume vs JD…</span>
        </div>
        <div id="ja-sb-ats-empty">
          <p class="ja-sb-muted">Paste the job description in the Job Info tab first, then come back here.</p>
          <button id="ja-sb-run-ats" class="ja-sb-btn-primary" type="button" style="margin-top:10px;width:100%">Analyze now</button>
        </div>
        <div id="ja-sb-ats-result" class="ja-hidden">
          <!-- Score ring -->
          <div id="ja-sb-score-ring-wrap">
            <svg id="ja-sb-score-svg" viewBox="0 0 80 80" width="80" height="80">
              <circle cx="40" cy="40" r="34" fill="none" stroke="#E5E7EB" stroke-width="7"/>
              <circle id="ja-sb-score-arc" cx="40" cy="40" r="34" fill="none"
                stroke="#4F46E5" stroke-width="7" stroke-linecap="round"
                stroke-dasharray="213.6" stroke-dashoffset="213.6"
                transform="rotate(-90 40 40)"/>
            </svg>
            <div id="ja-sb-score-num">0%</div>
          </div>
          <div id="ja-sb-score-label">Calculating…</div>
          <div id="ja-sb-ats-tip"></div>
          <div id="ja-sb-kw-matched">
            <p class="ja-sb-kw-title">Matched</p>
            <div class="ja-sb-chips" id="ja-sb-matched-chips"></div>
          </div>
          <div id="ja-sb-kw-missing">
            <p class="ja-sb-kw-title missing">Missing</p>
            <div class="ja-sb-chips" id="ja-sb-missing-chips"></div>
          </div>
          <button id="ja-sb-rerun-ats" class="ja-sb-btn-ghost" type="button" style="width:100%;margin-top:8px">Re-analyze</button>
        </div>
      </div>

      <!-- ── TAB: Job Info ── -->
      <div class="ja-sb-pane" id="ja-sb-pane-jd">
        <div class="ja-sb-field">
          <label class="ja-sb-label">Role detected</label>
          <input type="text" id="ja-sb-jd-role" class="ja-sb-input" placeholder="e.g. Software Engineer" />
        </div>
        <div class="ja-sb-field">
          <label class="ja-sb-label">Company detected</label>
          <input type="text" id="ja-sb-jd-company" class="ja-sb-input" placeholder="e.g. Google" />
        </div>
        <div class="ja-sb-field">
          <label class="ja-sb-label">Job description</label>
          <textarea id="ja-sb-jd" rows="8" placeholder="Auto-detected from the page, or paste here…"></textarea>
        </div>
        <div class="ja-sb-row">
          <input type="url" id="ja-sb-jd-link" class="ja-sb-input" placeholder="Or paste JD URL…" />
          <button id="ja-sb-jd-fetch" class="ja-sb-btn-sm" type="button">Fetch</button>
        </div>
        <div id="ja-sb-jd-fetch-status" class="ja-hidden"></div>
        <button id="ja-sb-jd-save" class="ja-sb-btn-primary" type="button" style="width:100%;margin-top:8px">Save &amp; analyze</button>
      </div>

      <!-- ── TAB: Tailor Resume ── -->
      <div class="ja-sb-pane" id="ja-sb-pane-tailor">
        <p class="ja-sb-muted">Rewrite your resume to match this job's keywords and ATS requirements.</p>
        <div class="ja-sb-field">
          <label class="ja-sb-label">Style instructions <span class="ja-sb-opt">optional</span></label>
          <textarea id="ja-sb-tailor-style" rows="2" placeholder='e.g. "Keep to 1 page, use bullet points"'></textarea>
        </div>
        <button id="ja-sb-tailor-btn" type="button" class="ja-sb-btn-primary">✦ Tailor my resume</button>
        <div id="ja-sb-tailor-loading" class="ja-sb-loading-row ja-hidden">
          <div class="ja-sb-spinner"></div><span>Tailoring resume…</span>
        </div>
        <div id="ja-sb-tailor-result" class="ja-hidden">
          <!-- ATS bar -->
          <div id="ja-sb-tailor-ats-bar">
            <span class="ja-sb-tailor-ats-label">ATS score</span>
            <div class="ja-sb-tailor-track"><div id="ja-sb-tailor-fill"></div></div>
            <span id="ja-sb-tailor-score-num">—</span>
          </div>
          <!-- Keyword chips -->
          <div class="ja-sb-field" style="gap:4px">
            <p class="ja-sb-kw-title">Matched</p>
            <div class="ja-sb-chips" id="ja-sb-tailor-matched"></div>
            <p class="ja-sb-kw-title missing">Missing</p>
            <div class="ja-sb-chips" id="ja-sb-tailor-missing"></div>
          </div>
          <!-- Inline edit -->
          <div class="ja-sb-field">
            <label class="ja-sb-label">Edit in plain English</label>
            <div class="ja-sb-row">
              <input type="text" id="ja-sb-tailor-edit" class="ja-sb-input" placeholder='e.g. "Add more on my Python work"' />
              <button id="ja-sb-tailor-apply" class="ja-sb-btn-sm" type="button">Apply</button>
            </div>
          </div>
          <button id="ja-sb-tailor-pdf" type="button" class="ja-sb-btn-primary">Download PDF</button>
        </div>
        <div id="ja-sb-tailor-msg" class="ja-hidden"></div>
      </div>

      <!-- Toggle tab (collapsed state) -->
      <div id="ja-sb-toggle-tab" title="Open JobAssist AI">
        <div id="ja-sb-toggle-mark">JA</div>
        <span id="ja-sb-toggle-label">JobAssist AI</span>
      </div>
    `;
    document.body.appendChild(sidebar);

    // Wire up events
    sidebar.querySelectorAll('.ja-sb-tab').forEach(tab => {
      tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });

    sidebar.querySelector('#ja-sb-minimize').addEventListener('click', minimizeSidebar);
    sidebar.querySelector('#ja-sb-toggle-tab').addEventListener('click', openSidebar);
    sidebar.querySelector('#ja-sb-gen-btn').addEventListener('click', runGenerate);
    sidebar.querySelector('#ja-sb-regen').addEventListener('click', runGenerate);
    sidebar.querySelector('#ja-sb-insert').addEventListener('click', insertAnswer);
    sidebar.querySelector('#ja-sb-copy').addEventListener('click', copyAnswer);
    sidebar.querySelector('#ja-sb-run-ats').addEventListener('click', runAts);
    sidebar.querySelector('#ja-sb-rerun-ats').addEventListener('click', runAts);
    sidebar.querySelector('#ja-sb-refresh').addEventListener('click', () => {
      if (jobDesc) runAts();
    });
    sidebar.querySelector('#ja-sb-jd-save').addEventListener('click', saveJdAndAnalyze);
    sidebar.querySelector('#ja-sb-jd-fetch').addEventListener('click', fetchJdUrl);
    sidebar.querySelector('#ja-sb-fetch-readme').addEventListener('click', fetchReadme);
    sidebar.querySelector('#ja-sb-tailor-btn').addEventListener('click', runTailorResume);
    sidebar.querySelector('#ja-sb-tailor-pdf').addEventListener('click', runGeneratePdf);
    sidebar.querySelector('#ja-sb-tailor-apply').addEventListener('click', runEditResume);

    // Question field → show README row if mentions a project
    sidebar.querySelector('#ja-sb-question').addEventListener('input', onQuestionInput);

    // Populate repo select from githubData
    chrome.storage.local.get(['githubData', 'githubUrl'], d => {
      if (d.githubData?.repos?.length) {
        populateRepoSelect(d.githubData, d.githubUrl);
      }
    });

    // Start minimized; will auto-open if JD detected
    minimizeSidebar(true);
  }

  function switchTab(tab) {
    sidebar.querySelectorAll('.ja-sb-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    sidebar.querySelectorAll('.ja-sb-pane').forEach(p => p.classList.toggle('active', p.id === `ja-sb-pane-${tab}`));
  }

  function openSidebar() {
    if (!sidebar) return;
    sidebar.classList.remove('ja-minimized');
    sidebar.classList.add('ja-open');
    sidebarOpen = true;
    hideBubble();
    // Pre-fill question from active field
    if (activeField) {
      const label = getLabel(activeField);
      const qEl = sidebar.querySelector('#ja-sb-question');
      if (label && label.length > 3 && label.length < 500 && !qEl.value.trim()) {
        qEl.value = label;
        onQuestionInput();
      }
    }
  }

  function minimizeSidebar(immediate = false) {
    if (!sidebar) return;
    sidebar.classList.add('ja-minimized');
    sidebar.classList.remove('ja-open');
    sidebarOpen = false;
  }

  // Show sidebar populated with job data (called on detection)
  function showSidebarWithJobData() {
    if (!sidebar) return;
    // Fill Job Info tab
    if (jobDesc) sidebar.querySelector('#ja-sb-jd').value = jobDesc.slice(0, 8000);
    if (detectedRole) {
      sidebar.querySelector('#ja-sb-jd-role').value = detectedRole;
      sidebar.querySelector('#ja-sb-jobbar').classList.remove('ja-hidden');
      sidebar.querySelector('#ja-sb-role').textContent = detectedRole;
    }
    if (companyName) {
      sidebar.querySelector('#ja-sb-jd-company').value = companyName;
      sidebar.querySelector('#ja-sb-company-tag').textContent = companyName;
    }
    // Auto-open sidebar
    openSidebar();
    // Run ATS in background
    if (jobDesc) setTimeout(runAts, 500);
  }

  // ── Question input → detect project mention → show README row ──
  function onQuestionInput() {
    const q = sidebar.querySelector('#ja-sb-question').value.toLowerCase();
    const projectWords = ['project', 'repo', 'github', 'built', 'developed', 'created', 'describe your'];
    const showReadme = projectWords.some(w => q.includes(w));
    sidebar.querySelector('#ja-sb-readme-row').classList.toggle('ja-hidden', !showReadme);
  }

  // ── Repo select population ──
  function populateRepoSelect(githubData, githubUrl) {
    const select = sidebar.querySelector('#ja-sb-repo-select');
    if (!select) return;
    select.innerHTML = '<option value="">Select repo…</option>';
    let handle = '';
    try { handle = new URL(githubUrl || githubData.htmlUrl || '').pathname.split('/').filter(Boolean)[0]; } catch {}

    (githubData.repos || []).forEach(r => {
      const opt = document.createElement('option');
      opt.value = `${handle}|${r.name}`;
      opt.textContent = `${r.name}${r.language ? ' · ' + r.language : ''}`;
      select.appendChild(opt);
    });
  }

  // ── Fetch README for selected repo ──
  async function fetchReadme() {
    const select = sidebar.querySelector('#ja-sb-repo-select');
    const val = select.value;
    if (!val) return;
    const [owner, repo] = val.split('|');
    const statusEl = sidebar.querySelector('#ja-sb-readme-status');
    statusEl.textContent = '⏳ Fetching README…';
    statusEl.className = 'ja-sb-fetch-status loading';
    statusEl.classList.remove('ja-hidden');
    sidebar.querySelector('#ja-sb-fetch-readme').disabled = true;

    const res = await chrome.runtime.sendMessage({ type: 'FETCH_GITHUB_README', owner, repo });
    sidebar.querySelector('#ja-sb-fetch-readme').disabled = false;
    if (res.error) {
      statusEl.textContent = `⚠ ${res.error}`;
      statusEl.className = 'ja-sb-fetch-status error';
    } else {
      // Store readme in a data attribute on the button for use in generate
      sidebar.querySelector('#ja-sb-fetch-readme').dataset.readme = res.readme;
      sidebar.querySelector('#ja-sb-fetch-readme').dataset.repo   = repo;
      statusEl.textContent = `✓ Loaded README for ${repo} (${res.readme.length} chars)`;
      statusEl.className = 'ja-sb-fetch-status ok';
    }
  }

  // ── Fetch JD from URL ──
  async function fetchJdUrl() {
    const url = sidebar.querySelector('#ja-sb-jd-link').value.trim();
    if (!url) return;
    const statusEl = sidebar.querySelector('#ja-sb-jd-fetch-status');
    statusEl.textContent = '⏳ Fetching…';
    statusEl.className = 'ja-sb-fetch-status loading';
    statusEl.classList.remove('ja-hidden');
    sidebar.querySelector('#ja-sb-jd-fetch').disabled = true;

    const res = await chrome.runtime.sendMessage({ type: 'FETCH_URL', url });
    sidebar.querySelector('#ja-sb-jd-fetch').disabled = false;
    if (res.error) {
      statusEl.textContent = `⚠ ${res.error}`;
      statusEl.className = 'ja-sb-fetch-status error';
    } else {
      sidebar.querySelector('#ja-sb-jd').value = res.text;
      jobDesc = res.text;
      statusEl.textContent = `✓ Loaded ${res.text.length} chars`;
      statusEl.className = 'ja-sb-fetch-status ok';
    }
  }

  // ── Save JD and run ATS ──
  async function saveJdAndAnalyze() {
    const jd      = sidebar.querySelector('#ja-sb-jd').value.trim();
    const role    = sidebar.querySelector('#ja-sb-jd-role').value.trim();
    const company = sidebar.querySelector('#ja-sb-jd-company').value.trim();
    if (jd) {
      jobDesc = jd;
      if (role)    { detectedRole = role; }
      if (company) { companyName  = company; }
      // Update job bar
      if (role || company) {
        sidebar.querySelector('#ja-sb-jobbar').classList.remove('ja-hidden');
        if (role)    sidebar.querySelector('#ja-sb-role').textContent = role;
        if (company) sidebar.querySelector('#ja-sb-company-tag').textContent = company;
      }
      switchTab('score');
      runAts();
    }
  }

  // ══════════════════════════════════════════════════════════
  //  GENERATE ANSWER
  // ══════════════════════════════════════════════════════════
  async function runGenerate() {
    if (generating) return;
    const question = sidebar.querySelector('#ja-sb-question').value.trim();
    if (!question) { showStatus('⚠ Paste the question first.', 'err'); return; }

    generating = true;
    sidebar.querySelector('#ja-sb-result').classList.add('ja-hidden');
    sidebar.querySelector('#ja-sb-gen-btn').disabled = true;
    showStatus('Writing your answer…', 'loading');

    // Get README context if loaded
    const readmeBtn = sidebar.querySelector('#ja-sb-fetch-readme');
    const readmeContext = readmeBtn?.dataset.readme || null;

    const res = await chrome.runtime.sendMessage({
      type:          'GENERATE_ANSWER',
      question,
      jobDescription: sidebar.querySelector('#ja-sb-jd').value.trim() || jobDesc,
      fieldHint:      activeField ? getLabel(activeField) : '',
      companyName,
      customPrompt:   sidebar.querySelector('#ja-sb-custom').value.trim(),
      readmeContext,
    });

    generating = false;
    sidebar.querySelector('#ja-sb-gen-btn').disabled = false;
    sidebar.querySelector('#ja-sb-status').classList.add('ja-hidden');

    if (res.error) { showStatus('⚠ ' + res.error, 'err'); return; }
    sidebar.querySelector('#ja-sb-answer').textContent = res.answer;
    sidebar.querySelector('#ja-sb-result').classList.remove('ja-hidden');
  }

  function showStatus(msg, type) {
    const el = sidebar.querySelector('#ja-sb-status');
    el.textContent = msg;
    el.className = type === 'err' ? 'ja-sb-status err' : 'ja-sb-status loading';
    el.classList.remove('ja-hidden');
  }

  function insertAnswer() {
    const text = sidebar.querySelector('#ja-sb-answer').textContent.trim();
    if (!text || !activeField) return;
    setValue(activeField, text);
    aiFilledFields.add(activeField);
    // Flash confirmation
    const btn = sidebar.querySelector('#ja-sb-insert');
    const orig = btn.textContent;
    btn.textContent = 'Inserted ✓';
    setTimeout(() => btn.textContent = orig, 1800);
    setTimeout(() => activeField?.focus(), 50);
  }

  function copyAnswer() {
    navigator.clipboard.writeText(sidebar.querySelector('#ja-sb-answer').textContent.trim())
      .then(() => {
        const btn = sidebar.querySelector('#ja-sb-copy');
        const o = btn.textContent; btn.textContent = 'Copied ✓';
        setTimeout(() => btn.textContent = o, 1800);
      });
  }

  // ══════════════════════════════════════════════════════════
  //  TAILOR RESUME (sidebar tab)
  // ══════════════════════════════════════════════════════════
  async function runTailorResume() {
    const jd = sidebar.querySelector('#ja-sb-jd').value.trim() || jobDesc;
    if (!jd) {
      switchTab('jd');
      showTailorMsg('⚠ Paste the job description in the Job Info tab first.', true);
      return;
    }
    const loadEl   = sidebar.querySelector('#ja-sb-tailor-loading');
    const resultEl = sidebar.querySelector('#ja-sb-tailor-result');
    const btn      = sidebar.querySelector('#ja-sb-tailor-btn');
    loadEl.classList.remove('ja-hidden');
    resultEl.classList.add('ja-hidden');
    btn.disabled = true;

    const res = await chrome.runtime.sendMessage({
      type:  'TAILOR_RESUME',
      jd,
      style: sidebar.querySelector('#ja-sb-tailor-style').value.trim(),
    });

    loadEl.classList.add('ja-hidden');
    btn.disabled = false;

    if (res.error) { showTailorMsg('⚠ ' + res.error, true); return; }

    // Store tailored text (same key as popup uses)
    await chrome.storage.local.set({ tailoredResumeText: res.tailoredResume });

    // ATS bar
    const score = res.atsScore || 0;
    sidebar.querySelector('#ja-sb-tailor-score-num').textContent = `${score}%`;
    const fill = sidebar.querySelector('#ja-sb-tailor-fill');
    fill.style.width      = `${score}%`;
    fill.style.background = score >= 70 ? '#16A34A' : score >= 40 ? '#D97706' : '#DC2626';

    // Chips
    renderChips('#ja-sb-tailor-matched', res.matchedKeywords || [], false);
    renderChips('#ja-sb-tailor-missing', res.missingKeywords || [], true);

    resultEl.classList.remove('ja-hidden');
    showTailorMsg(`✓ Resume tailored (ATS ${score}%)`, false);
  }

  async function runEditResume() {
    const prompt = sidebar.querySelector('#ja-sb-tailor-edit').value.trim();
    if (!prompt) return;
    const btn = sidebar.querySelector('#ja-sb-tailor-apply');
    btn.disabled = true; btn.textContent = '…';
    const res = await chrome.runtime.sendMessage({ type: 'EDIT_RESUME', editPrompt: prompt });
    btn.disabled = false; btn.textContent = 'Apply';
    if (res.error) { showTailorMsg('⚠ ' + res.error, true); return; }
    await chrome.storage.local.set({ tailoredResumeText: res.tailoredResume });
    sidebar.querySelector('#ja-sb-tailor-edit').value = '';
    showTailorMsg('✓ Resume updated', false);
  }

  async function runGeneratePdf() {
    const res = await chrome.runtime.sendMessage({ type: 'GENERATE_PDF' });
    if (res.error) showTailorMsg('⚠ ' + res.error, true);
  }

  function showTailorMsg(msg, isErr) {
    const el = sidebar.querySelector('#ja-sb-tailor-msg');
    el.textContent = msg;
    el.className = isErr ? 'ja-sb-status err' : 'ja-sb-status loading';
    el.classList.remove('ja-hidden');
    if (!isErr) setTimeout(() => el.classList.add('ja-hidden'), 3000);
  }

  // ══════════════════════════════════════════════════════════
  //  ATS SCORE
  // ══════════════════════════════════════════════════════════
  async function runAts() {
    const jd = sidebar.querySelector('#ja-sb-jd').value.trim() || jobDesc;
    if (!jd) {
      switchTab('jd');
      return;
    }

    const loadEl   = sidebar.querySelector('#ja-sb-ats-loading');
    const emptyEl  = sidebar.querySelector('#ja-sb-ats-empty');
    const resultEl = sidebar.querySelector('#ja-sb-ats-result');

    loadEl.classList.remove('ja-hidden');
    emptyEl.classList.add('ja-hidden');
    resultEl.classList.add('ja-hidden');

    const res = await chrome.runtime.sendMessage({ type: 'RUN_ATS', jd });
    loadEl.classList.add('ja-hidden');

    if (res.error) {
      emptyEl.classList.remove('ja-hidden');
      emptyEl.querySelector('#ja-sb-run-ats') && (emptyEl.innerHTML =
        `<p class="ja-sb-muted" style="color:#DC2626">⚠ ${res.error}</p>
         <button id="ja-sb-run-ats" class="ja-sb-btn-primary" type="button" style="margin-top:10px;width:100%">Try again</button>`);
      emptyEl.querySelector('#ja-sb-run-ats')?.addEventListener('click', runAts);
      return;
    }

    atsData = res;
    const score = res.score || 0;

    // Animate ring
    const circumference = 213.6;
    const offset = circumference - (score / 100) * circumference;
    const arc = sidebar.querySelector('#ja-sb-score-arc');
    arc.style.strokeDashoffset = offset;
    arc.style.stroke = score >= 70 ? '#16A34A' : score >= 40 ? '#D97706' : '#DC2626';

    sidebar.querySelector('#ja-sb-score-num').textContent = `${score}%`;
    sidebar.querySelector('#ja-sb-score-label').textContent =
      score >= 70 ? 'Strong match ✓' : score >= 40 ? 'Moderate match' : 'Low match';
    sidebar.querySelector('#ja-sb-score-label').style.color =
      score >= 70 ? '#16A34A' : score >= 40 ? '#D97706' : '#DC2626';

    if (res.tip) {
      sidebar.querySelector('#ja-sb-ats-tip').textContent = '💡 ' + res.tip;
      sidebar.querySelector('#ja-sb-ats-tip').classList.remove('ja-hidden');
    }

    renderChips('#ja-sb-matched-chips', res.matched || [], false);
    renderChips('#ja-sb-missing-chips', res.missing || [], true);

    resultEl.classList.remove('ja-hidden');
    switchTab('score');
  }

  function renderChips(selector, words, isMissing) {
    const el = sidebar.querySelector(selector);
    if (!el) return;
    el.innerHTML = '';
    if (!words.length) {
      el.innerHTML = '<span class="ja-sb-muted">None</span>';
      return;
    }
    words.forEach(w => {
      const chip = document.createElement('span');
      chip.className = `ja-sb-chip${isMissing ? ' miss' : ''}`;
      chip.textContent = w;
      el.appendChild(chip);
    });
  }

  // ══════════════════════════════════════════════════════════
  //  APPLICATION TRACKER DIALOG (unchanged logic, restyled)
  // ══════════════════════════════════════════════════════════
  let trackerEl = null;
  function buildTrackerDialog() {
    const d = document.createElement('div');
    d.id = 'ja-tracker';
    d.innerHTML = `
      <div id="ja-tracker-inner">
        <div id="ja-tracker-header">
          <span>📋 Log this application</span>
          <button id="ja-tracker-close" type="button">✕</button>
        </div>
        <p id="ja-tracker-sub">Detected a job page — save it to your tracker.</p>
        <div class="ja-tfield">
          <label>Company</label>
          <input type="text" id="ja-t-company" placeholder="e.g. PayU" />
        </div>
        <div class="ja-tfield">
          <label>Role / Position</label>
          <input type="text" id="ja-t-role" placeholder="e.g. Business Solutions Manager" />
        </div>
        <div id="ja-tracker-actions">
          <button id="ja-tracker-save" type="button">Save</button>
          <button id="ja-tracker-skip" type="button">Skip</button>
        </div>
      </div>
    `;
    document.body.appendChild(d);
    d.classList.add('ja-hidden');
    d.querySelector('#ja-tracker-close').onclick = () => d.classList.add('ja-hidden');
    d.querySelector('#ja-tracker-skip').onclick  = () => d.classList.add('ja-hidden');
    d.querySelector('#ja-tracker-save').onclick  = saveApplication;
    trackerEl = d;

    // Auto-show tracker after short delay if we activated
    setTimeout(() => {
      if (!appLogged) {
        const { company, role } = detectCompanyAndRole();
        if (company) {
          document.getElementById('ja-t-company').value = company;
          if (role) document.getElementById('ja-t-role').value = role;
          d.classList.remove('ja-hidden');
          setTimeout(() => d.classList.add('ja-hidden'), 12000);
        }
      }
    }, 3000);
  }

  function detectCompanyAndRole() {
    const ogSite    = document.querySelector('meta[property="og:site_name"]')?.content?.trim();
    const ogTitle   = document.querySelector('meta[property="og:title"]')?.content?.trim();
    const h1Text    = document.querySelector('h1')?.innerText?.trim();
    const pageTitle = document.title.trim();
    let company = ogSite || '';
    let role    = '';

    // Prefer h1 as role — it's almost always the job title on ATS pages
    if (h1Text && h1Text.length > 3 && h1Text.length < 150) {
      role = h1Text;
    }

    // Parse page title for company name using common ATS separators
    // Patterns: "Role - Company | Careers", "Company: Role", "Role at Company"
    // Split on " | ", " - ", " – ", " — " and pick segments
    const sep    = /\s*[\|\–\—]\s*/;
    const parts  = pageTitle.split(sep).map(s => s.trim()).filter(Boolean);

    if (parts.length >= 2) {
      // Last segment is often site name / company ("PayU", "Greenhouse", "Lever")
      // Middle segments are role or "Careers at Company"
      const last = parts[parts.length - 1];
      const first = parts[0];

      // If we don't have a role yet, first segment is usually the role
      if (!role && first.length < 120 && !/^careers?$/i.test(first)) {
        role = first;
      }

      // Company: prefer og:site_name, else last segment if it looks like a company name
      if (!company && last.length < 80 && !/^careers?|jobs?|apply|hiring$/i.test(last)) {
        company = last;
      }
      // Also check "Careers at Company" pattern in second segment
      if (!company && parts[1]) {
        const atMatch = parts[1].match(/^(?:careers?\s+at|jobs?\s+at|hiring\s+at)\s+(.+)$/i);
        if (atMatch) company = atMatch[1].trim();
      }
    }

    // Fallback: parse "Role - Company" with a dash (only if no h1 role found)
    if (!role || !company) {
      const dashMatch = pageTitle.match(/^(.+?)\s*[-–—]\s*(.+?)(?:\s*[-–—].*)?$/);
      if (dashMatch) {
        if (!role)    role    = dashMatch[1].trim();
        if (!company) company = dashMatch[2].trim().replace(/\s*(careers?|jobs?|hiring).*$/i, '').trim();
      }
    }

    // og:title fallback for role
    if (!role && ogTitle && ogTitle.length < 150) {
      role = ogTitle.replace(/\s*[-–|].*$/, '').trim();
    }

    // Hostname fallback for company
    if (!company) {
      company = host
        .replace(/^(jobs|careers|career|hiring|recruit|apply|talent)\./i, '')
        .split('.')[0]
        .replace(/-/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase());
    }

    // Clean up trailing/leading noise
    role    = role.replace(/\s*\(.*?\)\s*$/, '').trim();   // strip "(Remote)" etc from role
    company = company.replace(/\s*(Inc\.|Ltd\.|Pvt\.?|LLC|Corp\.?)$/i, '').trim();

    companyName  = company;
    detectedRole = role;
    return { company, role };
  }

  async function saveApplication() {
    const company = document.getElementById('ja-t-company')?.value.trim();
    const role    = document.getElementById('ja-t-role')?.value.trim();
    const btn     = document.getElementById('ja-tracker-save');
    if (btn) { btn.textContent = 'Saving…'; btn.disabled = true; }

    await chrome.runtime.sendMessage({
      type: 'LOG_APPLICATION',
      company, role,
      url:  location.href,
      jd:   jobDesc || '',
      date: new Date().toISOString(),
    });
    chrome.storage.local.get(['companies'], d => {
      const c = d.companies || {};
      if (company && !c[company]) { c[company] = ''; chrome.storage.local.set({ companies: c }); }
    });

    appLogged = true;
    if (trackerEl) trackerEl.classList.add('ja-hidden');
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
    if (/\bfirst.?name\b/.test(c))                               return p.firstName;
    if (/\blast.?name\b|surname/.test(c))                        return p.lastName;
    if (/\bfull.?name\b/.test(c))                                return [p.firstName,p.lastName].filter(Boolean).join(' ');
    if (/\bemail\b/.test(c))                                     return p.email;
    if (/\bphone\b|\bmobile\b|\bcontact.?no\b/.test(c))         return p.phone;
    if (/dob|date.?of.?birth|birth.?date/.test(c))              return p.dob;
    if (/\bcity\b/.test(c))                                      return p.city;
    if (/\bstate\b|\bprovince\b/.test(c))                        return p.state;
    if (/\bcountry\b/.test(c))                                   return p.country;
    if (/\bzip\b|\bpincode\b|\bpostal\b/.test(c))               return p.zipcode;
    if (/\blinkedin\b/.test(c))                                  return p.linkedinUrl;
    if (/\bgithub\b/.test(c))                                    return p.githubUrl;
    if (/\bportfolio\b|\bwebsite\b|\bpersonal.?site\b/.test(c)) return p.portfolioUrl;
    if (/current.?(ctc|salary|compensation)/.test(c))            return p.currentCtc;
    if (/expected.?(ctc|salary|compensation)/.test(c))           return p.expectedCtc;
    if (/notice.?period/.test(c))                                 return p.noticePeriod;
    if (/years?.?of?.?exp|total.?exp/.test(c))                  return p.experience;
    if (/\bcollege\b|\buniversity\b|\binstitut/.test(c))         return p.college;
    if (/\bdegree\b|\bqualification\b/.test(c))                  return DEGREE_LABELS[p.degree] || p.degree;
    if (/graduation.?year|passing.?year/.test(c))                return p.gradYear;
    if (/\bcgpa\b|\bpercentage\b|\bgpa\b/.test(c))              return p.cgpa;
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

  async function autoFillAllStandardFields() {
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
        const combined = [el.name, el.id, el.placeholder,
          el.getAttribute('aria-label'), el.getAttribute('autocomplete'),
          el.getAttribute('data-automation-id'), getLabel(el)
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
  //  JD SCANNER
  // ══════════════════════════════════════════════════════════
  function scanForJobDesc() {
    const SELS = [
      '[class*="description__text"]', '[class*="job-description"]', '[class*="jobDescription"]',
      '.jobsearch-jobDescriptionText', '[data-testid="job-description"]',
      '.posting-description', '#job-details', '[class*="job-details"]',
      '[data-automation-id="job-posting-details"]', '[class*="JobDetails"]',
      '[class*="job_description"]', '[itemprop="description"]',
      '[class*="jobDescriptionContent"]', '#jobDescriptionText',
    ];
    for (const sel of SELS) {
      try {
        const el = document.querySelector(sel);
        if (el && el.innerText.trim().length > 150) {
          jobDesc = el.innerText.trim().slice(0, 10000);
          detectCompanyAndRole();
          // Update sidebar JD textarea if open
          if (sidebar) {
            const jdEl = sidebar.querySelector('#ja-sb-jd');
            if (jdEl && !jdEl.value.trim()) jdEl.value = jobDesc.slice(0, 8000);
          }
          return true;
        }
      } catch {}
    }

    // Fallback: largest text block on page
    const candidates = [...document.querySelectorAll('div, section, article')]
      .filter(el => {
        const t = el.innerText?.trim();
        return t && t.length > 300 && t.length < 10000;
      })
      .sort((a, b) => b.innerText.length - a.innerText.length);

    for (const el of candidates.slice(0, 3)) {
      const text = el.innerText.trim();
      const lc   = text.toLowerCase();
      // Must look like a JD
      if (['responsibilities','qualifications','requirements','experience','skills'].some(w => lc.includes(w))) {
        jobDesc = text.slice(0, 10000);
        detectCompanyAndRole();
        if (sidebar) {
          const jdEl = sidebar.querySelector('#ja-sb-jd');
          if (jdEl && !jdEl.value.trim()) jdEl.value = jobDesc.slice(0, 8000);
        }
        return true;
      }
    }
    return false;
  }

})();