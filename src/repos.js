import { readFileSync } from 'node:fs';

const path = new URL('../data/repos.json', import.meta.url);

export const loadRepos = () => JSON.parse(readFileSync(path, 'utf8'));

// 게시물(mediaId)이 같고, keyword가 없거나 댓글에 포함되면 매칭
export function matchRepo(repos, mediaId, text = '') {
  const t = text.toLowerCase();
  return repos.find(
    (r) => r.mediaId === mediaId && (!r.keyword || t.includes(r.keyword.toLowerCase())),
  );
}

export const findById = (repos, id) => repos.find((r) => r.id === id);
