import { readFileSync, writeFileSync, renameSync, copyFileSync, existsSync } from 'node:fs';
import { validateRepos } from './repos.js';

const MAX_BYTES = 256 * 1024;

// GitHub 저장소의 repos.json을 주기적으로 가져와 REPOS_FILE에 반영한다.
// - 검증에 실패하면 현재 파일을 건드리지 않는다 (잘못된 PR/커밋이 서비스를 깨뜨리지 않음)
// - ETag 조건부 요청으로 변경이 없으면 304 (API 한도 소모 없음)
// - 덮어쓰기 전에 repos.json.bak으로 백업
export function createRepoSync({
  repo, branch = 'main', path = 'data/repos.json', token, file,
  fetchImpl = fetch, now = Date.now, onError = () => {},
}) {
  let etag = null;
  const status = { enabled: Boolean(repo), lastCheckedAt: null, lastChangedAt: null, ok: null, error: null, count: null };

  async function syncOnce() {
    status.lastCheckedAt = new Date(now()).toISOString();
    try {
      const url = `https://api.github.com/repos/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`;
      const res = await fetchImpl(url, {
        headers: {
          Accept: 'application/vnd.github.raw',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'repo-dm-bot',
          ...(token && { Authorization: `Bearer ${token}` }),
          ...(etag && { 'If-None-Match': etag }),
        },
      });
      if (res.status === 304) return markOk();
      if (!res.ok) throw new Error(`저장소 파일 조회 실패: HTTP ${res.status}`);

      const text = await res.text();
      if (text.length > MAX_BYTES) throw new Error('파일이 너무 큽니다');
      const next = validateRepos(JSON.parse(text));

      let current = null;
      try { current = JSON.parse(readFileSync(file, 'utf8')); } catch { /* 없음/손상 */ }
      if (JSON.stringify(current) !== JSON.stringify(next)) {
        if (existsSync(file)) copyFileSync(file, `${file}.bak`);
        writeFileSync(`${file}.tmp`, JSON.stringify(next, null, 2) + '\n');
        renameSync(`${file}.tmp`, file); // 원자적 교체
        status.lastChangedAt = status.lastCheckedAt;
      }
      etag = res.headers?.get?.('etag') ?? null;
      status.count = next.length;
      markOk();
    } catch (e) {
      status.ok = false;
      status.error = e.message;
      onError(e);
    }
  }

  function markOk() {
    status.ok = true;
    status.error = null;
  }

  return {
    syncOnce,
    status: () => ({ ...status }),
    start(intervalMs = 5 * 60 * 1000) {
      if (!repo) return;
      syncOnce();
      setInterval(syncOnce, intervalMs).unref();
    },
  };
}
