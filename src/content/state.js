// ── Single page-level state object ──────────────────────────
// Everything that needs to be shared between modules lives here.
// No scattered let variables across files.

export const State = {
  activeField:     null,    // currently focused application field element
  jobDesc:         null,    // extracted or user-pasted JD text
  companyName:     '',      // detected company (blank if unsure)
  detectedRole:    '',      // detected role (blank if unsure)
  sidebarOpen:     false,
  generating:      false,
  atsData:         null,    // last ATS result object
  lastAnalyzedJd:  '',      // JD text that was last sent to ATS
  aiFilledFields:  new WeakSet(), // fields that already got AI answers
  appLogged:       false,
  bubbleMouseDown: false,
  readmeCache:     {},      // repo → readme text cache
};
