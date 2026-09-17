// ── Tracker ───────────────────────────────────────────────────
// Bottom-left dialog that pops up when a job page is detected,
// letting the user log the application.

import { State } from './state.js';
import { Msg }   from './messenger.js';

let el = null;

export const Tracker = {
  get el() { return el; },

  build() {
    el = document.createElement('div');
    el.id = 'ja-tracker';
    el.innerHTML = `
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
    document.body.appendChild(el);
    el.classList.add('ja-hidden');

    el.querySelector('#ja-tracker-close').onclick = () => el.classList.add('ja-hidden');
    el.querySelector('#ja-tracker-skip').onclick  = () => el.classList.add('ja-hidden');
    el.querySelector('#ja-tracker-save').onclick  = () => this._save();
  },

  // Called by index.js after successful JD extraction
  show(company, role) {
    if (!el || State.appLogged) return;
    const { company: detectedCompany, role: detectedRole } = _detectFromPage();
    const finalCompany = company || detectedCompany || '';
    const finalRole    = role    || detectedRole    || '';

    if (!finalCompany && !finalRole) return; // Nothing useful detected, don't show

    const companyInput = el.querySelector('#ja-t-company');
    const roleInput    = el.querySelector('#ja-t-role');
    if (finalCompany) companyInput.value = finalCompany;
    if (finalRole)    roleInput.value    = finalRole;

    el.classList.remove('ja-hidden');
    // Auto-hide after 12s if user doesn't interact
    setTimeout(() => el.classList.add('ja-hidden'), 12000);
  },

  async _save() {
    const company = el.querySelector('#ja-t-company')?.value.trim();
    const role    = el.querySelector('#ja-t-role')?.value.trim();
    const btn     = el.querySelector('#ja-tracker-save');
    if (btn) { btn.textContent = 'Saving…'; btn.disabled = true; }

    await Msg.logApplication({
      company, role,
      url:  location.href,
      jd:   State.jobDesc || '',
      date: new Date().toISOString(),
    });

    // Also add to companies list if new
    chrome.storage.local.get(['companies'], d => {
      const c = d.companies || {};
      if (company && !c[company]) {
        c[company] = '';
        chrome.storage.local.set({ companies: c });
      }
    });

    State.appLogged = true;
    el.classList.add('ja-hidden');
  },
};

// ── Detect company/role from page metadata ────────────────────
function _detectFromPage() {
  const host      = location.hostname.replace(/^www\./, '').toLowerCase();
  const ogSite    = document.querySelector('meta[property="og:site_name"]')?.content?.trim();
  const ogTitle   = document.querySelector('meta[property="og:title"]')?.content?.trim();
  const h1Text    = document.querySelector('h1')?.innerText?.trim();
  const pageTitle = document.title.trim();

  let company = ogSite || '';
  let role    = '';

  if (h1Text && h1Text.length > 3 && h1Text.length < 150) role = h1Text;

  const sep   = /\s*[\|–—]\s*/;
  const parts = pageTitle.split(sep).map(s => s.trim()).filter(Boolean);

  if (parts.length >= 2) {
    const last  = parts[parts.length - 1];
    const first = parts[0];
    if (!role && first.length < 120 && !/^careers?$/i.test(first)) role = first;
    if (!company && last.length < 80 && !/^careers?|jobs?|apply|hiring$/i.test(last)) company = last;
    if (!company && parts[1]) {
      const atMatch = parts[1].match(/^(?:careers?\s+at|jobs?\s+at|hiring\s+at)\s+(.+)$/i);
      if (atMatch) company = atMatch[1].trim();
    }
  }

  if (!role || !company) {
    const dashMatch = pageTitle.match(/^(.+?)\s*[-–—]\s*(.+?)(?:\s*[-–—].*)?$/);
    if (dashMatch) {
      if (!role)    role    = dashMatch[1].trim();
      if (!company) company = dashMatch[2].trim().replace(/\s*(careers?|jobs?|hiring).*$/i, '').trim();
    }
  }

  if (!role && ogTitle && ogTitle.length < 150) role = ogTitle.replace(/\s*[-–|].*$/, '').trim();

  if (!company) {
    company = host
      .replace(/^(jobs|careers|career|hiring|recruit|apply|talent)\./i, '')
      .split('.')[0]
      .replace(/-/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());
  }

  role    = role.replace(/\s*\(.*?\)\s*$/, '').trim();
  company = company.replace(/\s*(Inc\.|Ltd\.|Pvt\.?|LLC|Corp\.?)$/i, '').trim();

  // Final sanity: don't return portal names as company
  const PORTALS = ['linkedin','wellfound','greenhouse','lever','naukri','indeed','glassdoor','internshala'];
  if (PORTALS.some(p => company.toLowerCase().includes(p))) company = '';

  return { company, role };
}
