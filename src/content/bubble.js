// ── Bubble ───────────────────────────────────────────────────
// The small pill that appears above a focused application field.
// Clicking it opens the sidebar.

import { State } from './state.js';

let el = null;

export const Bubble = {
  get el() { return el; },

  build() {
    el = document.createElement('div');
    el.id = 'ja-bubble';
    el.innerHTML = `<span class="ja-bubble-label">✦ Answer with AI</span>`;

    el.addEventListener('mouseenter', () => { State.bubbleMouseDown = false; });
    el.addEventListener('mousedown', e => {
      e.preventDefault();
      e.stopPropagation();
      State.bubbleMouseDown = true;
    });
    el.addEventListener('mouseup', e => {
      e.preventDefault();
      e.stopPropagation();
      if (State.bubbleMouseDown) {
        State.bubbleMouseDown = false;
        // Dispatch custom event that index.js will handle to open sidebar
        document.dispatchEvent(new CustomEvent('ja:openSidebar'));
      }
    });

    document.body.appendChild(el);
    this.hide();
  },

  show(field, isRegen) {
    if (!el) return;
    const label = el.querySelector('.ja-bubble-label');
    label.textContent = isRegen ? '↺ Re-answer with AI' : '✦ Answer with AI';
    el.dataset.regen = isRegen ? '1' : '';
    this._position(field);
    el.style.visibility = 'visible';
    el.style.opacity    = '1';
  },

  hide() {
    if (!el) return;
    el.style.opacity    = '0';
    el.style.visibility = 'hidden';
  },

  _position(field) {
    const rect = field.getBoundingClientRect();
    let top  = rect.top - 36;
    let left = rect.right - 185;

    if (left < 4) left = 4;
    // Keep clear of the 300px sidebar on the right
    const maxLeft = window.innerWidth - 300 - 195;
    if (left > maxLeft) left = maxLeft;
    if (top < 4) top = rect.bottom + 4;

    el.style.position = 'fixed';
    el.style.top      = top  + 'px';
    el.style.left     = left + 'px';
  },
};
