// ── Tailor Tab ───────────────────────────────────────────────
import { State }   from '../state.js';
import { Sidebar } from '../sidebar.js';
import { Msg }     from '../messenger.js';

export const TailorTab = {
  init() {
    Sidebar.q('#ja-sb-tailor-btn').addEventListener('click',   () => this.run());
    Sidebar.q('#ja-sb-tailor-pdf').addEventListener('click',   () => this.pdf());
    Sidebar.q('#ja-sb-tailor-apply').addEventListener('click', () => this.edit());
  },

  async run() {
    const jd = Sidebar.q('#ja-sb-jd')?.value.trim() || State.jobDesc;
    if (!jd) {
      Sidebar.switchTab('jd');
      this._msg('⚠ Paste the job description in Job Info tab first.', true);
      return;
    }

    const loadEl   = Sidebar.q('#ja-sb-tailor-loading');
    const resultEl = Sidebar.q('#ja-sb-tailor-result');
    const btn      = Sidebar.q('#ja-sb-tailor-btn');

    loadEl.classList.remove('ja-hidden');
    resultEl.classList.add('ja-hidden');
    btn.disabled = true;

    const res = await Msg.tailorResume(jd, Sidebar.q('#ja-sb-tailor-style').value.trim());
    loadEl.classList.add('ja-hidden');
    btn.disabled = false;

    if (res.error) { this._msg('⚠ ' + res.error, true); return; }

    await chrome.storage.local.set({ tailoredResumeText: res.tailoredResume });

    const score = res.atsScore || 0;
    Sidebar.q('#ja-sb-tailor-score-num').textContent = `${score}%`;
    const fill = Sidebar.q('#ja-sb-tailor-fill');
    fill.style.width      = `${score}%`;
    fill.style.background = score >= 70 ? '#16A34A' : score >= 40 ? '#D97706' : '#DC2626';

    _renderChips('#ja-sb-tailor-matched', res.matchedKeywords || [], false);
    _renderChips('#ja-sb-tailor-missing', res.missingKeywords || [], true);

    resultEl.classList.remove('ja-hidden');
    this._msg(`✓ Resume tailored (ATS ${score}%)`, false);
  },

  async edit() {
    const prompt = Sidebar.q('#ja-sb-tailor-edit').value.trim();
    if (!prompt) return;
    const btn = Sidebar.q('#ja-sb-tailor-apply');
    btn.disabled = true;
    btn.textContent = '…';

    const res = await Msg.editResume(prompt);
    btn.disabled = false;
    btn.textContent = 'Apply';

    if (res.error) { this._msg('⚠ ' + res.error, true); return; }
    await chrome.storage.local.set({ tailoredResumeText: res.tailoredResume });
    Sidebar.q('#ja-sb-tailor-edit').value = '';
    this._msg('✓ Resume updated', false);
  },

  async pdf() {
    const res = await Msg.generatePdf();
    if (res.error) this._msg('⚠ ' + res.error, true);
  },

  _msg(msg, isErr) {
    const el = Sidebar.q('#ja-sb-tailor-msg');
    el.textContent = msg;
    el.className = isErr ? 'ja-sb-status err' : 'ja-sb-status loading';
    el.classList.remove('ja-hidden');
    if (!isErr) setTimeout(() => el.classList.add('ja-hidden'), 3000);
  },
};

function _renderChips(selector, words, isMissing) {
  const el = Sidebar.q(selector);
  if (!el) return;
  el.innerHTML = '';
  if (!words.length) { el.innerHTML = '<span class="ja-sb-muted">None</span>'; return; }
  words.forEach(w => {
    const chip = document.createElement('span');
    chip.className = `ja-sb-chip${isMissing ? ' miss' : ''}`;
    chip.textContent = w;
    el.appendChild(chip);
  });
}
