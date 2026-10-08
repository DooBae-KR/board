// 하네스 서버 API와 대시보드 페이지 (/harness, /api/harness/*).
//
// 토큰은 주소(URL)에 싣지 않는다. 기록·히스토리·Referer에 남기 때문이다.
//   DASHBOARD_TOKEN    사람(대시보드): /harness 로그인 폼에 입력(POST) → HttpOnly 세션 쿠키. 읽기, 보고, 섹션 추가·삭제, 위젯 갱신
//   HARNESS_API_TOKEN  에이전트(Agent Substrate Actor): Authorization: Bearer 헤더. 보고, 섹션 추가, 위젯 갱신
// 쿠키 세션은 DASHBOARD_TOKEN으로 서명한 값이라 서버에 저장하지 않고, 토큰을 바꾸면 모든 세션이 무효가 된다.
// 쓰기는 모두 서버가 service_role로 한다. 브라우저는 Supabase에 직접 닿지 않는다 (CLAUDE.md 2-3).
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { HarnessError, MOTION_STATES, ID_RE, looksSecret } from '../scripts/lib/harness.js';
import { runReport } from '../scripts/lib/report.js';

const COLORS = ['lavender', 'pink', 'mint', 'peach', 'sky'];
const WIDGET_TYPES = ['kpi', 'donut', 'bars', 'line', 'list', 'feed'];
const WIDGET_SIZES = ['full', 'half', 'third'];
const STALE_MS = 60 * 60 * 1000; // 작업 중인데 60분 넘게 보고가 없으면 "응답 없음" (CLAUDE.md 6장)
const BODY_LIMIT = 64 * 1024;
const TASK_MAX = 2000;
const QUEUE_MAX = 20; // 에이전트 한 명의 대기 작업 상한(한꺼번에 쌓이는 것을 막는다)
const TASK_NEXT = { queued: ['claimed', 'cancelled'], claimed: ['done', 'failed', 'cancelled'] };
const TASK_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/; // 줄바꿈·탭은 허용

const digest = (s) => createHash('sha256').update(String(s)).digest();
const sameToken = (a, b) => !!a && !!b && timingSafeEqual(digest(a), digest(b));
const CONTROL = /[\u0000-\u001f\u007f]/;

const COOKIE = 'harness_session';
const SESSION_MS = 12 * 60 * 60 * 1000;
const sign = (key, exp) => createHmac('sha256', key).update(`harness-session:v1:${exp}`).digest('base64url');
const makeSession = (key, now = Date.now()) => { const exp = now + SESSION_MS; return `${exp}.${sign(key, exp)}`; };
function validSession(key, value, now = Date.now()) {
  if (!key || !value) return false;
  const [exp, sig] = String(value).split('.');
  if (!/^\d{10,15}$/.test(exp || '') || !sig || Number(exp) < now) return false;
  return sameToken(sig, sign(key, exp));
}
const cookieOf = (req, name) => (req.headers.cookie ?? '').split(';').map((c) => c.trim().split(/=(.*)/s)).find(([k]) => k === name)?.[1];
/** 쿠키로 인증된 쓰기 요청은 같은 출처에서 온 것만 받는다(CSRF 방어. SameSite=Strict와 함께 이중으로) */
function sameOrigin(req) {
  const site = req.headers['sec-fetch-site'];
  if (site) return site === 'same-origin';
  const { origin, host } = req.headers;
  if (origin && host) { try { return new URL(origin).host === host; } catch { return false; } }
  return false;
}
const isSecure = (req, url) => url.protocol === 'https:' || req.headers['x-forwarded-proto'] === 'https';
const setCookie = (req, url, value, maxAge) => `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${isSecure(req, url) ? '; Secure' : ''}`;

