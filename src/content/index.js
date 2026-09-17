// ═══════════════════════════════════════════════════════════
//  JobAssist AI — Content Script Entry v4
//  Wires all modules. Boot → detect → extract JD → open.
// ═══════════════════════════════════════════════════════════

import { State }       from './state.js';
import { Detector }    from './detector.js';
import { Bubble }      from './bubble.js';
import { Sidebar }     from './sidebar.js';
import { Autofill }    from './autofill.js';
import { Tracker }     from './tracker.js';
import { tryExtractJd } from './jd-extractor.js';
import { AnswerTab }   from './tabs/answer.js';
import { ScoreTab }    from './tabs/score.js';
import { JdTab }       from './tabs/jd.js';
import { TailorTab }   from './tabs/tailor.js';

// Guard against double injection
if (window.__jaLoaded) throw new Error('ja-already-loaded');
window.__jaLoaded = true;

// ── Boot ─────────────────────────────────────────────────────
function boot() {
  if (!Detector.shouldActivate()) {
    // DOM-based fallback for edge cases
    let checked = false;
    function domCheck() {
      if (checked) return;
      if (Detector.getDomScore() >= 2) { checked = true; activate(); }
    }
    [200, 800, 2000, 4000].forEach(d => setTimeout(domCheck, d));
    const obs = new MutationObserver(() => { domCheck(); if (checked) obs.disconnect(); });
    if (document.body) obs.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => obs.disconnect(), 10000);
    return;
  }
  activate();
}

function activate() {
  // Build UI
  Bubble.build();
  Sidebar.build();
  Tracker.build();

  // Wire tab logic
  AnswerTab.init();
  ScoreTab.init();
  JdTab.init();
  TailorTab.init();

  // Field focus events
  document.addEventListener('focusin',  onFocusIn,  true);
  document.addEventListener('focusout', onFocusOut, true);
  document.addEventListener('mouseup',  onMouseUp,  true);

  // Bubble click → open sidebar
  document.addEventListener('ja:openSidebar', () => {
    Sidebar.open();
    AnswerTab.prefillQuestion();
  });
  // Sidebar minimize → hide bubble
  document.addEventListener('ja:hideBubble', () => Bubble.hide());

  // Autofill standard fields if enabled
  chrome.storage.local.get(['autoFill', 'autoJd'], d => {
    if (d.autoFill) Autofill.run();

    // JD extraction — silent. Only auto-opens sidebar and runs ATS on success.
    if (d.autoJd !== false) {
      setTimeout(async () => {
        try {
          const result = await tryExtractJd();
          if (result) {
            // Extraction succeeded — populate State
            State.jobDesc      = result.text;
            State.detectedRole = result.title;
            State.companyName  = result.company;

            // Populate sidebar fields
            JdTab.populate(result);

            // Auto-open sidebar + run ATS
            Sidebar.open();
            ScoreTab.run();

            // Show tracker
            Tracker.show(result.company, result.title);
          }
          // If null → nothing. Sidebar stays as toggle. No error shown.
        } catch {}
      }, 800);
    }
  });
}

// ── Field focus events ────────────────────────────────────────
function onFocusIn(e) {
  const el = e.target;
  // Never trigger on our own UI
  if (Sidebar.el?.contains(el) || Bubble.el?.contains(el) || Tracker.el?.contains(el)) return;
  if (!Detector.isApplicationField(el)) return;
  State.activeField = el;
  Bubble.show(el, State.aiFilledFields.has(el));
}

function onFocusOut() {
  setTimeout(() => {
    if (State.sidebarOpen || State.bubbleMouseDown) return;
    const f = document.activeElement;
    if (Bubble.el?.contains(f) || Sidebar.el?.contains(f)) return;
    Bubble.hide();
  }, 250);
}

function onMouseUp() {
  if (window.getSelection()?.toString().length > 0) Bubble.hide();
}

// ── DOM-ready boot ────────────────────────────────────────────
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
