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

// 동기화/수동 수정 값 검증: 잘못된 파일이 서비스에 반영되지 않게 한다
export function validateRepos(data) {
  if (!Array.isArray(data)) throw new Error('JSON 배열이 아닙니다');
  const ids = new Set();
  data.forEach((r, i) => {
    for (const k of ['id', 'mediaId', 'name', 'url']) {
      if (typeof r?.[k] !== 'string' || !r[k]) throw new Error(`[${i}] '${k}' 누락`);
    }
    if (r.keyword !== undefined && typeof r.keyword !== 'string') throw new Error(`[${i}] 'keyword'는 문자열이어야 합니다`);
    if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+/.test(r.url)) throw new Error(`[${i}] url은 https://github.com/... 형식이어야 합니다`);
    if (ids.has(r.id)) throw new Error(`id 중복: ${r.id}`);
    ids.add(r.id);
  });
  return data;
}

let lastGood = [];

// 요청마다 파일을 읽어 재시작 없이 반영. 파일이 깨졌으면(수정 중 오타 등) 마지막 정상본을 유지
export function loadRepos(file = reposFile()) {
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    return (lastGood = validateRepos(data));
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
