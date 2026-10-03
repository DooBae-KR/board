import { readFileSync, writeFileSync, copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

const bundled = new URL('../data/repos.json', import.meta.url);
export const reposFile = () => process.env.REPOS_FILE || bundled.pathname;

// 볼륨의 REPOS_FILE이 없으면 이미지에 포함된 기본 파일로 최초 1회 생성 (이후엔 볼륨 파일이 기준)
export function ensureReposFile() {
  const file = reposFile();
  if (existsSync(file)) return file;
  mkdirSync(dirname(file), { recursive: true });
  if (existsSync(bundled)) copyFileSync(bundled, file);
  else writeFileSync(file, '[]\n');
  return file;
}

let lastGood = [];

// 요청마다 파일을 읽어 재시작 없이 반영. 파일이 깨졌으면(수정 중 오타 등) 마지막 정상본을 유지
export function loadRepos(file = reposFile()) {
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    if (!Array.isArray(data)) throw new Error('repos file must be a JSON array');
    return (lastGood = data);
  } catch (e) {
    console.error(`repos.json 읽기 실패, 마지막 정상본 사용: ${e.message}`);
    return lastGood;
  }
}

// 게시물(mediaId)이 같고, keyword가 없거나 댓글에 포함되면 매칭
export function matchRepo(repos, mediaId, text = '') {
  const t = text.toLowerCase();
  return repos.find(
    (r) => r.mediaId === mediaId && (!r.keyword || t.includes(r.keyword.toLowerCase())),
  );
}

export const findById = (repos, id) => repos.find((r) => r.id === id);
