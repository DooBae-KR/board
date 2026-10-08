import { createServer } from 'node:http';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { snapshot, record } from './stats.js';
import { createApi, verifySignature } from './instagram.js';
import { loadRepos, ensureReposFile } from './repos.js';
import { createHandlers } from './handlers.js';
import { createTokenStore } from './tokens.js';
import { createRepoSync } from './sync.js';
import { createClient } from '../scripts/lib/supabase.js';
import { createStore } from '../scripts/lib/store.js';
import { syncAgents } from '../scripts/lib/agents-sync.js';
import { createHarnessApi } from './harness-api.js';

const {
  PORT = 3000, VERIFY_TOKEN, DASHBOARD_TOKEN, TOKENS_FILE = 'data/tokens.json',
  REPOS_SYNC_REPO, REPOS_SYNC_BRANCH = 'main', REPOS_SYNC_PATH = 'data/repos.json',
  REPOS_SYNC_INTERVAL_MIN = '5', GITHUB_TOKEN,
  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, HARNESS_API_TOKEN, HARNESS_SYNC = '1',
} = process.env;

// 한국어/영어 계정 분리 운영: 환경변수에 설정된 계정만 활성화
const accounts = {};
const ids = {}; // lang -> igUserId
const seeds = {};
for (const [lang, key] of [['ko', 'KO'], ['en', 'EN']]) {
  const igUserId = process.env[`IG_${key}_USER_ID`];
  const token = process.env[`IG_${key}_ACCESS_TOKEN`];
  if (igUserId && token) {
    ids[lang] = igUserId;
    seeds[lang] = token;
  }
}
// 장기 토큰(60일)을 파일에 보관하고 만료 전 자동 갱신
const tokens = createTokenStore({
  file: TOKENS_FILE,
  seeds,
  onError: (lang, e) => {
    record(lang, 'error', { detail: e.message });
    console.error(e);
  },
});
for (const lang of Object.keys(seeds)) {
  accounts[ids[lang]] = { lang, api: createApi({ igUserId: ids[lang], token: () => tokens.get(lang) }) };
}
if (!Object.keys(accounts).length) console.warn('설정된 인스타그램 계정이 없습니다 (.env 확인)');
else tokens.start();

const reposFilePath = ensureReposFile(); // 볼륨에 repos.json이 없으면 기본 파일로 생성

// 저장소의 repos.json을 주기적으로 가져와 반영 (REPOS_SYNC_REPO=owner/repo 설정 시)
const repoSync = createRepoSync({
  repo: REPOS_SYNC_REPO, branch: REPOS_SYNC_BRANCH, path: REPOS_SYNC_PATH,
  token: GITHUB_TOKEN, file: reposFilePath,
  onError: (e) => { record('-', 'error', { detail: `repos 동기화: ${e.message}` }); console.error(e.message); },
});
repoSync.start(Math.max(1, Number(REPOS_SYNC_INTERVAL_MIN)) * 60 * 1000);

const handleWebhook = createHandlers({ accounts, loadRepos });

// 하네스 (CLAUDE.md): Supabase가 설정된 때만 켠다. 없으면 /api/harness/*는 503.
const appRoot = fileURLToPath(new URL('..', import.meta.url));
const harnessDb = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY ? createClient() : null;
const harnessApi = createHarnessApi({
  store: harnessDb ? createStore(harnessDb) : null,
  dashboardToken: DASHBOARD_TOKEN,
  agentToken: HARNESS_API_TOKEN,
  sprites: readdirSync(new URL('./assets/char/', import.meta.url)).filter((f) => f.endsWith('.png')).map((f) => f.slice(0, -4)),
  pageUrl: new URL('./harness.html', import.meta.url),
  supabaseUrl: SUPABASE_URL,
  onError: (e) => { record('-', 'error', { detail: `harness: ${String(e.message).slice(0, 180)}` }); console.error(e); },
});
if (!harnessDb) console.warn('SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY가 없어 하네스 API를 끕니다');
else if (HARNESS_SYNC !== '0') {
  // agents/*.md → Supabase. 실패해도 서버(웹훅)는 계속 돌아간다
  syncAgents({ db: harnessDb, root: appRoot, log: console.log })
    .catch((e) => { record('-', 'error', { detail: `agents 동기화: ${String(e.message).slice(0, 180)}` }); console.error(e.message); });
}

