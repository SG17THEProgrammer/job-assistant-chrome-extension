// ═══════════════════════════════════════════════════════════
//  JobAssist AI — Content Script v6
//  Architecture: BLOCK known bad sites, ALLOW everything else
//  that shows job signals. No whitelist — universal.
// ═══════════════════════════════════════════════════════════
(function () {
  if (window.__jaLoaded) return;
  window.__jaLoaded = true;

  let activeField    = null;
  let jobDesc        = null;
  let companyName    = null;
  let aiFilledFields = new WeakSet();
  let panel          = null;
  let bubble         = null;
  let generating     = false;
  let panelOpen      = false;

  // ══════════════════════════════════════════════════════════
  //  STEP 1 — HARD BLOCK LIST
  //  Sites we know are NEVER job application pages.
  //  Everything else gets a chance to pass the signal check.
  // ══════════════════════════════════════════════════════════
  const BLOCKED_DOMAINS = [
    // Search engines
    'google.com', 'bing.com', 'yahoo.com', 'duckduckgo.com', 'baidu.com',
    // Social / chat (NOT LinkedIn — that's a job site)
    'twitter.com', 'x.com', 'facebook.com', 'instagram.com',
    'whatsapp.com', 'telegram.org', 'discord.com', 'slack.com',
    'reddit.com', 'quora.com', 'pinterest.com', 'snapchat.com',
    // AI tools
    'chat.openai.com', 'chatgpt.com', 'claude.ai', 'gemini.google.com',
    'bard.google.com', 'copilot.microsoft.com', 'perplexity.ai',
    'character.ai', 'poe.com', 'huggingface.co',
    // Video / entertainment
    'youtube.com', 'netflix.com', 'hotstar.com', 'primevideo.com',
    'spotify.com', 'twitch.tv', 'vimeo.com', 'dailymotion.com',
    // Shopping
    'amazon.com', 'amazon.in', 'flipkart.com', 'myntra.com',
    'meesho.com', 'snapdeal.com', 'ebay.com', 'etsy.com',
    'shopify.com', 'swiggy.com', 'zomato.com',
    // News / blogs
    'medium.com', 'substack.com', 'wordpress.com', 'blogger.com',
    'times of india', 'ndtv.com', 'bbc.com', 'cnn.com', 'techcrunch.com',
    // Dev tools (not job portals)
    'github.com', 'gitlab.com', 'stackoverflow.com', 'npmjs.com',
    'developer.mozilla.org', 'w3schools.com', 'geeksforgeeks.org',
    // Maps / travel
    'maps.google.com', 'booking.com', 'makemytrip.com', 'irctc.co.in',
    // Banking / finance
    'paypal.com', 'razorpay.com', 'paytm.com', 'phonepe.com',
    // Mail
    'gmail.com', 'outlook.com', 'mail.yahoo.com',
    // Docs (but NOT forms — Google Forms handled separately)
    'drive.google.com', 'sheets.google.com', 'slides.google.com',
  ];

  const host = location.hostname.replace(/^www\./, '').toLowerCase();

  // Block if domain matches blocklist
  if (BLOCKED_DOMAINS.some(d => host === d || host.endsWith('.' + d))) return;

  // Special case: docs.google.com — only allow /forms/ URLs
  if (host === 'docs.google.com' && !location.pathname.includes('/forms/')) return;

  // ══════════════════════════════════════════════════════════
  //  STEP 2 — JOB SIGNAL DETECTION
  //  For everything not blocked, check if this looks like
  //  a job/application page using URL + DOM signals.
  //  We use a SCORING system — need at least 1 strong signal
  //  or 2 weak signals to activate.
  // ══════════════════════════════════════════════════════════

  // Known ATS domains — always activate immediately, no scoring needed
  const ATS_DOMAINS = [
    'linkedin.com', 'indeed.com', 'naukri.com', 'internshala.com',
    'glassdoor.com', 'monster.com', 'shine.com', 'foundit.in',
    'unstop.com', 'wellfound.com', 'angel.co', 'instahyre.com',
    'hirist.com', 'iimjobs.com', 'cutshort.io', 'apna.co',
    'lever.co', 'greenhouse.io', 'workday.com', 'myworkdayjobs.com',
    'icims.com', 'taleo.net', 'smartrecruiters.com', 'ashbyhq.com',
    'breezy.hr', 'bamboohr.com', 'jobvite.com', 'recruitee.com',
    'workable.com', 'applytojob.com', 'jazzhr.com', 'teamtailor.com',
    'careers.google.com', 'jobs.apple.com', 'amazon.jobs',
    'careers.microsoft.com', 'metacareers.com', 'jobs.netflix.com',
    'jobs.ycombinator.com', 'hiring.cafe', 'freshersworld.com',
    'hirect.in', 'placementindia.com', 'iimjobs.com', 'naukrilearning.com',
  ];
  const isKnownATS = ATS_DOMAINS.some(d => host === d || host.endsWith('.' + d));

  // Boot — wait for DOM, then score the page
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => delayedBoot(isKnownATS));
  } else {
    delayedBoot(isKnownATS);
  }

  function delayedBoot(skipScoring) {
    if (skipScoring) {
      activate();
      return;
    }

    // Try immediately, then retry as DOM loads (handles SPAs)
    let activated = false;
    function tryActivate() {
      if (activated) return;
      if (pageHasJobSignals()) {
        activated = true;
        activate();
      }
    }

    // Attempt 1: right now (works if DOM already has signals)
    tryActivate();

    // Attempt 2: after 500ms (page partially rendered)
    setTimeout(tryActivate, 500);

    // Attempt 3: after 1500ms (SPA fully rendered)
    setTimeout(tryActivate, 1500);

    // Attempt 4: watch for DOM changes that add job signals
    const observer = new MutationObserver(() => {
      tryActivate();
      if (activated) observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    // Stop watching after 5s regardless
    setTimeout(() => observer.disconnect(), 5000);
  }

  // ══════════════════════════════════════════════════════════
  //  JOB SIGNAL SCORING
  //  Returns true if this page looks like a job/apply page
  // ══════════════════════════════════════════════════════════
  function pageHasJobSignals() {
    const path  = location.pathname.toLowerCase();
    const href  = location.href.toLowerCase();
    const title = document.title.toLowerCase();
    let score   = 0;

    // ── URL path signals (strong — 2 points each) ──
    const STRONG_PATH = [
      '/apply', '/application', '/job-application',
      '/careers/', '/career/', '/jobs/',
      '/job/', '/vacancy/', '/opening/',
      '/internship/', '/recruitment/', '/hiring/',
      '/work-with-us', '/join-us', '/join-our-team',
      '/viewform',   // Google Forms
    ];
    if (STRONG_PATH.some(p => path.includes(p))) score += 2;

    // ── URL query param signals (strong — 2 points) ──
    const STRONG_PARAMS = [
      'gh_jid=',         // Greenhouse embedded
      'jobid=', 'job_id=', 'jobcode=',
      'positionid=', 'requisitionid=', 'openingid=',
      'lever-origin=', 'source=lever',
    ];
    if (STRONG_PARAMS.some(p => href.includes(p))) score += 2;

    // ── URL subdomain/domain signals (medium — 1 point) ──
    const MEDIUM_DOMAIN = ['jobs.', 'careers.', 'career.', 'hiring.',
      'recruit.', 'apply.', 'talent.', 'work.', 'join.'];
    if (MEDIUM_DOMAIN.some(p => host.startsWith(p))) score += 1;

    // ── Page title signals (medium — 1 point) ──
    const TITLE_KEYWORDS = ['apply', 'application', 'job', 'career',
      'vacancy', 'internship', 'hiring', 'recruitment', 'opening', 'position'];
    if (TITLE_KEYWORDS.some(k => title.includes(k))) score += 1;

    // ── DOM signals: ATS-specific elements (strong — 2 points) ──
    const ATS_DOM = [
      '#application',                          // Greenhouse
      '.application-form',
      '[data-automation-id="applicationPage"]',// Workday
      '[data-automation-id="job-posting-details"]',
      '.posting-apply',                        // Lever
      'form[action*="apply"]',
      'form[action*="application"]',
      '[class*="apply-form"]',
      '[class*="job-application"]',
      '[id*="job-application"]',
      '.freebirdFormviewerViewHeaderTitle',     // Google Forms
      'gh_jid',                                // Greenhouse param in page
    ];
    if (ATS_DOM.some(sel => { try { return !!document.querySelector(sel); } catch { return false; } })) {
      score += 2;
    }

    // ── DOM signals: JD text present (medium — 1 point) ──
    const JD_DOM = [
      '[class*="job-description"]', '[class*="jobDescription"]',
      '[class*="description__text"]', '.jobsearch-jobDescriptionText',
      '.posting-description', '[class*="job-details"]',
    ];
    if (JD_DOM.some(sel => {
      try { const el = document.querySelector(sel); return el && el.innerText.length > 100; }
      catch { return false; }
    })) score += 1;

    // ── Google Forms: check form title content (1 point) ──
    if (host === 'docs.google.com') {
      const formTitle = document.querySelector('.freebirdFormviewerViewHeaderTitle');
      const allText = [
        formTitle?.innerText || '',
        document.title,
        ...Array.from(document.querySelectorAll('.freebirdFormviewerViewItemsItemItemTitle'))
          .map(el => el.innerText),
      ].join(' ').toLowerCase();

      const JOB_WORDS = ['job', 'career', 'apply', 'intern', 'hiring',
        'placement', 'campus', 'drive', 'recruit', 'resume', 'cv',
        'experience', 'cgpa', 'branch', 'college', 'fresher', 'candidate'];
      if (JOB_WORDS.some(w => allText.includes(w))) score += 2;
    }

    // Activate if score >= 2 (needs at least one strong OR two medium signals)
    return score >= 2;
  }

  // ══════════════════════════════════════════════════════════
  //  ACTIVATE — mount UI and listeners
  // ══════════════════════════════════════════════════════════
  function activate() {
    chrome.storage.local.get(['autoJd'], d => {
      buildBubble();
      buildPanel();
      document.addEventListener('focusin',  onFocusIn,  true);
      document.addEventListener('focusout', onFocusOut, true);
      document.addEventListener('mouseup',  onMouseUp,  true);
      if (d.autoJd !== false) {
        scanForJobDesc();
        new MutationObserver(() => { if (!jobDesc) scanForJobDesc(); })
          .observe(document.body, { childList: true, subtree: true });
      }
      // Autofill standard fields (name, email, phone etc.) on page load
      // This runs silently with no bubble — just like Simplify does
      autoFillAllStandardFields();
    });
  }

  // ══════════════════════════════════════════════════════════
  //  AUTO-FILL ALL STANDARD FIELDS ON PAGE LOAD
  //  Silently fills name/email/phone/etc. from saved profile.
  //  Runs once when extension activates on the page.
  //  Retries up to 3s for SPA pages that render forms late.
  // ══════════════════════════════════════════════════════════
  function autoFillAllStandardFields() {
    let attempts = 0;
    const MAX    = 6;   // try up to 6 times
    const DELAY  = 500; // every 500ms = up to 3 seconds total

    async function tryFill() {
      attempts++;
      const profile = await loadProfile();

      // Find ALL input/textarea/select fields on the page
      const fields = document.querySelectorAll(
        'input[type="text"], input[type="email"], input[type="tel"], ' +
        'input[type="number"], input[type="url"], textarea, select'
      );

      let filled = 0;
      for (const el of fields) {
        // Skip if already has a value or is hidden
        if (el.value && el.value.trim()) continue;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue; // hidden

        const combined = [
          el.name, el.id, el.placeholder,
          el.getAttribute('aria-label'),
          el.getAttribute('autocomplete'),
          el.getAttribute('data-automation-id'),
          el.getAttribute('data-field'),
          getLabel(el),
        ].filter(Boolean).join(' ').toLowerCase();

        const val = getFieldMapping(combined, profile);
        if (val) {
          setValue(el, val);
          flashField(el);
          filled++;
        }
      }

      // If we found and filled nothing, retry (form might not be rendered yet)
      if (filled === 0 && attempts < MAX) {
        setTimeout(tryFill, DELAY);
      }
    }

    // Start after a short delay to let SPA render
    setTimeout(tryFill, 600);
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
      if (panelOpen) return;
      const f = document.activeElement;
      if (bubble?.contains(f) || panel?.contains(f)) return;
      hideBubble();
    }, 200);
  }

  function onMouseUp() {
    const sel = window.getSelection();
    if (sel && sel.toString().length > 0) hideBubble();
  }

  function isApplicationField(el) {
    if (!el?.tagName) return false;
    const tag = el.tagName.toUpperCase();

    // Google Forms
    if (host === 'docs.google.com') {
      if (tag === 'TEXTAREA') return true;
      if (tag === 'INPUT' && (
        el.classList.contains('quantumWizTextinputPaperinputInput') ||
        el.getAttribute('jsname') === 'YPqjbf'
      )) {
        const label = getLabel(el).toLowerCase();
        const SKIP = ['name', 'email', 'phone', 'mobile', 'roll',
          'date', 'age', 'address', 'pincode', 'number'];
        return !SKIP.some(w => label.includes(w));
      }
      return false;
    }

    // Standard textarea — always target
    if (tag === 'TEXTAREA') {
      return el.getBoundingClientRect().height > 28;
    }

    // Contenteditable — LinkedIn rich text fields
    if (el.getAttribute?.('contenteditable') === 'true') {
      const rect = el.getBoundingClientRect();
      return rect.height > 50 && rect.width > 150;
    }

    // Input[text] — only if label is question-like
    if (tag === 'INPUT' && (el.type || 'text') === 'text') {
      const combined = [el.name, el.id, el.placeholder, el.getAttribute('aria-label')]
        .filter(Boolean).join(' ').toLowerCase();
      const SKIP = ['search', 'query', 'email', 'mobile', 'tel', 'zip', 'postal',
        'first', 'last', 'user', 'pass', 'url', 'website', 'linkedin',
        'github', 'city', 'state', 'country', 'address', 'ctc', 'salary',
        'notice', 'code', 'date', 'birth', 'referral', 'promo', 'pincode'];
      if (SKIP.some(w => combined.includes(w))) return false;
      const label = getLabel(el).toLowerCase();
      const TRIGGERS = ['why', 'describe', 'tell', 'how would', 'what is your',
        'background', 'experience', 'skill', 'strength', 'weakness', 'passion',
        'contribute', 'motivation', 'cover', 'statement', 'goal', 'interest',
        'about yourself', 'elaborate', 'explain', 'project', 'achievement',
        'responsibility', 'summary', 'yourself'];
      return TRIGGERS.some(t => label.includes(t));
    }
    return false;
  }

  function getLabel(el) {
    // Google Forms question title
    if (host === 'docs.google.com') {
      let cur = el.parentElement;
      for (let i = 0; i < 10 && cur; i++) {
        const q = cur.querySelector('.freebirdFormviewerViewItemsItemItemTitle');
        if (q) return q.innerText.trim();
        cur = cur.parentElement;
      }
      return el.getAttribute('aria-label') || el.placeholder || '';
    }
    // Standard
    try {
      if (el.id) {
        const lbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (lbl) return lbl.innerText.trim();
      }
    } catch {}
    if (el.getAttribute('aria-label')) return el.getAttribute('aria-label');
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const ref = document.getElementById(labelledBy);
      if (ref) return ref.innerText.trim();
    }
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
  //  SMART AUTOFILL — standard fields from profile
  // ══════════════════════════════════════════════════════════
  async function tryAutoFillField(el) {
    const p = await loadProfile();
    const combined = [
      el.name, el.id, el.placeholder,
      el.getAttribute('aria-label'),
      el.getAttribute('autocomplete'),
      el.getAttribute('data-automation-id'),
      getLabel(el),
    ].filter(Boolean).join(' ').toLowerCase();

    const val = getFieldMapping(combined, p);
    if (val) {
      setValue(el, val);
      aiFilledFields.add(el);
      flashField(el);
      return true;
    }
    return false;
  }

  function getFieldMapping(c, p) {
    if (/\bfirst.?name\b/.test(c))                              return p.firstName;
    if (/\blast.?name\b|surname/.test(c))                       return p.lastName;
    if (/\bfull.?name\b/.test(c))                               return [p.firstName, p.lastName].filter(Boolean).join(' ');
    if (/\bemail\b/.test(c))                                    return p.email;
    if (/\bphone\b|\bmobile\b|\bcontact.?no\b/.test(c))        return p.phone;
    if (/dob|date.?of.?birth|birth.?date/.test(c))             return p.dob;
    if (/\bcity\b/.test(c))                                     return p.city;
    if (/\bstate\b|\bprovince\b/.test(c))                       return p.state;
    if (/\bcountry\b/.test(c))                                  return p.country;
    if (/\bzip\b|\bpincode\b|\bpostal\b/.test(c))              return p.zipcode;
    if (/\blinkedin\b/.test(c))                                 return p.linkedinUrl;
    if (/\bgithub\b/.test(c))                                   return p.githubUrl;
    if (/\bportfolio\b|\bwebsite\b|\bpersonal.?site\b/.test(c)) return p.portfolioUrl;
    if (/current.?(ctc|salary|compensation)/.test(c))           return p.currentCtc;
    if (/expected.?(ctc|salary|compensation)/.test(c))          return p.expectedCtc;
    if (/notice.?period/.test(c))                               return p.noticePeriod;
    if (/years?.?of?.?exp|total.?exp/.test(c))                 return p.experience;
    if (/\bcollege\b|\buniversity\b|\binstitut/.test(c))        return p.college;
    if (/\bdegree\b|\bqualification\b/.test(c))                 return p.degree;
    if (/graduation.?year|passing.?year/.test(c))               return p.gradYear;
    if (/\bcgpa\b|\bpercentage\b|\bgpa\b/.test(c))             return p.cgpa;
    // Greenhouse-specific field names (seen on rubrik.com and similar)
    if (/\buniversity\b/.test(c))                                  return p.college;
    if (/current.?employer|company.?name|employer.?name/.test(c))   return p.currentEmployer || 'N/A';
    if (/\bwebsite\b|personal.?url|portfolio.?url/.test(c))        return p.portfolioUrl;
    return null;
  }

  function loadProfile() {
    return new Promise(r => chrome.storage.local.get([
      'firstName', 'lastName', 'email', 'phone', 'dob',
      'city', 'state', 'country', 'zipcode',
      'linkedinUrl', 'githubUrl', 'portfolioUrl',
      'currentCtc', 'expectedCtc', 'noticePeriod', 'experience',
      'degree', 'college', 'gradYear', 'cgpa',
    ], r));
  }

  function flashField(el) {
    const prev = el.style.outline;
    el.style.outline = '2px solid #4F46E5';
    setTimeout(() => { el.style.outline = prev; }, 1200);
  }

  // ══════════════════════════════════════════════════════════
  //  BUBBLE
  // ══════════════════════════════════════════════════════════
  function buildBubble() {
    bubble = document.createElement('div');
    bubble.id = 'ja-bubble';
    bubble.innerHTML = `<span class="ja-bubble-label">✦ Answer with AI</span>`;
    bubble.addEventListener('mousedown', e => {
      e.preventDefault();
      e.stopPropagation();
      openPanel();
    });
    document.body.appendChild(bubble);
    hideBubble();
  }

  function showBubble(field, isRegen) {
    if (!bubble) return;
    bubble.querySelector('.ja-bubble-label').textContent =
      isRegen ? '↺ Re-answer with AI' : '✦ Answer with AI';
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
    const sY = window.scrollY, sX = window.scrollX;
    let top  = rect.top + sY - 38;
    let left = rect.right + sX - 185;
    if (left < 4)  left = 4;
    if (top  < 4)  top  = rect.bottom + sY + 6;
    bubble.style.top  = top  + 'px';
    bubble.style.left = left + 'px';
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
          <textarea id="ja-question" rows="3"
            placeholder="Paste the question here, or type what this field asks…"></textarea>
        </div>
        <details class="ja-details">
          <summary>Job description (for better answers)</summary>
          <textarea id="ja-jd" rows="4"
            placeholder="Paste the job description here…"></textarea>
        </details>
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

    panel.querySelector('#ja-close-btn').onclick = e => {
      e.preventDefault(); e.stopPropagation(); closePanel();
    };
    panel.querySelector('#ja-gen-btn').onclick   = () => runGenerate();
    panel.querySelector('#ja-regen-btn').onclick = () => runGenerate();
    panel.querySelector('#ja-insert-btn').onclick = () => insertAnswer();
    panel.querySelector('#ja-copy-btn').onclick   = () => copyAnswer();
    panel.addEventListener('mousedown', e => e.stopPropagation());
    panel.addEventListener('click',     e => e.stopPropagation());
  }

  function openPanel() {
    if (!panel) return;
    hideBubble();
    panel.classList.remove('ja-hidden');
    panelOpen = true;
    const qEl = panel.querySelector('#ja-question');
    if (activeField && !qEl.value.trim()) {
      const label = getLabel(activeField);
      if (label && label.length > 3 && label.length < 500) qEl.value = label;
    }
    const jdEl = panel.querySelector('#ja-jd');
    if (jobDesc && !jdEl.value.trim()) jdEl.value = jobDesc.slice(0, 3000);
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
      fieldHint: activeField ? getLabel(activeField) : '',
      companyName,
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
    const text = panel.querySelector('#ja-answer-text').textContent.trim();
    navigator.clipboard.writeText(text).then(() => {
      const btn = panel.querySelector('#ja-copy-btn');
      const orig = btn.textContent;
      btn.textContent = 'Copied ✓';
      setTimeout(() => btn.textContent = orig, 1800);
    });
  }

  // ══════════════════════════════════════════════════════════
  //  FIELD VALUE — React/Vue/plain HTML compatible
  // ══════════════════════════════════════════════════════════
  function setValue(el, text) {
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      const proto = Object.getOwnPropertyDescriptor(
        el.tagName === 'TEXTAREA'
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype,
        'value'
      );
      if (proto?.set) proto.set.call(el, text);
      else el.value = text;
      ['input', 'change', 'blur'].forEach(ev =>
        el.dispatchEvent(new Event(ev, { bubbles: true }))
      );
    } else if (el.getAttribute?.('contenteditable') === 'true') {
      el.innerText = text;
      el.dispatchEvent(new InputEvent('input', { bubbles: true }));
    }
  }

  // ══════════════════════════════════════════════════════════
  //  JD SCANNER
  // ══════════════════════════════════════════════════════════
  function scanForJobDesc() {
    const SELECTORS = [
      '[class*="description__text"]',
      '[class*="job-description"]', '[class*="jobDescription"]',
      '.jobsearch-jobDescriptionText',
      '[data-testid="job-description"]',
      '.posting-description',
      '#job-details', '[class*="job-details"]',
      '[data-automation-id="job-posting-details"]',
    ];
    for (const sel of SELECTORS) {
      try {
        const el = document.querySelector(sel);
        if (el && el.innerText.trim().length > 200) {
          jobDesc = el.innerText.trim().slice(0, 5000);
          const h1 = document.querySelector('h1');
          if (h1) companyName = h1.innerText.trim().slice(0, 80);
          return;
        }
      } catch {}
    }
  }

})();