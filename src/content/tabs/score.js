// ── Score Tab ────────────────────────────────────────────────
import { State }   from '../state.js';
import { Sidebar } from '../sidebar.js';
import { Msg }     from '../messenger.js';

export const ScoreTab = {
  init() {
    Sidebar.q('#ja-sb-run-ats').addEventListener('click',    () => this.run());
    Sidebar.q('#ja-sb-refresh').addEventListener('click',    () => this.run(true));
  },

  async run(force = false) {
    const jd = Sidebar.q('#ja-sb-jd')?.value.trim() || State.jobDesc;
    if (!jd) { Sidebar.switchTab('jd'); return; }

    // Skip if same JD and we already have results (unless forced)
    if (!force && jd === State.lastAnalyzedJd && State.atsData) return;

    const loadEl   = Sidebar.q('#ja-sb-ats-loading');
    const emptyEl  = Sidebar.q('#ja-sb-ats-empty');
    const resultEl = Sidebar.q('#ja-sb-ats-result');

    loadEl.classList.remove('ja-hidden');
    emptyEl.classList.add('ja-hidden');
    resultEl.classList.add('ja-hidden');

    const res = await Msg.runAts(jd);
    loadEl.classList.add('ja-hidden');

    if (res.error) {
      emptyEl.innerHTML = `
        <p class="ja-sb-muted" style="color:#DC2626;margin-bottom:8px">⚠ ${res.error}</p>
        <button id="ja-sb-run-ats" class="ja-sb-btn-primary" type="button" style="width:100%">Try again</button>`;
      emptyEl.classList.remove('ja-hidden');
      emptyEl.querySelector('#ja-sb-run-ats')?.addEventListener('click', () => this.run(true));
      return;
    }

    State.lastAnalyzedJd = jd;
    State.atsData = res;

    const score = res.score || 0;
    const arc   = Sidebar.q('#ja-sb-score-arc');
    arc.style.strokeDashoffset = 213.6 - (score / 100) * 213.6;
    arc.style.stroke = score >= 70 ? '#16A34A' : score >= 40 ? '#D97706' : '#DC2626';

    Sidebar.q('#ja-sb-score-num').textContent   = `${score}%`;
    const label = score >= 70 ? 'Strong match ✓' : score >= 40 ? 'Moderate match' : 'Low match';
    const color = score >= 70 ? '#16A34A'         : score >= 40 ? '#D97706'        : '#DC2626';
    const labelEl = Sidebar.q('#ja-sb-score-label');
    labelEl.textContent = label;
    labelEl.style.color = color;

    const tipEl = Sidebar.q('#ja-sb-ats-tip');
    if (res.tip) { tipEl.textContent = '💡 ' + res.tip; tipEl.classList.remove('ja-hidden'); }
    else           tipEl.classList.add('ja-hidden');

    _renderChips('#ja-sb-matched-chips', res.matched || [], false);
    _renderChips('#ja-sb-missing-chips', res.missing || [], true);

    resultEl.classList.remove('ja-hidden');
    Sidebar.switchTab('score');
  },
};

function _renderChips(selector, words, isMissing) {
  const el = Sidebar.q(selector);
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