async function readForm(req) {
  const chunks = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > 4096) throw new HarnessError('요청 본문이 너무 큽니다', 413); chunks.push(c); }
  const raw = Buffer.concat(chunks).toString('utf8');
  if ((req.headers['content-type'] ?? '').includes('json')) { try { return JSON.parse(raw) ?? {}; } catch { return {}; } }
  return Object.fromEntries(new URLSearchParams(raw));
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const loginPage = (nonce, error, withUser = false) => `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>하네스 로그인</title>
<style nonce="${nonce}">body{margin:0;min-height:100vh;display:grid;place-items:center;background:#F2F0FA;color:#2C2852;font:16px/1.5 system-ui,"Apple SD Gothic Neo","Malgun Gothic",sans-serif}
form{background:#fff;border:1px solid #D9D3F1;border-radius:16px;padding:28px;width:min(360px,calc(100% - 32px));display:grid;gap:14px}
h1{margin:0;font-size:22px}input{padding:10px 12px;border:1px solid #D9D3F1;border-radius:10px;font:inherit;width:100%;box-sizing:border-box}
button{padding:10px;border:0;border-radius:10px;background:#6F62D2;color:#fff;font:inherit;cursor:pointer}.err{color:#D4506A;margin:0;font-size:14px}p{margin:0;color:#6E6896;font-size:14px}</style></head>
<body><form method="post" action="/harness/login"><h1>하네스 대시보드</h1><p>${withUser ? '아이디와 비밀번호를 입력하세요.' : '대시보드 토큰을 입력하세요. 주소에는 남지 않아요.'}</p>
${withUser ? '<input type="text" name="username" autocomplete="username" aria-label="아이디" placeholder="아이디" required autofocus>\n<input type="password" name="password" autocomplete="current-password" aria-label="비밀번호" placeholder="비밀번호" required>' : '<input type="password" name="token" autocomplete="current-password" aria-label="대시보드 토큰" required autofocus>'}${error ? `<p class="err" role="alert">${esc(error)}</p>` : ''}<button type="submit">들어가기</button></form></body></html>`;

/** 응답에 쓰는 동시에 열린 요청 본문은 버린다 */
function send(res, code, body, headers = {}) {
  const isJson = typeof body !== 'string' && !Buffer.isBuffer(body);
  const payload = isJson ? JSON.stringify(body) : body;
  res.writeHead(code, { 'Content-Type': isJson ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers });
  res.end(payload);
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > BODY_LIMIT) throw new HarnessError('요청 본문이 너무 큽니다 (최대 64KB)', 413);
    chunks.push(c);
  }
  if (!size) return {};
  let v;
  try { v = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HarnessError('JSON 본문을 읽을 수 없습니다'); }
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new HarnessError('JSON 객체 본문이 필요합니다');
  return v;
}

const str = (v, field, { min = 0, max }) => {
  if (v == null) v = '';
  if (typeof v !== 'string') throw new HarnessError(`${field}는 문자열이어야 합니다`);
  const s = v.trim();
  if (s.length < min || s.length > max) throw new HarnessError(`${field}는 ${min ? `${min}~` : ''}${max}자여야 합니다`);
  if (CONTROL.test(s)) throw new HarnessError(`${field}에 쓸 수 없는 문자가 있습니다`);
  return s;
};

