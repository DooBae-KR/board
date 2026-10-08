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
const store = createMemoryStore({ sections: names.map((name) => ({ name })) });
for (const n of names) { // 상위 부서 연결
  const a = agents.find((x) => x.department === n && x.parent_department);
  if (a) store._db.sections.find((s) => s.name === n).parent_id = store._db.sections.find((s) => s.name === a.parent_department)?.id ?? null;
}
for (const a of agents) {
  const sec = store._db.sections.find((s) => s.name === a.department);
  store._db.agents.push({ id: a.id, name: a.name, role: a.role, pose: a.pose, color: a.color, model: a.model, example: a.example, section_id: sec?.id ?? null, task: '', steps: [], progress: 0, status: 'waiting', note: '', last_report_at: null, archived_at: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
}

const sprites = readdirSync(join(root, 'src/assets/char')).map((f) => f.slice(0, -4));
const api = createHarnessApi({ store, dashboardToken: 'dev', agentToken: 'dev-agent', sprites, pageUrl: new URL('../src/harness.html', import.meta.url) });
createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const m = url.pathname.match(/^\/assets\/char\/([a-z]+)\.png$/);
  if (m) { try { const { readFileSync } = await import('node:fs'); return res.writeHead(200, { 'Content-Type': 'image/png' }).end(readFileSync(join(root, 'src/assets/char', m[1] + '.png'))); } catch { return res.writeHead(404).end(); } }
  if (!(await api.handle(req, res, url))) res.writeHead(404).end();
}).listen(3100, '127.0.0.1', () => console.log('http://127.0.0.1:3100/harness  (로그인 토큰: dev, 에이전트 토큰: dev-agent)'));
