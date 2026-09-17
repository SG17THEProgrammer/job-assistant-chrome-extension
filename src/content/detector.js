// ── Detector ─────────────────────────────────────────────────
// Determines: should the extension activate on this page?
// Is this element an application field we should handle?

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

// Every page on these domains is a job/application page
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
const PATH_GATED = {
  'linkedin.com':    ['/jobs/', '/job/', '/apply/'],
  'glassdoor.com':   ['/job-listing/', '/job/', '/apply/'],
  'glassdoor.co.in': ['/job-listing/', '/job/', '/apply/'],
  'payu.in':         ['/job', '/career', '/apply', '/position', '/opening'],
  'razorpay.com':    ['/job', '/career', '/apply'],
  'meesho.com':      ['/job', '/career', '/apply'],
  'cred.club':       ['/job', '/career', '/apply'],
};

const host = location.hostname.replace(/^www\./, '').toLowerCase();
const isGoogleForms = host === 'docs.google.com' && location.pathname.includes('/forms/');

export const Detector = {
  host,
  isGoogleForms,

  shouldActivate() {
    if (host === 'docs.google.com' && !isGoogleForms) return false;
    if (BLOCKED.some(d => host === d || host.endsWith('.' + d))) return false;
    if (isGoogleForms) return true;
    if (PURE_JOB_DOMAINS.some(d => host === d || host.endsWith('.' + d))) return true;
    if (this._pathGated()) return true;
    return this._urlScore() >= 3;
  },

  _pathGated() {
    const path = location.pathname.toLowerCase();
    return Object.entries(PATH_GATED).some(([domain, paths]) => {
      if (host !== domain && !host.endsWith('.' + domain)) return false;
      return paths.some(p => path.includes(p));
    });
  },

  _urlScore() {
    const path = location.pathname.toLowerCase();
    const href = location.href.toLowerCase();
    let score  = 0;
    const careerSubs = ['jobs.','careers.','career.','hiring.','recruit.','apply.','talent.','work.'];
    if (careerSubs.some(s => host.startsWith(s))) score += 4;
    const careerPaths = ['/apply','/application','/careers/','/career/','/jobs/','/job/',
      '/vacancy/','/opening/','/internship/','/recruitment/','/hiring/','/viewform',
      '/work-with-us','/join-us','/join/','/positions/'];
    if (careerPaths.some(p => path.includes(p))) score += 3;
    const atsParams = ['gh_jid=','jobid=','job_id=','jobcode=','positionid=',
      'requisitionid=','openingid=','lever-origin=','refsource='];
    if (atsParams.some(p => href.includes(p))) score += 3;
    return score;
  },

  // DOM scoring — fallback only for edge cases
  getDomScore() {
    let score = 0;
    const title = document.title.toLowerCase();
    const TITLE_KW = ['apply','application','job','career','vacancy','internship','hiring','position'];
    if (TITLE_KW.some(k => title.includes(k))) score += 1;
    const ATS_SELS = [
      '#application','.application-form',
      '[data-automation-id="applicationPage"]',
      '[data-automation-id="job-posting-details"]',
      '.posting-apply','form[action*="apply"]',
      '[class*="apply-form"]','[class*="job-application"]',
      '.freebirdFormviewerViewHeaderTitle',
    ];
    if (ATS_SELS.some(s => { try { return !!document.querySelector(s); } catch { return false; } })) score += 2;
    return score;
  },

  // Is this element one we should offer AI help for?
  isApplicationField(el) {
    if (!el?.tagName) return false;
    // Hard guard — never trigger on our own injected UI
    if (el.closest('#ja-sidebar') || el.closest('#ja-tracker') || el.closest('#ja-bubble')) return false;

    const tag = el.tagName.toUpperCase();

    if (isGoogleForms) {
      return (tag === 'TEXTAREA') || (tag === 'INPUT' && el.type === 'text');
    }

    if (tag === 'TEXTAREA') {
      const r = el.getBoundingClientRect();
      if (r.height <= 40) return false;
      const combined = [el.name, el.id, el.placeholder].filter(Boolean).join(' ').toLowerCase();
      const SKIP_TA = ['search','comment','message','chat','note','address','street'];
      if (SKIP_TA.some(w => combined.includes(w))) return false;
      return true;
    }

    if (el.getAttribute?.('contenteditable') === 'true') {
      const r = el.getBoundingClientRect();
      return r.height > 50 && r.width > 150;
    }

    if (tag === 'INPUT' && (el.type || 'text') === 'text') {
      const combined = [el.name, el.id, el.placeholder, el.getAttribute('aria-label')]
        .filter(Boolean).join(' ').toLowerCase();
      const SKIP = ['search','query','email','mobile','tel','zip','postal','first','last',
        'user','pass','url','website','linkedin','github','city','state','country',
        'address','ctc','salary','notice','code','date','birth','referral','pincode'];
      if (SKIP.some(w => combined.includes(w))) return false;
      const label = this.getLabel(el).toLowerCase();
      const TRIGGERS = ['why','describe','tell','how would','what is your','background',
        'experience','skill','strength','weakness','passion','contribute','motivation',
        'cover','statement','goal','interest','about yourself','elaborate','explain',
        'project','achievement','responsibility','summary'];
      return TRIGGERS.some(t => label.includes(t));
    }

    return false;
  },

  getLabel(el) {
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
  },
};
