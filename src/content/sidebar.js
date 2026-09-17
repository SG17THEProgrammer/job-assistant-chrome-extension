// ── Sidebar ───────────────────────────────────────────────────
// Fixed 300px right panel. Builds HTML shell only.
// Tabs wire their own logic in their own files.

import { State } from './state.js';

let el = null;

export const Sidebar = {
  get el() { return el; },

  build() {
    el = document.createElement('div');
    el.id = 'ja-sidebar';
    el.innerHTML = `
      <div id="ja-sb-header">
        <div id="ja-sb-logo">
          <div id="ja-sb-mark">JA</div>
          <span id="ja-sb-title">JobAssist <em>AI</em></span>
        </div>
        <div id="ja-sb-header-actions">
          <button id="ja-sb-refresh" title="Re-run ATS" type="button">↻</button>
          <button id="ja-sb-minimize" title="Minimize" type="button">‹</button>
        </div>
      </div>

      <div id="ja-sb-jobbar" class="ja-hidden">
        <div id="ja-sb-role"></div>
        <div id="ja-sb-company-tag"></div>
      </div>

      <div id="ja-sb-tabs">
        <button class="ja-sb-tab active" data-tab="answer">Answer</button>
        <button class="ja-sb-tab" data-tab="score">ATS Score</button>
        <button class="ja-sb-tab" data-tab="jd">Job Info</button>
        <button class="ja-sb-tab" data-tab="tailor">Tailor</button>
      </div>

      <!-- Answer tab -->
      <div class="ja-sb-pane active" id="ja-sb-pane-answer">
        <div class="ja-sb-field">
          <label class="ja-sb-label">Question</label>
          <textarea id="ja-sb-question" rows="3" placeholder="Paste question or click a field to auto-fill…"></textarea>
        </div>
        <div class="ja-sb-field">
          <label class="ja-sb-label">Custom instruction <span class="ja-sb-opt">optional</span></label>
          <textarea id="ja-sb-custom" rows="2" placeholder='e.g. "Focus on my n8n project"'></textarea>
        </div>
        <div id="ja-sb-readme-row" class="ja-hidden">
          <label class="ja-sb-label">📂 Fetch project README</label>
          <div class="ja-sb-row">
            <select id="ja-sb-repo-select" class="ja-sb-select"><option value="">Select repo…</option></select>
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

      <!-- ATS Score tab -->
      <div class="ja-sb-pane" id="ja-sb-pane-score">
        <div id="ja-sb-ats-loading" class="ja-sb-loading-row ja-hidden">
          <div class="ja-sb-spinner"></div><span>Analyzing resume vs JD…</span>
        </div>
        <div id="ja-sb-ats-empty">
          <p class="ja-sb-muted">Paste the job description in Job Info tab first.</p>
          <button id="ja-sb-run-ats" class="ja-sb-btn-primary" type="button" style="margin-top:10px;width:100%">Analyze now</button>
        </div>
        <div id="ja-sb-ats-result" class="ja-hidden">
          <div id="ja-sb-score-ring-wrap">
            <div id="ja-sb-ring-container">
              <svg id="ja-sb-score-svg" viewBox="0 0 80 80" width="80" height="80">
                <circle cx="40" cy="40" r="34" fill="none" stroke="#E5E7EB" stroke-width="7"/>
                <circle id="ja-sb-score-arc" cx="40" cy="40" r="34" fill="none"
                  stroke="#4F46E5" stroke-width="7" stroke-linecap="round"
                  stroke-dasharray="213.6" stroke-dashoffset="213.6"
                  transform="rotate(-90 40 40)"/>
              </svg>
              <div id="ja-sb-score-num">—</div>
            </div>
            <div id="ja-sb-score-text">
              <div id="ja-sb-score-label">Awaiting analysis</div>
            </div>
          </div>
          <div id="ja-sb-ats-tip" class="ja-hidden"></div>
          <div>
            <p class="ja-sb-kw-title">Matched</p>
            <div class="ja-sb-chips" id="ja-sb-matched-chips"></div>
          </div>
          <div>
            <p class="ja-sb-kw-title missing">Missing</p>
            <div class="ja-sb-chips" id="ja-sb-missing-chips"></div>
          </div>
        </div>
      </div>

      <!-- Job Info tab -->
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
          <textarea id="ja-sb-jd" rows="8" placeholder="Auto-detected or paste here…"></textarea>
        </div>
        <div class="ja-sb-row">
          <input type="url" id="ja-sb-jd-link" class="ja-sb-input" placeholder="Or paste JD URL…" />
          <button id="ja-sb-jd-fetch" class="ja-sb-btn-sm" type="button">Fetch</button>
        </div>
        <div id="ja-sb-jd-fetch-status" class="ja-hidden"></div>
        <button id="ja-sb-jd-save" class="ja-sb-btn-primary" type="button" style="margin-top:8px">Save &amp; analyze</button>
      </div>

      <!-- Tailor tab -->
      <div class="ja-sb-pane" id="ja-sb-pane-tailor">
        <p class="ja-sb-muted">Rewrite your resume to match this job's ATS keywords.</p>
        <div class="ja-sb-field">
          <label class="ja-sb-label">Style instructions <span class="ja-sb-opt">optional</span></label>
          <textarea id="ja-sb-tailor-style" rows="2" placeholder='e.g. "Keep to 1 page, bullet points"'></textarea>
        </div>
        <button id="ja-sb-tailor-btn" type="button" class="ja-sb-btn-primary">✦ Tailor my resume</button>
        <div id="ja-sb-tailor-loading" class="ja-sb-loading-row ja-hidden">
          <div class="ja-sb-spinner"></div><span>Tailoring resume…</span>
        </div>
        <div id="ja-sb-tailor-result" class="ja-hidden">
          <div id="ja-sb-tailor-ats-bar">
            <span class="ja-sb-tailor-ats-label">ATS score</span>
            <div class="ja-sb-tailor-track"><div id="ja-sb-tailor-fill"></div></div>
            <span id="ja-sb-tailor-score-num">—</span>
          </div>
          <div class="ja-sb-field" style="gap:4px">
            <p class="ja-sb-kw-title">Matched</p>
            <div class="ja-sb-chips" id="ja-sb-tailor-matched"></div>
            <p class="ja-sb-kw-title missing">Missing</p>
            <div class="ja-sb-chips" id="ja-sb-tailor-missing"></div>
          </div>
          <div class="ja-sb-field">
            <label class="ja-sb-label">Edit in plain English</label>
            <div class="ja-sb-row">
              <input type="text" id="ja-sb-tailor-edit" class="ja-sb-input" placeholder='e.g. "More on my Python work"' />
              <button id="ja-sb-tailor-apply" class="ja-sb-btn-sm" type="button">Apply</button>
            </div>
          </div>
          <button id="ja-sb-tailor-pdf" type="button" class="ja-sb-btn-primary">Download PDF</button>
        </div>
        <div id="ja-sb-tailor-msg" class="ja-hidden"></div>
      </div>

      <!-- Toggle tab (shown when sidebar is minimized) -->
      <div id="ja-sb-toggle-tab" title="Open JobAssist AI">
        <div id="ja-sb-toggle-mark">JA</div>
        <span id="ja-sb-toggle-label">JobAssist AI</span>
      </div>
    `;

    document.body.appendChild(el);

    // Tab switching
    el.querySelectorAll('.ja-sb-tab').forEach(tab => {
      tab.addEventListener('click', () => this.switchTab(tab.dataset.tab));
    });

    el.querySelector('#ja-sb-minimize').addEventListener('click', () => this.minimize());
    el.querySelector('#ja-sb-toggle-tab').addEventListener('click', () => this.open());

    // Start minimized — will auto-open only if JD extraction succeeds
    this.minimize(true);
  },

  open() {
    if (!el) return;
    el.classList.remove('ja-minimized');
    el.classList.add('ja-open');
    State.sidebarOpen = true;
    // Signal bubble to hide
    document.dispatchEvent(new CustomEvent('ja:hideBubble'));
  },

  minimize(immediate = false) {
    if (!el) return;
    el.classList.add('ja-minimized');
    el.classList.remove('ja-open');
    State.sidebarOpen = false;
  },

  switchTab(tab) {
    el.querySelectorAll('.ja-sb-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    el.querySelectorAll('.ja-sb-pane').forEach(p => p.classList.toggle('active', p.id === `ja-sb-pane-${tab}`));
  },

  // Populate job bar and Job Info fields from extracted JD data
  populate(result) {
    if (!el) return;
    if (result.text) {
      const jdEl = el.querySelector('#ja-sb-jd');
      if (jdEl && !jdEl.value.trim()) jdEl.value = result.text.slice(0, 8000);
    }
    const jobbar = el.querySelector('#ja-sb-jobbar');
    if (result.title) {
      el.querySelector('#ja-sb-role').textContent    = result.title;
      el.querySelector('#ja-sb-jd-role').value       = result.title;
      jobbar.classList.remove('ja-hidden');
    }
    if (result.company) {
      el.querySelector('#ja-sb-company-tag').textContent = result.company;
      el.querySelector('#ja-sb-jd-company').value        = result.company;
      jobbar.classList.remove('ja-hidden');
    }
  },

  q(selector) {
    return el?.querySelector(selector);
  },
};