/** 대시보드가 쓰는 모양으로 정리한다. md 해시·도구 목록 같은 내부 값은 내보내지 않는다 */
export function buildSnapshot(raw, now = Date.now()) {
  const clips = new Map();
  for (const m of raw.motions) clips.set(m.agent_id, [...(clips.get(m.agent_id) ?? []), m.state]);
  const moved = new Map();
  for (const e of raw.events) if (e.kind === 'assign' && !moved.has(e.agent_id)) moved.set(e.agent_id, e.created_at); // events는 최신순
  return {
    sections: raw.sections.map(({ id, name, parent_id, pose, color, status, sort }) => ({ id, name, parent_id, pose, color, status, sort })),
    widgets: raw.widgets.map(({ id, section_id, type, title, size, data }) => ({ id, section_id, type, title, size, data })),
    agents: raw.agents.map((a) => ({
      id: a.id, name: a.name, role: a.role, pose: a.pose, color: a.color, model: a.model, example: a.example,
      section_id: a.section_id, task: a.task, steps: a.steps, progress: a.progress, status: a.status, note: a.note,
      last_report_at: a.last_report_at, updated_at: a.updated_at,
      clips: clips.get(a.id) ?? [], moved_at: moved.get(a.id) ?? null,
      stale: a.status === 'working' && !!a.last_report_at && now - Date.parse(a.last_report_at) > STALE_MS,
    })),
    tasks: (raw.tasks ?? []).map(({ id, agent_id, body, status, created_at, claimed_at, closed_at }) => ({ id, agent_id, body, status, created_at, claimed_at, closed_at })),
    events: raw.events.map(({ id, agent_id, kind, message, from_section, to_section, output, created_at }) => ({ id, agent_id, kind, message, from_section, to_section, output, created_at })),
  };
}

function pageHeaders(nonce, mediaOrigin) {
  const csp = [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    `style-src 'nonce-${nonce}' https://fonts.googleapis.com`,
    "style-src-attr 'unsafe-inline'", // 진행 바 너비·색상 같은 값만 style 속성으로 넣는다
    'font-src https://fonts.gstatic.com',
    "img-src 'self' data:",
    `media-src 'self'${mediaOrigin ? ` ${mediaOrigin}` : ''}`,
    "connect-src 'self'",
    "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'",
  ].join('; ');
  return {
    'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': csp,
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY', // 주소창에 토큰이 있으므로 Referer를 보내지 않는다
  };
}

/**
 * @param {object} o
 * @param {object|null} o.store          createStore()/createMemoryStore() 결과. 없으면 503
 * @param {string} [o.dashboardToken]
 * @param {string} [o.dashboardUser]      사람용 로그인 아이디(dashboardPassword와 함께 설정할 때만 아이디/비밀번호 로그인)
 * @param {string} [o.dashboardPassword]
 * @param {string} [o.agentToken]
 * @param {string[]} o.sprites           허용하는 pose 이름 (src/assets/char/*.png)
 * @param {URL} [o.pageUrl]              harness.html 위치
 * @param {string} [o.pageHtml]          harness.html 내용(서버리스처럼 파일을 못 읽을 때). pageUrl보다 우선
 * @param {string} [o.supabaseUrl]       모션 클립 재생을 허용할 출처(CSP)
 * @param {(e: Error) => void} [o.onError]
 */
