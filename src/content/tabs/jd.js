// ── JD Tab ───────────────────────────────────────────────────
import { State }   from '../state.js';
import { Sidebar } from '../sidebar.js';
import { Msg }     from '../messenger.js';
import { ScoreTab } from './score.js';

export const JdTab = {
  init() {
    Sidebar.q('#ja-sb-jd-save').addEventListener('click',  () => this.save());
    Sidebar.q('#ja-sb-jd-fetch').addEventListener('click', () => this.fetchUrl());
  },

  // Populate fields from extraction result
  populate(result) {
    Sidebar.populate(result);
  },

  async save() {
    const jd      = Sidebar.q('#ja-sb-jd').value.trim();
    const role    = Sidebar.q('#ja-sb-jd-role').value.trim();
    const company = Sidebar.q('#ja-sb-jd-company').value.trim();

    if (!jd) return;
    State.jobDesc     = jd;
    State.detectedRole = role;
    State.companyName  = company;

    const jobbar = Sidebar.q('#ja-sb-jobbar');
    if (role || company) {
      jobbar.classList.remove('ja-hidden');
      if (role)    Sidebar.q('#ja-sb-role').textContent    = role;
      if (company) Sidebar.q('#ja-sb-company-tag').textContent = company;
    }

    Sidebar.switchTab('score');
    await ScoreTab.run();
  },

  async fetchUrl() {
    const url      = Sidebar.q('#ja-sb-jd-link').value.trim();
    if (!url) return;
    const statusEl = Sidebar.q('#ja-sb-jd-fetch-status');
    statusEl.textContent = '⏳ Fetching…';
    statusEl.className = 'ja-sb-fetch-status loading';
    statusEl.classList.remove('ja-hidden');
    Sidebar.q('#ja-sb-jd-fetch').disabled = true;

    const res = await Msg.fetchUrl(url);
    Sidebar.q('#ja-sb-jd-fetch').disabled = false;

    if (res.error) {
      statusEl.textContent = `⚠ ${res.error}`;
      statusEl.className = 'ja-sb-fetch-status error';
    } else {
      Sidebar.q('#ja-sb-jd').value = res.text;
      State.jobDesc = res.text;
      statusEl.textContent = `✓ Loaded ${res.text.length} chars`;
      statusEl.className = 'ja-sb-fetch-status ok';
    }
  },
};
