export async function handleFetchUrl({ url }) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html,application/xhtml+xml' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return { error: `Could not access the link (HTTP ${res.status}). Please paste the job description directly.` };
    const html = await res.text();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/\s+/g, ' ').trim()
      .slice(0, 6000);
    if (text.length < 100) return { error: 'Could not read content from this link. Paste the job description directly.' };
    return { text };
  } catch (e) {
    if (e.name === 'TimeoutError') return { error: 'Link timed out after 10s. Paste the job description directly.' };
    return { error: `Could not access the link: ${e.message}. Paste the job description directly.` };
  }
}
