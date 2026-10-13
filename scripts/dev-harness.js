#!/usr/bin/env node
// 로컬 미리보기: Supabase 없이 메모리 저장소로 /harness 대시보드를 띄운다. 재시작하면 초기화된다.
//   node scripts/dev-harness.js   →  http://127.0.0.1:3100/harness  (로그인 토큰: dev)
import { createServer } from 'node:http';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { createHarnessApi } from '../src/harness-api.js';
import { createMemoryStore } from './lib/memory-store.js';
import { checkAgents } from './lib/agents-sync.js';
import { isLobby } from './lib/harness.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { agents, errors } = checkAgents(root);
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }

const names = [...new Set(agents.flatMap((a) => [a.parent_department, a.department]).filter((n) => !isLobby(n)))];
// 인스타 DM 퍼널·경고 미리보기용 목 데이터 (실제 igbot_* 와 무관). IGBOT_MOCK=none 이면 비워 둔다
const ago = (h) => new Date(Date.now() - h * 3600_000).toISOString();
const mk = (lang, event, n, h, detail) => Array.from({ length: n }, (_, i) => ({ at: ago(h + i), lang, event, detail: detail ?? null }));
const igbot = process.env.IGBOT_MOCK === 'none' ? null : {
  events: [
    ...mk('ko', 'matched', 42, 1), ...mk('ko', 'link_direct', 14, 2), ...mk('ko', 'asked', 28, 2), ...mk('ko', 'click_ok', 17, 3), ...mk('ko', 'click_retry', 6, 3),
    ...mk('en', 'matched', 9, 5), ...mk('en', 'link_direct', 4, 6), ...mk('en', 'asked', 5, 6), ...mk('en', 'click_ok', 2, 7),
    ...mk('ko', 'error', 1, 5, 'token refresh failed (ko): 400'), ...mk('-', 'error', 2, 3, 'fetch failed'),
  ],
  tokens: [
    { lang: 'ko', expires_at: new Date(Date.now() + 4.5 * 86400_000).toISOString(), updated_at: ago(60) },
    { lang: 'en', expires_at: new Date(Date.now() + 40 * 86400_000).toISOString(), updated_at: ago(30) },
  ],
};
const store = createMemoryStore({ sections: names.map((name) => ({ name })), igbot });
for (const n of names) { // 상위 부서 연결
  const a = agents.find((x) => x.department === n && x.parent_department);
  if (a) store._db.sections.find((s) => s.name === n).parent_id = store._db.sections.find((s) => s.name === a.parent_department)?.id ?? null;
}
for (const a of agents) {
  const sec = store._db.sections.find((s) => s.name === a.department);
  store._db.agents.push({ id: a.id, name: a.name, role: a.role, pose: a.pose, color: a.color, model: a.model, example: a.example, section_id: sec?.id ?? null, task: '', steps: [], progress: 0, status: 'waiting', note: '', last_report_at: null, archived_at: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
}

const sprites = readdirSync(join(root, 'src/assets/char')).filter((f) => f.endsWith('.png')).map((f) => f.slice(0, -4));
const api = createHarnessApi({ store, dashboardToken: 'dev', agentToken: 'dev-agent', sprites, pageUrl: new URL('../src/harness.html', import.meta.url) });
createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const m = url.pathname.match(/^\/assets\/char\/(?:(sehun)\/)?([a-z]+)\.png$/);
  if (m) { try { const { readFileSync } = await import('node:fs'); return res.writeHead(200, { 'Content-Type': 'image/png' }).end(readFileSync(join(root, 'src/assets/char', (m[1] ? m[1] + '/' : '') + m[2] + '.png'))); } catch { return res.writeHead(404).end(); } }
  if (!(await api.handle(req, res, url))) res.writeHead(404).end();
}).listen(3100, '127.0.0.1', () => console.log('http://127.0.0.1:3100/harness  (로그인 토큰: dev, 에이전트 토큰: dev-agent)'));