export function createHarnessApi({ store, dashboardToken, dashboardUser, dashboardPassword, agentToken, sprites, pageUrl, pageHtml, supabaseUrl, onError = console.error }) {
  const userLogin = !!(dashboardUser && dashboardPassword);
  const mediaOrigin = supabaseUrl ? new URL(supabaseUrl).origin : '';

  /** 인증 결과: 에이전트·스크립트는 Bearer 헤더, 사람은 로그인 쿠키. 주소의 ?token= 은 받지 않는다 */
  const auth = (req) => {
    const bearer = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? '')?.[1]?.trim();
    if (bearer) {
      if (sameToken(bearer, dashboardToken)) return { who: 'dashboard' };
      if (sameToken(bearer, agentToken)) return { who: 'agent' };
      return { who: null };
    }
    if (validSession(dashboardToken, cookieOf(req, COOKIE))) return { who: 'dashboard', viaCookie: true };
    return { who: null };
  };

  const section = async (ref, field = 'section') => {
    if (typeof ref !== 'string' || !ref.trim()) throw new HarnessError(`${field}가 필요합니다`);
    const s = await store.findSection(ref.trim());
    if (!s) throw new HarnessError(`부서 "${ref}"를 찾지 못했습니다`, 404);
    return s;
  };

  const routes = {
    async 'GET /api/harness'(req, res) {
      const body = JSON.stringify(buildSnapshot(await store.snapshot()));
      const etag = `W/"${createHash('sha1').update(body).digest('base64url')}"`;
      if (req.headers['if-none-match'] === etag) return send(res, 304, '', { ETag: etag });
      return send(res, 200, body, { 'Content-Type': 'application/json; charset=utf-8', ETag: etag });
    },

    async 'POST /api/harness/report'(req, res) {
      const out = await runReport(store, await readJson(req));
      return send(res, 200, out);
    },

    async 'GET /api/harness/tasks'(req, res, url) {
      const agent = url.searchParams.get('agent') ?? '';
      const status = url.searchParams.get('status') ?? '';
      if (agent && !ID_RE.test(agent)) throw new HarnessError('agent가 올바르지 않습니다');
      if (status && !['queued', 'claimed', 'done', 'failed', 'cancelled'].includes(status)) throw new HarnessError('status가 올바르지 않습니다');
      return send(res, 200, { tasks: await store.listTasks({ agent: agent || undefined, status: status || undefined }) });
    },

    /** 사람이 대화창에 적은 작업을 에이전트 요청함에 넣는다 */
    async 'POST /api/harness/tasks'(req, res) {
      const b = await readJson(req);
      if (typeof b.agent !== 'string' || !ID_RE.test(b.agent)) throw new HarnessError('agent가 필요합니다');
      if (typeof b.body !== 'string') throw new HarnessError('body는 문자열이어야 합니다');
      const body = b.body.trim();
      if (!body) throw new HarnessError('작업 내용을 적어 주세요');
      if (body.length > TASK_MAX) throw new HarnessError(`작업 내용은 ${TASK_MAX}자 이하여야 합니다`);
      if (TASK_CONTROL.test(body)) throw new HarnessError('작업 내용에 쓸 수 없는 문자가 있습니다');
      if (looksSecret(body)) throw new HarnessError('토큰·키로 보이는 값이 있어 저장하지 않았습니다. 비밀값은 작업 내용에 적지 마세요');
      const agent = await store.getAgent(b.agent);
      if (!agent || agent.archived_at) throw new HarnessError(`에이전트 "${b.agent}"를 찾지 못했습니다`, 404);
      if (await store.countQueued(b.agent) >= QUEUE_MAX) throw new HarnessError(`${agent.name}에게 대기 중인 작업이 ${QUEUE_MAX}개 있습니다. 먼저 처리하거나 취소해 주세요`, 409);
      const t = await store.createTask({ agent_id: b.agent, body });
      return send(res, 201, { id: t.id, status: t.status });
    },

    /** 에이전트가 자기 요청함에서 가장 오래된 작업 하나를 가져간다(진행 중으로 바뀜). 없으면 task: null */
    async 'POST /api/harness/tasks/next'(req, res) {
      const b = await readJson(req);
      if (typeof b.agent !== 'string' || !ID_RE.test(b.agent)) throw new HarnessError('agent가 필요합니다');
      if (!(await store.getAgent(b.agent))) throw new HarnessError(`에이전트 "${b.agent}"가 없습니다`, 404);
      const t = await store.claimNextTask(b.agent);
      return send(res, 200, { task: t ? { id: t.id, agent_id: t.agent_id, body: t.body, created_at: t.created_at } : null });
    },

    async 'POST /api/harness/sections'(req, res) {
      const b = await readJson(req);
      const name = str(b.name, 'name', { min: 1, max: 40 });
      const pose = b.pose == null || b.pose === '' ? 'idle' : String(b.pose);
      const color = b.color == null || b.color === '' ? 'lavender' : String(b.color);
      if (!sprites.includes(pose)) throw new HarnessError(`pose는 ${sprites.join(', ')} 중 하나여야 합니다`);
      if (!COLORS.includes(color)) throw new HarnessError(`color는 ${COLORS.join(', ')} 중 하나여야 합니다`);
      const parent = b.parent ? await section(b.parent, 'parent') : null;
      try {
        const row = await store.createSection({ name, parent_id: parent ? parent.id : null, pose, color });
        return send(res, 201, { id: row.id, name: row.name });
      } catch (e) {
        if (e.status === 409) throw new HarnessError('같은 이름의 부서가 이미 있습니다', 409);
        throw e;
      }
    },

    async 'PUT /api/harness/widgets'(req, res) {
      const b = await readJson(req);
      const s = await section(b.section);
      const title = str(b.title, 'title', { min: 1, max: 40 });
      if (!WIDGET_TYPES.includes(b.type)) throw new HarnessError(`type은 ${WIDGET_TYPES.join(', ')} 중 하나여야 합니다`);
      if (b.size != null && !WIDGET_SIZES.includes(b.size)) throw new HarnessError(`size는 ${WIDGET_SIZES.join(', ')} 중 하나여야 합니다`);
      if (!b.data || typeof b.data !== 'object' || Array.isArray(b.data)) throw new HarnessError('data는 객체여야 합니다');
      if (JSON.stringify(b.data).length > 32 * 1024) throw new HarnessError('data는 32KB 이하여야 합니다');
      const row = await store.upsertWidget({ section_id: s.id, type: b.type, title, size: b.size ?? null, data: b.data });
      return send(res, 200, { id: row.id, section: s.name, title: row.title });
    },
  };

  /** 사람(DASHBOARD_TOKEN)만 쓸 수 있는 동작 */
  const dashboardOnly = new Set(['POST /api/harness/tasks']);

  async function handle(req, res, url) {
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const isPage = path === '/harness';
    const isAuthPath = path === '/harness/login' || path === '/harness/logout';
    if (!isPage && !isAuthPath && path !== '/api/harness' && !path.startsWith('/api/harness/')) return false;

    try {
      const { who, viaCookie } = auth(req);
      const page = (code, html, extra = {}) => { const nonce = randomBytes(16).toString('base64'); return res.writeHead(code, { ...pageHeaders(nonce, mediaOrigin), ...extra }).end(typeof html === 'function' ? html(nonce) : html); };

      // 로그인: 토큰을 POST 본문으로 받아 세션 쿠키를 심는다
      if (path === '/harness/login') {
        if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' }, { Allow: 'POST' }), true;
        if (!sameOrigin(req)) return send(res, 403, { error: 'forbidden' }), true;
        const body = await readForm(req);
        // 아이디/비밀번호를 설정했으면 그것으로, 아니면 토큰으로. 둘 다 항상 상수 시간 비교(아이디·비밀번호를 모두 비교한 뒤 판정)
        const okUser = userLogin
          ? [sameToken(body.username, dashboardUser), sameToken(body.password, dashboardPassword)].every(Boolean)
          : false;
        const okToken = !userLogin && typeof body.token === 'string' && sameToken(body.token, dashboardToken);
        if (dashboardToken && (okUser || okToken)) {
          return res.writeHead(303, { Location: '/harness', 'Set-Cookie': setCookie(req, url, makeSession(dashboardToken), SESSION_MS / 1000), 'Cache-Control': 'no-store' }).end(), true;
        }
        await new Promise((r) => setTimeout(r, 400)); // 무차별 대입을 조금 늦춘다
        return page(403, (nonce) => loginPage(nonce, userLogin ? '아이디 또는 비밀번호가 맞지 않아요.' : '토큰이 맞지 않아요.', userLogin)), true;
      }
      if (path === '/harness/logout') {
        if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' }, { Allow: 'POST' }), true;
        if (!sameOrigin(req)) return send(res, 403, { error: 'forbidden' }), true;
        return send(res, 200, { ok: true }, { 'Set-Cookie': setCookie(req, url, '', 0) }), true;
      }

      // 대시보드 페이지: 로그인 전에는 로그인 폼
      if (isPage) {
        if (req.method !== 'GET') return send(res, 405, { error: 'method not allowed' }, { Allow: 'GET' }), true;
        if (who !== 'dashboard') return page(200, (nonce) => loginPage(nonce, undefined, userLogin)), true;
        const html = pageHtml ?? await readFile(pageUrl, 'utf8');
        return page(200, (nonce) => html.replaceAll('__NONCE__', nonce)), true;
      }

      if (!who) return send(res, 403, { error: 'forbidden' }), true;
      if (viaCookie && !['GET', 'HEAD'].includes(req.method) && !sameOrigin(req)) return send(res, 403, { error: 'forbidden' }), true;

      if (!store) return send(res, 503, { error: 'harness is not configured (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)' }), true;

      // 모션 클립: 서명 URL로 보낸다
      const motion = /^\/api\/harness\/motion\/([a-z0-9-]+)\/([a-z]+)$/.exec(path);
      if (motion) {
        if (req.method !== 'GET') return send(res, 405, { error: 'method not allowed' }, { Allow: 'GET' }), true;
        if (who !== 'dashboard') return send(res, 403, { error: 'forbidden' }), true;
        const [, id, state] = motion;
        if (!ID_RE.test(id) || !MOTION_STATES.includes(state)) return send(res, 404, { error: 'not found' }), true;
        const target = await store.motionUrl(id, state);
        if (!target) return send(res, 404, { error: 'clip not rendered' }), true;
        return res.writeHead(302, { Location: target, 'Cache-Control': 'private, max-age=300', 'Referrer-Policy': 'no-referrer' }).end(), true;
      }

      // 작업 상태 변경: queued→claimed|cancelled, claimed→done|failed|cancelled
      const taskPatch = /^\/api\/harness\/tasks\/([0-9a-fA-F-]{36})$/.exec(path);
      if (taskPatch) {
        if (req.method !== 'PATCH') return send(res, 405, { error: 'method not allowed' }, { Allow: 'PATCH' }), true;
        const b = await readJson(req);
        const t = await store.getTask(taskPatch[1]);
        if (!t) return send(res, 404, { error: 'task not found' }), true;
        if (!(TASK_NEXT[t.status] ?? []).includes(b.status)) throw new HarnessError(`'${t.status}' 상태의 작업은 '${b.status}'(으)로 바꿀 수 없습니다`, 409);
        const now = new Date().toISOString();
        const patch = { status: b.status, ...(b.status === 'claimed' ? { claimed_at: now } : { closed_at: now }) };
        const rows = await store.updateTask(t.id, patch, t.status);
        if (!rows.length) throw new HarnessError('같은 작업이 동시에 바뀌었습니다. 다시 시도하세요', 409);
        return send(res, 200, { id: t.id, status: rows[0].status }), true;
      }

      // 섹션 삭제
      const del = /^\/api\/harness\/sections\/([0-9a-fA-F-]{36})$/.exec(path);
      if (del) {
        if (req.method !== 'DELETE') return send(res, 405, { error: 'method not allowed' }, { Allow: 'DELETE' }), true;
        if (who !== 'dashboard') return send(res, 403, { error: 'forbidden' }), true;
        const gone = await store.deleteSection(del[1]);
        return gone ? send(res, 200, { deleted: gone.name }) : send(res, 404, { error: 'section not found' }), true;
      }

      const route = routes[`${req.method} ${path}`];
      if (!route) {
        const known = Object.keys(routes).some((k) => k.endsWith(` ${path}`));
        return send(res, known ? 405 : 404, { error: known ? 'method not allowed' : 'not found' }), true;
      }
      if (dashboardOnly.has(`${req.method} ${path}`) && who !== 'dashboard') return send(res, 403, { error: 'forbidden' }), true;
      await route(req, res, url);
    } catch (e) {
      if (e instanceof HarnessError) {
        if (e.status === 413) res.setHeader('Connection', 'close');
        send(res, e.status, { error: e.message });
      } else {
        onError(e);
        send(res, 502, { error: '저장소에 요청하지 못했습니다. 잠시 뒤 다시 시도하세요' });
      }
    }
    return true;
  }

  return { handle };
}
