function load(keys) { return new Promise(r => chrome.storage.local.get(keys, r)); }

export async function handleRefreshGitHub({ githubUrl } = {}) {
  if (!githubUrl) {
    const s = await load(['githubUrl']);
    githubUrl = s.githubUrl;
  }
  if (!githubUrl) return { error: 'No GitHub URL saved.' };

  let handle;
  try {
    handle = new URL(githubUrl).pathname.split('/').filter(Boolean)[0];
  } catch { return { error: 'Invalid GitHub URL.' }; }

  try {
    const [uRes, rRes] = await Promise.all([
      fetch(`https://api.github.com/users/${handle}`, { headers: { 'Accept': 'application/vnd.github.v3+json' } }),
      fetch(`https://api.github.com/users/${handle}/repos?sort=updated&per_page=20`, { headers: { 'Accept': 'application/vnd.github.v3+json' } }),
    ]);
    if (!uRes.ok) return { error: `GitHub user not found (${uRes.status})` };
    const user  = await uRes.json();
    const repos = await rRes.json();
    const githubData = {
      name:        user.name || handle,
      bio:         user.bio  || '',
      followers:   user.followers,
      following:   user.following,
      publicRepos: user.public_repos,
      avatarUrl:   user.avatar_url,
      htmlUrl:     user.html_url,
      fetchedAt:   Date.now(),
      repos: repos.map(r => ({
        name:        r.name,
        description: r.description || '',
        stars:       r.stargazers_count,
        forks:       r.forks_count,
        language:    r.language,
        url:         r.html_url,
        topics:      r.topics || [],
        updatedAt:   r.updated_at,
      })),
    };
    await new Promise(r => chrome.storage.local.set({ githubData }, r));
    return { ok: true, githubData };
  } catch (e) {
    return { error: `GitHub fetch failed: ${e.message}` };
  }
}

export async function handleFetchGithubReadme({ owner, repo }) {
  if (!owner || !repo) return { error: 'owner and repo required.' };
  try {
    for (const branch of ['main', 'master']) {
      const res = await fetch(
        `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/README.md`,
        { signal: AbortSignal.timeout(8000) }
      );
      if (res.ok) {
        const text = await res.text();
        return { ok: true, readme: text.slice(0, 4000), repo, branch };
      }
    }
    const apiRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/readme`,
      { headers: { 'Accept': 'application/vnd.github.v3.raw' } }
    );
    if (apiRes.ok) {
      const text = await apiRes.text();
      return { ok: true, readme: text.slice(0, 4000), repo, branch: 'api' };
    }
    return { error: `No README found for ${owner}/${repo}` };
  } catch (e) {
    return { error: `Failed to fetch README: ${e.message}` };
  }
}
