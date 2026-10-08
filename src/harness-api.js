// 하네스 서버 API와 대시보드 페이지 (/harness, /api/harness/*).
//
// 인증은 Bearer 토큰 두 종류다 (GET은 ?token= 도 허용: 브라우저 주소창·<video> 용).
//   DASHBOARD_TOKEN    사람(대시보드): 읽기, 보고, 섹션 추가·삭제, 위젯 갱신
//   HARNESS_API_TOKEN  에이전트(Agent Substrate Actor): 보고, 섹션 추가, 위젯 갱신
// 쓰기는 모두 서버가 service_role로 한다. 브라우저는 Supabase에 직접 닿지 않는다 (CLAUDE.md 2-3).
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { HarnessError, MOTION_STATES, ID_RE } from '../scripts/lib/harness.js';
import { runReport } from '../scripts/lib/report.js';

const COLORS = ['lavender', 'pink', 'mint', 'peach', 'sky'];
const WIDGET_TYPES = ['kpi', 'donut', 'bars', 'line', 'list', 'feed'];
const WIDGET_SIZES = ['full', 'half', 'third'];
const STALE_MS = 60 * 60 * 1000; // 작업 중인데 60분 넘게 보고가 없으면 "응답 없음" (CLAUDE.md 6장)
const BODY_LIMIT = 64 * 1024;

const digest = (s) => createHash('sha256').update(String(s)).digest();
const sameToken = (a, b) => !!a && !!b && timingSafeEqual(digest(a), digest(b));
const CONTROL = /[\u0000-\u001f\u007f]/;

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
    "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'",
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
 * @param {string} [o.agentToken]
 * @param {string[]} o.sprites           허용하는 pose 이름 (src/assets/char/*.png)
 * @param {URL} o.pageUrl                harness.html 위치
 * @param {string} [o.supabaseUrl]       모션 클립 재생을 허용할 출처(CSP)
 * @param {(e: Error) => void} [o.onError]
 */
export function createHarnessApi({ store, dashboardToken, agentToken, sprites, pageUrl, supabaseUrl, onError = console.error }) {
  const mediaOrigin = supabaseUrl ? new URL(supabaseUrl).origin : '';

  const level = (req, url) => {
    const bearer = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? '')?.[1]?.trim();
    const t = bearer || (req.method === 'GET' ? url.searchParams.get('token') : '') || '';
    if (sameToken(t, dashboardToken)) return 'dashboard';
    if (sameToken(t, agentToken)) return 'agent';
    return null;
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
  const dashboardOnly = new Set(['DELETE /api/harness/sections/:id']);

  async function handle(req, res, url) {
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const isPage = path === '/harness';
    if (!isPage && path !== '/api/harness' && !path.startsWith('/api/harness/')) return false;

    try {
      const who = level(req, url);
      if (!who) return send(res, 403, { error: 'forbidden' }), true;

      // 대시보드 페이지
      if (isPage) {
        if (req.method !== 'GET') return send(res, 405, { error: 'method not allowed' }, { Allow: 'GET' }), true;
        if (who !== 'dashboard') return send(res, 403, { error: 'forbidden' }), true;
        const nonce = randomBytes(16).toString('base64');
        const html = (await readFile(pageUrl, 'utf8')).replaceAll('__NONCE__', nonce);
        return res.writeHead(200, pageHeaders(nonce, mediaOrigin)).end(html), true;
      }

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
      await route(req, res);
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
