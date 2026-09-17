// ── Answer Tab ───────────────────────────────────────────────
import { State }   from '../state.js';
import { Sidebar } from '../sidebar.js';
import { Detector } from '../detector.js';
import { Msg }     from '../messenger.js';

export const AnswerTab = {
  init() {
    Sidebar.q('#ja-sb-gen-btn').addEventListener('click', () => this.run());
    Sidebar.q('#ja-sb-regen').addEventListener('click',   () => this.run());
    Sidebar.q('#ja-sb-insert').addEventListener('click',  () => this.insert());
    Sidebar.q('#ja-sb-copy').addEventListener('click',    () => this.copy());
    Sidebar.q('#ja-sb-fetch-readme').addEventListener('click', () => this.fetchReadme());
    Sidebar.q('#ja-sb-question').addEventListener('input', () => this._onQuestionInput());

    // Populate repo select from stored GitHub data
    chrome.storage.local.get(['githubData', 'githubUrl'], d => {
      if (d.githubData?.repos?.length) this._populateRepos(d.githubData, d.githubUrl);
    });
  },

  // Called from index.js when sidebar opens and there's an active field
  prefillQuestion() {
    if (!State.activeField) return;
    const label = Detector.getLabel(State.activeField);
    const qEl   = Sidebar.q('#ja-sb-question');
    if (label && label.length > 3 && label.length < 500 && !qEl.value.trim()) {
      qEl.value = label;
      this._onQuestionInput();
    }
  },

  async run() {
    if (State.generating) return;
    const question = Sidebar.q('#ja-sb-question').value.trim();
    if (!question) { this._status('⚠ Paste the question first.', 'err'); return; }

    State.generating = true;
    Sidebar.q('#ja-sb-result').classList.add('ja-hidden');
    Sidebar.q('#ja-sb-gen-btn').disabled = true;
    this._status('Writing your answer…', 'loading');

    const readmeBtn     = Sidebar.q('#ja-sb-fetch-readme');
    const readmeContext = readmeBtn?.dataset.readme || null;
    const jd            = Sidebar.q('#ja-sb-jd')?.value.trim() || State.jobDesc;

    const res = await Msg.generateAnswer(question, {
      jobDescription: jd,
      fieldHint:      State.activeField ? Detector.getLabel(State.activeField) : '',
      companyName:    State.companyName,
      customPrompt:   Sidebar.q('#ja-sb-custom').value.trim(),
      readmeContext,
    });

    State.generating = false;
    Sidebar.q('#ja-sb-gen-btn').disabled = false;
    Sidebar.q('#ja-sb-status').classList.add('ja-hidden');

    if (res.error) { this._status('⚠ ' + res.error, 'err'); return; }
    Sidebar.q('#ja-sb-answer').textContent = res.answer;
    Sidebar.q('#ja-sb-result').classList.remove('ja-hidden');
  },

  insert() {
    const text = Sidebar.q('#ja-sb-answer').textContent.trim();
    if (!text || !State.activeField) return;
    _setValue(State.activeField, text);
    State.aiFilledFields.add(State.activeField);
    const btn = Sidebar.q('#ja-sb-insert');
    const orig = btn.textContent;
    btn.textContent = 'Inserted ✓';
    setTimeout(() => btn.textContent = orig, 1800);
    setTimeout(() => State.activeField?.focus(), 50);
  },

  copy() {
    const text = Sidebar.q('#ja-sb-answer').textContent.trim();
    navigator.clipboard.writeText(text).then(() => {
      const btn = Sidebar.q('#ja-sb-copy');
      const o = btn.textContent;
      btn.textContent = 'Copied ✓';
      setTimeout(() => btn.textContent = o, 1800);
    });
  },

  async fetchReadme() {
    const val = Sidebar.q('#ja-sb-repo-select').value;
    if (!val) return;
    const [owner, repo] = val.split('|');
    const statusEl = Sidebar.q('#ja-sb-readme-status');
    statusEl.textContent = '⏳ Fetching README…';
    statusEl.className = 'ja-sb-fetch-status loading';
    statusEl.classList.remove('ja-hidden');
    Sidebar.q('#ja-sb-fetch-readme').disabled = true;

    const res = await Msg.fetchReadme(owner, repo);
    Sidebar.q('#ja-sb-fetch-readme').disabled = false;

    if (res.error) {
      statusEl.textContent = `⚠ ${res.error}`;
      statusEl.className = 'ja-sb-fetch-status error';
    } else {
      Sidebar.q('#ja-sb-fetch-readme').dataset.readme = res.readme;
      statusEl.textContent = `✓ Loaded README for ${repo}`;
      statusEl.className = 'ja-sb-fetch-status ok';
    }
  },

  _onQuestionInput() {
    const q = Sidebar.q('#ja-sb-question').value.toLowerCase();
    const projectWords = ['project','repo','github','built','developed','created','describe your'];
    const show = projectWords.some(w => q.includes(w));
    Sidebar.q('#ja-sb-readme-row').classList.toggle('ja-hidden', !show);
  },

  _populateRepos(githubData, githubUrl) {
    const select = Sidebar.q('#ja-sb-repo-select');
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
  },

  _status(msg, type) {
    const el = Sidebar.q('#ja-sb-status');
    el.textContent = msg;
    el.className = type === 'err' ? 'ja-sb-status err' : 'ja-sb-status loading';
    el.classList.remove('ja-hidden');
  },
};

// ── setValue (React/Vue/Google Forms compatible) ──────────────
function _setValue(el, text) {
  const isGF = location.hostname.includes('docs.google.com') && location.pathname.includes('/forms/');
  if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
    if (isGF) { _setGF(el, text); return; }
    const proto = Object.getOwnPropertyDescriptor(
      el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value'
    );
    if (proto?.set) proto.set.call(el, text); else el.value = text;
    ['input','change','blur'].forEach(ev => el.dispatchEvent(new Event(ev, { bubbles: true })));
  } else if (el.getAttribute?.('contenteditable') === 'true') {
    el.innerText = text;
    el.dispatchEvent(new InputEvent('input', { bubbles: true }));
  }
}

function _setGF(el, text) {
  el.focus(); el.click();
  el.value = '';
  el.dispatchEvent(new Event('input', { bubbles: true }));
  const proto = Object.getOwnPropertyDescriptor(
    el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value'
  );
  if (proto?.set) proto.set.call(el, text); else el.value = text;
  el.dispatchEvent(new Event('focus', { bubbles: true }));
  el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
  el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
  el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.dispatchEvent(new Event('blur',   { bubbles: true }));
}
