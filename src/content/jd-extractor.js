// ── JD Extractor ─────────────────────────────────────────────
// Returns { text, title, company } or null.
// NEVER throws. NEVER writes to sidebar. NEVER touches State.
// All validation happens here before returning.
// Caller handles null gracefully.

const host = location.hostname.replace(/^www\./, '').toLowerCase();

// Words that MUST appear in a real JD
const JOB_SIGNALS = [
  'responsib', 'qualif', 'require', 'experienc', 'skill',
  'about the role', 'what you', 'you will', 'we are looking',
  "we're looking", 'candidate', 'join our', 'role', 'position',
  'team', 'minimum', 'preferred', 'bachelor', 'degree',
];

// Portal/board names that should never appear as company or role
const PORTAL_BLOCKLIST = [
  'linkedin','wellfound','greenhouse','lever','workday','naukri',
  'indeed','glassdoor','angellist','angel.co','startup jobs','internshala',
  'ashby','ashbyhq','smartrecruiters','bamboohr','icims','taleo','jobvite',
  'recruitee','workable','applytojob','jazzhr','hiring cafe','unstop',
  'foundit','hirist','iimjobs','cutshort','apna','monster','shine',
];

// ── Main exported function ────────────────────────────────────
export async function tryExtractJd() {
  try {
    // Strategy 1: Ashby API
    const ashby = await tryAshby();
    if (ashby) return validated(ashby);

    // Strategy 2: Greenhouse API
    const gh = await tryGreenhouse();
    if (gh) return validated(gh);

    // Strategy 3: Lever API
    const lever = await tryLever();
    if (lever) return validated(lever);

    // Strategy 4: JSON-LD schema.org/JobPosting
    const jsonLd = tryJsonLd();
    if (jsonLd) return validated(jsonLd);

    // Strategy 5: Known reliable DOM selectors
    const dom = tryDom();
    if (dom) return validated(dom);

    return null;
  } catch {
    return null;
  }
}

// ── Validation (applied to every result before returning) ─────
function validated(result) {
  if (!result?.text) return null;
  const text = result.text.trim();

  // Too short to be a real JD
  if (text.length < 200) return null;

  // Must smell like a job description
  const lc = text.toLowerCase();
  const isJobText = JOB_SIGNALS.some(w => lc.includes(w));
  if (!isJobText) return null;

  return {
    text,
    title:   sanitise(result.title   || ''),
    company: sanitise(result.company || ''),
  };
}

function sanitise(str) {
  if (!str) return '';
  str = str.trim();
  if (!str || str.length < 2 || str.length > 120) return '';
  const lc = str.toLowerCase();
  // Reject if the value IS a portal name
  if (PORTAL_BLOCKLIST.some(p => lc === p || lc.startsWith(p + ' ') || lc.endsWith(' ' + p))) return '';
  // Reject generic words
  if (/^(careers?|jobs?|apply|hiring|recruitment|openings?)$/i.test(str)) return '';
  return str;
}

