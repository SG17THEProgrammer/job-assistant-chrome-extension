function load(keys) { return new Promise(r => chrome.storage.local.get(keys, r)); }

export async function handleLogApplication({ company, role, url, jd, date }) {
  const s = await load(['applications']);
  const apps = s.applications || [];
  const entry = {
    id:      Date.now(),
    company: company || 'Unknown',
    role:    role    || 'Unknown',
    url:     url     || '',
    jd:      (jd || '').slice(0, 500),
    date:    date || new Date().toISOString(),
    status:  'Applied',
  };
  apps.unshift(entry);
  await new Promise(r => chrome.storage.local.set({ applications: apps.slice(0, 200) }, r));
  return { ok: true, entry };
}
