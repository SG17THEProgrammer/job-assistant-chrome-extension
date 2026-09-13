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
    // Search engines — be specific, don't block all of google.com
    // (docs.google.com/forms must be allowed)
    'www.google.com', 'google.com', 'bing.com', 'yahoo.com', 'duckduckgo.com', 'baidu.com',
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
  // Special case: docs.google.com/forms must be allowed (job application forms)
  const isGoogleForms = host === 'docs.google.com' && location.pathname.includes('/forms/');
  if (!isGoogleForms && BLOCKED_DOMAINS.some(d => host === d || host.endsWith('.' + d))) {
    return;
  }

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
    console.log('[JobAssist] booting. host='+host+' skipScoring='+skipScoring);
    if (skipScoring) {
      console.log('[JobAssist] known ATS — activating immediately');
      activate();
      return;
    }

    let activated = false;
    function tryActivate() {
      if (activated) return;
      const score = getJobScore();
      console.log('[JobAssist] scoring attempt, score='+score, 'url='+location.href);
      if (score >= 2) {
        activated = true;
        console.log('[JobAssist] ACTIVATING — score='+score);
        activate();
      }
    }

    tryActivate();
    setTimeout(tryActivate, 500);
    setTimeout(tryActivate, 1500);
    setTimeout(tryActivate, 3000);

    const observer = new MutationObserver(() => {
      tryActivate();
      if (activated) observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => observer.disconnect(), 8000);
  }

  // ══════════════════════════════════════════════════════════
  //  JOB SIGNAL SCORING
  //  Returns true if this page looks like a job/apply page
  // ══════════════════════════════════════════════════════════
  function getJobScore() {
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

    console.log('[JobAssist] score breakdown — path:'+!!(STRONG_PATH.some(p=>path.includes(p)))+' param:'+!!(STRONG_PARAMS.some(p=>href.includes(p)))+' domain:'+!!(MEDIUM_DOMAIN.some(p=>host.startsWith(p)))+' title:'+!!(TITLE_KEYWORDS.some(k=>title.includes(k)))+' total:'+score);
    return score;
  }

  // ══════════════════════════════════════════════════════════
  //  ACTIVATE — mount UI and listeners
  // ══════════════════════════════════════════════════════════
  function activate() {
    console.log('[JobAssist] activate() called on', location.href);
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
      console.log('[JobAssist] tryFill attempt', attempts, 'profile keys filled:', Object.values(profile).filter(Boolean).length);

      // Find ALL input/textarea/select fields on the page
      const fields = document.querySelectorAll(
        'input[type="text"], input[type="email"], input[type="tel"], ' +
        'input[type="number"], input[type="url"], textarea, select'
      );

      let filled = 0;
      for (const el of fields) {
        // Skip if already has a non-empty value
        if (el.value && el.value.trim().length > 0) continue;
        // Skip hidden fields
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') continue;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;
        // Skip disabled/readonly
        if (el.disabled || el.readOnly) continue;

        const combined = [
          el.name, el.id, el.placeholder,
          el.getAttribute('aria-label'),
          el.getAttribute('autocomplete'),
          el.getAttribute('data-automation-id'),
          el.getAttribute('data-field'),
          el.getAttribute('jsname'),
          getLabel(el),
        ].filter(Boolean).join(' ').toLowerCase();

        const val = getFieldMapping(combined, profile);
        if (val) {
          console.log('[JobAssist] filling field:', combined.slice(0,60), '→', val.slice(0,30));
          setValue(el, val);
          flashField(el);
          filled++;
          // Small delay between fields to avoid overwhelming React state
          await new Promise(r => setTimeout(r, 80));
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
      if (bubbleMouseDown) return; // user is clicking the bubble — don't hide
      const f = document.activeElement;
      if (bubble?.contains(f) || panel?.contains(f)) return;
      hideBubble();
    }, 250);
  }

  function onMouseUp() {
    const sel = window.getSelection();
    if (sel && sel.toString().length > 0) hideBubble();
  }

  function isApplicationField(el) {
    if (!el?.tagName) return false;
    const tag = el.tagName.toUpperCase();

    // Google Forms — 2024 DOM structure
    if (host === 'docs.google.com') {
      // Long answer = textarea → always show AI bubble
      if (tag === 'TEXTAREA') return true;
      // Short answer = input[type=text]
      if (tag === 'INPUT' && el.type === 'text') {
        // Get the actual question text (not "Your answer")
        const question = getLabel(el).toLowerCase();
        // Skip fields that are clearly profile/personal data (autofill handles those)
        const SKIP = ['name', 'email', 'phone', 'mobile', 'roll no',
          'registration', 'date of birth', 'age', 'pincode', 'address'];
        if (SKIP.some(w => question.includes(w))) return false;
        // If we got a real question, show bubble
        if (question.length > 3) return true;
        // If label is empty or generic, still show bubble (user can type question)
        return true;
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
    // ── Google Forms label extraction ──
    // Structure (2024):
    //   div[data-params]  ← question container
    //     div[role="heading"]  ← question TEXT (what we want)
    //     div  ← input wrapper
    //       input / textarea  ← the actual field (aria-label="Your answer" — NOT useful)
    //
    // Strategy: walk UP from input until we find the question container,
    // then grab the first [role="heading"] or title span inside it.
    if (host === 'docs.google.com') {
      // Walk up DOM — Google Forms question container has data-params attribute
      let cur = el.parentElement;
      for (let i = 0; i < 15 && cur; i++) {
        // Question container identification:
        // 1. Has data-params (most reliable — unique to each question block)
        // 2. Or has jsmodel attribute (also question-level)
        const isQuestionContainer =
          cur.hasAttribute('data-params') ||
          cur.hasAttribute('jsmodel') ||
          cur.classList.contains('freebirdFormviewerViewItemsItemItem') ||
          cur.getAttribute('role') === 'listitem';

        if (isQuestionContainer) {
          // Try heading role first (most reliable)
          const heading = cur.querySelector('[role="heading"]');
          if (heading) {
            const text = heading.innerText.trim();
            // Filter out generic placeholders
            if (text && text !== 'Your answer' && text !== 'Short answer text') {
              return text;
            }
          }
          // Legacy class
          const legacyTitle = cur.querySelector(
            '.freebirdFormviewerViewItemsItemItemTitle,' +
            '.freebirdFormviewerComponentsQuestionBaseTitle'
          );
          if (legacyTitle) {
            const text = legacyTitle.innerText.trim();
            if (text) return text;
          }
          // Any span/div that looks like a question title (first text block, not input)
          const spans = cur.querySelectorAll('span, div');
          for (const span of spans) {
            if (span.contains(el)) continue; // skip the input's own container
            const text = span.innerText?.trim();
            if (text && text.length > 3 && text.length < 300 &&
                text !== 'Your answer' && text !== 'Short answer text' &&
                !span.querySelector('input, textarea')) {
              return text;
            }
          }
          break; // found container but no title — stop walking
        }
        cur = cur.parentElement;
      }
      // Last resort: check aria-label but skip generic values
      const aria = el.getAttribute('aria-label');
      if (aria && aria !== 'Your answer' && aria !== 'Short answer text') return aria;
      return '';
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
  let bubbleMouseDown = false; // track mousedown to prevent focusout race

  function buildBubble() {
    bubble = document.createElement('div');
    bubble.id = 'ja-bubble';
    bubble.innerHTML = `<span class="ja-bubble-label">✦ Answer with AI</span>`;

    bubble.addEventListener('mouseenter', () => { bubbleMouseDown = false; });

    bubble.addEventListener('mousedown', e => {
      e.preventDefault();
      e.stopPropagation();
      bubbleMouseDown = true; // tell focusout handler to not hide
    });

    bubble.addEventListener('mouseup', e => {
      e.preventDefault();
      e.stopPropagation();
      if (bubbleMouseDown) {
        bubbleMouseDown = false;
        openPanel();
      }
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
    // Use fixed positioning so bubble stays attached to field
    // even inside scrollable containers (Google Forms, Workday etc.)
    bubble.style.position = 'fixed';
    let top  = rect.top - 36;
    let left = rect.right - 185;
    if (left < 4)   left = 4;
    if (left + 185 > window.innerWidth) left = window.innerWidth - 190;
    if (top  < 4)   top  = rect.bottom + 4; // flip below if no space above
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

        <div class="ja-field-group">
          <label class="ja-label">Custom instruction <span class="ja-opt">optional</span></label>
          <textarea id="ja-custom-prompt" rows="2"
            placeholder='e.g. "Focus on my n8n project" or "Keep it under 3 sentences" or "Mention leadership"'></textarea>
        </div>

        <div class="ja-collapsible">
          <button class="ja-collapse-btn" id="ja-jd-toggle" type="button">
            <span>Job description context</span>
            <span class="ja-arrow">›</span>
          </button>
          <div class="ja-collapse-body ja-hidden" id="ja-jd-body">
            <textarea id="ja-jd" rows="4"
              placeholder="Paste the job description here for more tailored answers…"></textarea>
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

    panel.querySelector('#ja-close-btn').onclick = e => {
      e.preventDefault(); e.stopPropagation(); closePanel();
    };
    panel.querySelector('#ja-gen-btn').onclick    = () => runGenerate();
    panel.querySelector('#ja-regen-btn').onclick  = () => runGenerate();
    panel.querySelector('#ja-insert-btn').onclick = () => insertAnswer();
    panel.querySelector('#ja-copy-btn').onclick   = () => copyAnswer();

    // JD collapsible toggle — pure div, no <details> so content never resets
    panel.querySelector('#ja-jd-toggle').onclick = () => {
      const body  = panel.querySelector('#ja-jd-body');
      const arrow = panel.querySelector('.ja-arrow');
      const open  = !body.classList.contains('ja-hidden');
      body.classList.toggle('ja-hidden', open);
      arrow.textContent = open ? '›' : '‹';
    };

    panel.addEventListener('mousedown', e => e.stopPropagation());
    panel.addEventListener('click',     e => e.stopPropagation());
  }

  function openPanel() {
    if (!panel) return;
    hideBubble();
    panel.classList.remove('ja-hidden');
    panelOpen = true;
    const qEl = panel.querySelector('#ja-question');
    if (activeField) {
      const label = getLabel(activeField);
      // Always update question from field label — overwrite "Your answer" etc.
      if (label && label.length > 3 && label.length < 500) {
        qEl.value = label;
      }
      // If still empty, clear so user sees the placeholder
      if (!label) qEl.value = '';
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

    const customPrompt = panel.querySelector('#ja-custom-prompt').value.trim();
    const res = await chrome.runtime.sendMessage({
      type: 'GENERATE_ANSWER',
      question,
      jobDescription: panel.querySelector('#ja-jd').value.trim() || jobDesc,
      fieldHint: activeField ? getLabel(activeField) : '',
      companyName,
      customPrompt,
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
      // Google Forms uses React internally — requires simulated user interaction
      // Simply setting .value does nothing; must simulate focus + keystrokes
      const isGoogleForm = location.hostname === 'docs.google.com';

      if (isGoogleForm) {
        setValueGoogleForms(el, text);
        return;
      }

      // Standard React-compatible setter for all other sites
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

  // Google Forms requires simulated keyboard events to register input
  // It ignores programmatic value changes — must fake real typing
  function setValueGoogleForms(el, text) {
    el.focus();
    el.click();

    // Clear existing value first
    el.value = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));

    // Set value via native setter (bypasses React read-only)
    const proto = Object.getOwnPropertyDescriptor(
      el.tagName === 'TEXTAREA'
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype,
      'value'
    );
    if (proto?.set) proto.set.call(el, text);
    else el.value = text;

    // Fire the full event sequence Google Forms listens to
    el.dispatchEvent(new Event('focus',  { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keydown',  { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keypress', { bubbles: true }));
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    el.dispatchEvent(new KeyboardEvent('keyup',    { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur',   { bubbles: true }));
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