// ── Strategy 1: Ashby ─────────────────────────────────────────
async function tryAshby() {
  if (!host.includes('ashbyhq.com')) return null;
  const uuid = location.href.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i)?.[1];
  if (!uuid) return null;
  try {
    const res = await fetch(`https://api.ashbyhq.com/posting-api/job-posting?jobPostingId=${uuid}`,
      { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const d = await res.json();
    const p = d.job || d.jobPosting || d;
    const text = p.descriptionPlain || stripHtml(p.description || p.descriptionHtml || '');
    return { text, title: p.title || p.jobTitle || '', company: p.jobBoard?.name || p.companyName || '' };
  } catch { return null; }
}

// ── Strategy 2: Greenhouse ────────────────────────────────────
async function tryGreenhouse() {
  const url = location.href;
  const m = url.match(/greenhouse\.io\/([^\/\?#]+)\/jobs\/(\d+)/i)
         || url.match(/boards\.greenhouse\.io\/([^\/\?#]+)\/jobs\/(\d+)/i);
  if (!m) return null;
  try {
    const res = await fetch(`https://boards-api.greenhouse.io/v1/boards/${m[1]}/jobs/${m[2]}`,
      { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const d = await res.json();
    const text = d.content ? stripHtml(d.content) : '';
    return { text, title: d.title || '', company: m[1] };
  } catch { return null; }
}

// ── Strategy 3: Lever ─────────────────────────────────────────
async function tryLever() {
  const m = location.href.match(/lever\.co\/([^\/\?#]+)\/([0-9a-f-]{36})/i);
  if (!m) return null;
  try {
    const res = await fetch(`https://api.lever.co/v0/postings/${m[1]}/${m[2]}`,
      { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const d = await res.json();
    const sections = (d.lists || []).map(l => `${l.text}\n${l.content ? stripHtml(l.content) : ''}`).join('\n\n');
    const text = (d.descriptionPlain || stripHtml(d.description || '') + '\n\n' + sections).trim();
    return { text, title: d.text || d.title || '', company: m[1] };
  } catch { return null; }
}

// ── Strategy 4: JSON-LD ───────────────────────────────────────
function tryJsonLd() {
  const scripts = document.querySelectorAll('script[type="application/ld+json"]');
  for (const s of scripts) {
    try {
      const d = JSON.parse(s.textContent);
      const items = Array.isArray(d) ? d : [d];
      for (const item of items) {
        const jp = item['@type'] === 'JobPosting' ? item
          : item['@graph']?.find(g => g['@type'] === 'JobPosting');
        if (jp) {
          const text = stripHtml(jp.description || '');
          return {
            text,
            title:   jp.title || jp.name || '',
            company: jp.hiringOrganization?.name || '',
          };
        }
      }
    } catch {}
  }
  return null;
}

// ── Strategy 5: DOM selectors ─────────────────────────────────
function tryDom() {
  // Ordered most-specific → most-generic
  const SELS = [
    '[data-automation-id="job-posting-details"]',   // Workday
    '.posting-description',                          // Lever/Greenhouse hosted
    '[class*="description__text"]',                  // LinkedIn
    '.jobsearch-jobDescriptionText',                 // Indeed
    '#jobDescriptionText',
    '[data-testid="job-description"]',
    '[itemprop="description"]',
    '#job-details',
    '#job-description',
    '[class*="job-description"]',
    '[class*="jobDescription"]',
    '[class*="JobDetails"]',
    '[class*="job-details"]',
    '[class*="job_description"]',
    '[class*="jobDescriptionContent"]',
  ];

  for (const sel of SELS) {
    try {
      const el = document.querySelector(sel);
      if (!el) continue;
      const text = el.innerText?.trim();
      if (text && text.length > 150) {
        const lc = text.toLowerCase();
        if (JOB_SIGNALS.some(w => lc.includes(w))) {
          return { text, title: document.querySelector('h1')?.innerText?.trim() || '', company: '' };
        }
      }
    } catch {}
  }

  // Last resort: largest block with JD language
  const candidates = [...document.querySelectorAll('div,section,article,main')]
    .filter(el => {
      const tag = el.tagName.toLowerCase();
      const cls = (el.className || '').toLowerCase();
      const id  = (el.id || '').toLowerCase();
      if (['nav','header','footer'].includes(tag)) return false;
      if (['nav','menu','sidebar','header','footer','banner'].some(w => cls.includes(w) || id.includes(w))) return false;
      const t = el.innerText?.trim();
      return t && t.length > 400 && t.length < 15000;
    })
    .sort((a, b) => b.innerText.length - a.innerText.length);

  for (const el of candidates.slice(0, 5)) {
    const text = el.innerText.trim();
    const lc   = text.toLowerCase();
    if (JOB_SIGNALS.some(w => lc.includes(w))) {
      return { text, title: document.querySelector('h1')?.innerText?.trim() || '', company: '' };
    }
  }

  return null;
}

// ── HTML → plain text ─────────────────────────────────────────
function stripHtml(html) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