const dashboardHtml = new URL('./dashboard.html', import.meta.url);
const agentsDir = new URL('../.claude/agents/', import.meta.url);

function listAgents() {
  try {
    return readdirSync(agentsDir).filter((f) => f.endsWith('.md')).map((f) => {
      const [, fm = '', ...rest] = readFileSync(new URL(f, agentsDir), 'utf8').split('---');
      const get = (k) => fm.match(new RegExp(`^${k}:\\s*(.*)$`, 'm'))?.[1] ?? '';
      return {
        name: get('name'),
        description: get('description'),
        model: get('model'),
        tools: get('tools').split(',').map((t) => t.trim()).filter(Boolean),
        role: rest.join('---').trim(), // 에이전트가 실제로 수행하는 작업 지침
      };
    });
  } catch {
    return [];
  }
}

// 에이전트가 scripts/log-activity.js로 남긴 작업 기록 (최근 200개, 최신순)
function listActivity() {
  try {
    return readFileSync(new URL('../data/activity.jsonl', import.meta.url), 'utf8')
      .split('\n').filter(Boolean).slice(-200)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean).reverse();
  } catch {
    return [];
  }
}

// 에이전트 산출물: 후보 목록, 대본 문서
function listOutputs() {
  const out = [];
  for (const [dir, test, kind] of [
    ['../data/candidates/', () => true, '레포 후보'],
    ['../docs/', (f) => f.startsWith('script-') && f !== 'script-template.md', '대본'],
  ]) {
    try {
      const base = new URL(dir, import.meta.url);
      for (const f of readdirSync(base).filter((f) => f.endsWith('.md') && test(f))) {
        out.push({ kind, file: dir.replace('../', '') + f, modified: statSync(new URL(f, base)).mtime.toISOString() });
      }
    } catch { /* 디렉터리 없음 */ }
  }
  return out.sort((a, b) => b.modified.localeCompare(a.modified));
}

const json = (res, code, obj) =>
  res.writeHead(code, { 'Content-Type': 'application/json' }).end(JSON.stringify(obj));

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/healthz') return res.writeHead(200).end('ok');

  // 캐릭터 스프라이트 (화이트리스트된 파일명만)
  const asset = url.pathname.match(/^\/assets\/char\/([a-z]+)\.png$/);
  if (asset) {
    try {
      const png = readFileSync(new URL(`./assets/char/${asset[1]}.png`, import.meta.url));
      return res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' }).end(png);
    } catch {
      return res.writeHead(404).end();
    }
  }

  if (await harnessApi.handle(req, res, url)) return;

  // 대시보드: DASHBOARD_TOKEN이 설정되어 있고 일치할 때만 접근 허용
  if (url.pathname === '/dashboard' || url.pathname === '/api/stats') {
    const token = url.searchParams.get('token') ?? req.headers.authorization?.replace('Bearer ', '');
    if (!DASHBOARD_TOKEN || token !== DASHBOARD_TOKEN) return res.writeHead(403).end('forbidden');
    if (url.pathname === '/dashboard') {
      return res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(readFileSync(dashboardHtml));
    }
    return json(res, 200, {
      ...snapshot(),
      accounts: Object.entries(accounts).map(([id, a]) => ({ id, lang: a.lang, tokenExpiresAt: tokens.expiresAt(a.lang) })),
      repos: loadRepos(),
      sync: repoSync.status(),
      agents: listAgents(),
      activity: listActivity(),
      outputs: listOutputs(),
    });
  }

  if (url.pathname !== '/webhook') return res.writeHead(404).end();

  // Meta 웹훅 등록 시 확인 요청
  if (req.method === 'GET') {
    const ok =
      url.searchParams.get('hub.mode') === 'subscribe' &&
      url.searchParams.get('hub.verify_token') === VERIFY_TOKEN;
    return ok
      ? res.writeHead(200).end(url.searchParams.get('hub.challenge'))
      : res.writeHead(403).end();
  }
  if (req.method !== 'POST') return res.writeHead(405).end();

  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks);
  if (!verifySignature(raw, req.headers['x-hub-signature-256'])) return res.writeHead(401).end();

  res.writeHead(200).end('ok'); // 먼저 응답하고 처리 (Meta 재시도 방지)
  try {
    await handleWebhook(JSON.parse(raw));
  } catch (e) {
    record('-', 'error', { detail: String(e.message).slice(0, 200) });
    console.error(e);
  }
}).listen(PORT, () => console.log(`webhook listening on :${PORT}`));
