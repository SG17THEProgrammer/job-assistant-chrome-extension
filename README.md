# JobAssist AI — Chrome Extension v2

AI-powered job application assistant. Auto-fills forms, tailors your resume to the JD, and shows ATS keywords — powered by Gemini.

---

## Quick Setup (5 min)

### 1. Load in Chrome
1. Go to `chrome://extensions`
2. Enable **Developer mode** (top-right)
3. Click **Load unpacked** → select this folder
4. Pin the **JobAssist AI** icon to your toolbar

### 2. Configure (one time)

**Profile tab**
- Upload your resume (PDF or TXT, max 1MB)
- Add your name, LinkedIn URL, GitHub URL
- Add extra context: career goals, work style, salary range etc.

**API tab**
- Get a free Gemini API key at [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey)
- Paste it in → click **Test connection**

**Preferences tab**
- Pick answer style: Concise / Balanced / Detailed
- Pick tone: Professional / Conversational / Enthusiastic / Formal
- Add custom instructions (e.g. "always mention my open-source work")
- Toggle **Auto-fill on focus** if you want answers inserted the moment you click a field

---

## Using it on Job Portals

1. Open any job listing (LinkedIn, Workday, Greenhouse, Lever, Indeed, Naukri, etc.)
2. Click into any application text field
3. The **"Answer with AI"** bubble appears above the field
4. Click it → the panel opens with the question pre-filled
5. Click **Generate & fill** → answer is inserted directly into the field
6. If you click the same field again → bubble shows **"Re-answer with AI"**

The extension auto-detects the job description from the page and uses it for more tailored answers.

---

## Resume Tailoring

1. Open the extension popup → **Resume** tab
2. Paste the job description
3. Optionally add style instructions ("keep to 1 page, use bullet points")
4. Click **Tailor my resume**
5. Review the **ATS score**, matched keywords, and missing keywords
6. Use the **edit prompt** to refine in plain English: *"Add more detail on my Python projects"*
7. Click **Download tailored PDF** → Chrome opens a print-ready page → Save as PDF

---

## GitHub & LinkedIn Integration

### GitHub (works automatically)
Click the verify button next to your GitHub URL. The extension calls the GitHub public API to fetch:
- Your bio and public repo count
- Your top 10 most recently updated repos (name, description, language, stars)

This data is stored locally and injected into every answer as context.
**No login needed** — works with any public profile.

### LinkedIn (URL-as-context for now)
LinkedIn's API requires an approved OAuth app (they don't give access easily).

**Current behaviour:** Your LinkedIn URL is saved and mentioned in every AI prompt as context. The AI uses it to understand you're providing it, but can't read your profile data.

**To get full LinkedIn data (advanced):**
1. Register a LinkedIn Developer App at [developer.linkedin.com](https://developer.linkedin.com)
2. Request `r_liteprofile` and `r_emailaddress` scopes
3. Implement OAuth 2.0 flow — the extension's `identity` permission supports this
4. Store the access token and call `https://api.linkedin.com/v2/me`

This is intentionally left as a future step since LinkedIn approval takes time.

---

## Companies Database

In the **Companies** tab, save notes per company:
- Culture values, tech stack, recent news
- Why you want to work there
- Relevant projects to highlight

These notes are automatically injected when you apply on that company's portal.

---

## File Structure

```
job-assist-extension/
├── manifest.json
├── popup/
│   ├── popup.html        # Settings UI (5 tabs)
│   ├── popup.css
│   └── popup.js          # UI logic, GitHub API fetch
├── content/
│   ├── content.js        # Field detection, bubble, panel, auto-fill
│   └── widget.css        # Injected styles (all !important)
├── background/
│   └── service-worker.js # Gemini API, resume tailoring, PDF gen
└── assets/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## Supported Job Portals

Tested selectors for auto-detecting job descriptions:
- LinkedIn (`description__text`)
- Indeed (`jobsearch-jobDescriptionText`)
- Workday (`data-testid="job-description"`)
- Greenhouse (`.posting-description`)
- Lever (`.posting-description`)
- Naukri, Internshala, AngelList, and most others via fallback largest-text-block detection

---

## Privacy

- Your resume, API key, GitHub data, and company notes are stored **only in Chrome's local storage** on your machine
- The only external calls are: Gemini API (for answer generation), GitHub public API (for profile data)
- No data is sent to any other server

---

## On your resume

> **JobAssist AI** — Chrome Extension  
> Built a Manifest V3 Chrome extension that injects an AI assistant into any job portal. Uses content scripts to detect application form fields across frameworks (React, Vue, plain HTML, contenteditable), auto-extracts job descriptions from career portals, and calls the Gemini API to generate personalized, ATS-optimised answers based on the user's resume, GitHub, and LinkedIn. Includes a resume tailoring feature that rewrites the resume to match a JD and scores ATS keyword coverage.  
> *Stack: Chrome Extension API · Manifest V3 · Gemini API · GitHub API · Vanilla JS*

---

## Roadmap ideas
- [ ] Cover letter one-click generator
- [ ] Answer history per company
- [ ] ATS keyword highlighting overlay on the JD itself
- [ ] LinkedIn OAuth (when app is approved)
- [ ] Multiple resume versions (aggressive, conservative)
- [ ] Export application history to CSV
