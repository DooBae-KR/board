#!/usr/bin/env node
// Netlify 빌드: 함수가 쓸 페이지·스프라이트 목록을 만들고, 정적 파일(dist/)을 채운 뒤, 운영 배포에서만 agents/*.md를 동기화한다.
import { mkdirSync, cpSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const at = (...p) => join(root, ...p);

mkdirSync(at('netlify/generated'), { recursive: true }); // 생성 파일은 git에 없으므로 새 클론에서도 폴더를 만든다
const sprites = readdirSync(at('src/assets/char')).filter((f) => f.endsWith('.png')).map((f) => f.slice(0, -4)).sort();
writeFileSync(at('netlify/generated/page.mjs'),
  `// scripts/netlify-build.js가 만든 파일. 고치지 말 것.\nexport const sprites = ${JSON.stringify(sprites)};\nexport const pageHtml = ${JSON.stringify(readFileSync(at('src/harness.html'), 'utf8'))};\n`);

// 인스타 봇의 repos.json: 서버리스에는 디스크가 없으므로 빌드 때 검증해서 함수에 넣는다(저장소에서 고치면 재배포로 반영).
const { validateRepos } = await import('../src/repos.js');
const repos = validateRepos(JSON.parse(readFileSync(at('data/repos.json'), 'utf8')));
writeFileSync(at('netlify/generated/repos.mjs'), `// scripts/netlify-build.js가 만든 파일. 고치지 말 것.\nexport const repos = ${JSON.stringify(repos)};\n`);

mkdirSync(at('dist/assets'), { recursive: true });
cpSync(at('src/assets/char'), at('dist/assets/char'), { recursive: true });
writeFileSync(at('dist/index.html'), `<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex"><title>하네스</title><p>하네스 대시보드는 <code>/harness?token=…</code> 주소로 들어갑니다.</p>\n`);
console.log(`netlify-build: 영상 ${repos.length}개, 스프라이트 ${sprites.length}개, 페이지 ${readFileSync(at('src/harness.html')).length}바이트`);

// 미리보기·브랜치 배포가 운영 DB를 건드리지 않도록 운영 배포에서만 동기화한다.
const ctx = process.env.CONTEXT;
if ((!ctx || ctx === 'production') && process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
  try {
    const [{ createClient }, { syncAgents }] = await Promise.all([import('./lib/supabase.js'), import('./lib/agents-sync.js')]);
    await syncAgents({ db: createClient(), root, log: console.log });
  } catch (e) {
    console.warn('agents 동기화를 건너뜁니다:', e.message); // 배포 자체는 막지 않는다
  }
} else {
  console.log(`agents 동기화 생략 (CONTEXT=${ctx ?? '없음'}, Supabase 환경변수 ${process.env.SUPABASE_URL ? '있음' : '없음'})`);
}
