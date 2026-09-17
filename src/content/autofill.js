// ── Autofill ─────────────────────────────────────────────────
// Detects standard fields (name, email, phone, etc.) and fills
// them from the user's saved profile. No AI needed.

import { Detector } from './detector.js';

const DEGREE_LABELS = {
  btech:'B.Tech / B.E.', bsc:'B.Sc', bca:'BCA', bcom:'B.Com', ba:'B.A.',
  mtech:'M.Tech / M.E.', msc:'M.Sc', mca:'MCA', mba:'MBA', phd:'Ph.D',
  diploma:'Diploma', other:'Other',
};

const PROFILE_KEYS = [
  'firstName','lastName','email','phone','dob',
  'city','state','country','zipcode',
  'linkedinUrl','githubUrl','portfolioUrl',
  'currentCtc','expectedCtc','noticePeriod','experience',
  'degree','college','gradYear','cgpa',
];

function getFieldMapping(combined, p) {
  if (/\bfirst.?name\b/.test(combined))                               return p.firstName;
  if (/\blast.?name\b|surname/.test(combined))                        return p.lastName;
  if (/\bfull.?name\b/.test(combined))                                return [p.firstName,p.lastName].filter(Boolean).join(' ');
  if (/\bemail\b/.test(combined))                                      return p.email;
  if (/\bphone\b|\bmobile\b|\bcontact.?no\b/.test(combined))          return p.phone;
  if (/dob|date.?of.?birth|birth.?date/.test(combined))               return p.dob;
  if (/\bcity\b/.test(combined))                                       return p.city;
  if (/\bstate\b|\bprovince\b/.test(combined))                         return p.state;
  if (/\bcountry\b/.test(combined))                                    return p.country;
  if (/\bzip\b|\bpincode\b|\bpostal\b/.test(combined))                return p.zipcode;
  if (/\blinkedin\b/.test(combined))                                   return p.linkedinUrl;
  if (/\bgithub\b/.test(combined))                                     return p.githubUrl;
  if (/\bportfolio\b|\bwebsite\b|\bpersonal.?site\b/.test(combined))  return p.portfolioUrl;
  if (/current.?(ctc|salary|compensation)/.test(combined))             return p.currentCtc;
  if (/expected.?(ctc|salary|compensation)/.test(combined))            return p.expectedCtc;
  if (/notice.?period/.test(combined))                                  return p.noticePeriod;
  if (/years?.?of?.?exp|total.?exp/.test(combined))                   return p.experience;
  if (/\bcollege\b|\buniversity\b|\binstitut/.test(combined))          return p.college;
  if (/\bdegree\b|\bqualification\b/.test(combined))                   return DEGREE_LABELS[p.degree] || p.degree;
  if (/graduation.?year|passing.?year/.test(combined))                 return p.gradYear;
  if (/\bcgpa\b|\bpercentage\b|\bgpa\b/.test(combined))               return p.cgpa;
  return null;
}

export const Autofill = {
  async run() {
    let attempts = 0;

    const tryFill = async () => {
      attempts++;
      const profile = await new Promise(r => chrome.storage.local.get(PROFILE_KEYS, r));
      const fields  = document.querySelectorAll(
        'input[type="text"],input[type="email"],input[type="tel"],input[type="url"],textarea,select'
      );
      let filled = 0;

      for (const el of fields) {
        if (el.value?.trim()) continue;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') continue;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;
        if (el.disabled || el.readOnly) continue;

        const combined = [
          el.name, el.id, el.placeholder,
          el.getAttribute('aria-label'),
          el.getAttribute('autocomplete'),
          el.getAttribute('data-automation-id'),
          Detector.getLabel(el),
        ].filter(Boolean).join(' ').toLowerCase();

        const val = getFieldMapping(combined, profile);
        if (val) {
          setValue(el, val);
          flashField(el);
          filled++;
          await new Promise(r => setTimeout(r, 80));
        }
      }

      if (filled === 0 && attempts < 6) setTimeout(tryFill, 700);
    };

    setTimeout(tryFill, 800);
  },
};

function flashField(el) {
  const prev = el.style.outline;
  el.style.outline = '2px solid #4F46E5';
  setTimeout(() => el.style.outline = prev, 1200);
}

export function setValue(el, text) {
  const isGF = location.hostname.includes('docs.google.com') && location.pathname.includes('/forms/');
  if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
    if (isGF) { setGF(el, text); return; }
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

function setGF(el, text) {
  el.focus(); el.click();
  el.value = '';
  el.dispatchEvent(new Event('input', { bubbles: true }));
  const proto = Object.getOwnPropertyDescriptor(
    el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value'
  );
  if (proto?.set) proto.set.call(el, text); else el.value = text;
  ['focus','keydown','input','keyup','change','blur'].forEach(ev =>
    el.dispatchEvent(ev === 'input'
      ? new InputEvent(ev, { bubbles: true, inputType: 'insertText', data: text })
      : new Event(ev, { bubbles: true }))
  );
}
