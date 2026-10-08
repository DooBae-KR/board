import { hashPassword } from '../scripts/lib/password.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHarnessApi } from './harness-api.js';
import { createMemoryStore } from '../scripts/lib/memory-store.js';
import { runReport } from '../scripts/lib/report.js';

const DASH = 'dash-token', AGENT = 'agent-token';
const SPRITES = ['idle', 'happy', 'sleep'];

async function boot({ withStore = true, admins = [] } = {}) {
  const store = createMemoryStore({
    sections: [{ name: '인사팀' }],
    agents: [{ id: 'lumi', name: '루미', role: '분석', pose: 'idle', color: '#7A5BC9', example: false, md_sha256: 'secret-hash' }],
    motions: [{ agent_id: 'lumi', state: 'working', storage_path: 'agent-motions/lumi/working.mp4' }],
    admins,
  });
  const api = createHarnessApi({
    store: withStore ? store : null, dashboardToken: DASH, agentToken: AGENT, sprites: SPRITES,
    pageUrl: new URL('./harness.html', import.meta.url), supabaseUrl: 'https://proj.supabase.co', onError: () => {},
  });
  const server = createServer(async (req, res) => { if (!(await api.handle(req, res, new URL(req.url, 'http://x')))) res.writeHead(404).end(); });
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (method, path, { token, body, headers } = {}) => fetch(base + path, {
    method, redirect: 'manual',
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  return { store, call, close: () => { server.closeAllConnections(); server.close(); } };
}

test('토큰이 없거나 틀리면 403, 라우트 밖 경로는 처리하지 않는다', async () => {
  const t = await boot();
  assert.equal((await t.call('GET', '/api/harness')).status, 403);
  assert.equal((await t.call('GET', '/api/harness', { token: 'nope' })).status, 403);
  assert.equal((await t.call('GET', '/healthz')).status, 404);
  t.close();
});

test('스냅샷은 대시보드 토큰으로 읽고, 내부 값(md_sha256)은 내보내지 않으며 ETag로 304를 준다', async () => {
  const t = await boot();
  const res = await t.call('GET', '/api/harness', { token: DASH });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.agents[0].id, 'lumi');
  assert.deepEqual(body.agents[0].clips, ['working']);
  assert.equal('md_sha256' in body.agents[0], false);
  const again = await t.call('GET', '/api/harness', { token: DASH, headers: { 'If-None-Match': res.headers.get('etag') } });
  assert.equal(again.status, 304);
  t.close();
});

test('에이전트 토큰은 보고할 수 있지만 읽기·삭제는 못 한다', async () => {
  const t = await boot();
  const r = await t.call('POST', '/api/harness/report', { token: AGENT, body: { agent: 'lumi', kind: 'start', message: '분석', steps: 'a|b' } });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).status, 'working');
  await t.call('POST', '/api/harness/report', { token: AGENT, body: { agent: 'lumi', kind: 'step' } });
  assert.equal(t.store._db.agents[0].progress, 50);
  assert.equal(t.store._db.events.length, 2);
  assert.equal((await t.call('GET', '/api/harness', { token: AGENT })).status, 200); // 헤더 인증은 둘 다 통과하지만
  const id = t.store._db.sections[0].id;
  assert.equal((await t.call('DELETE', '/api/harness/sections/' + id, { token: AGENT })).status, 403);
  t.close();
});

test('보고 오류: 없는 에이전트 404, 알 수 없는 종류 400, 비밀값 400, 큰 본문 413', async () => {
  const t = await boot();
  const post = (body, token = DASH) => t.call('POST', '/api/harness/report', { token, body });
  assert.equal((await post({ agent: 'ghost', kind: 'info', message: 'x' })).status, 404);
  assert.equal((await post({ agent: 'lumi', kind: 'explode' })).status, 400);
  assert.equal((await post({ agent: 'lumi', kind: 'info', message: 'key sk-abcdefghijklmnopqrstuv' })).status, 400);
  assert.equal((await post('{not json')).status, 400);
  assert.equal((await post({ agent: 'lumi', kind: 'info', message: 'x'.repeat(70000) })).status, 413);
  t.close();
});

test('assign은 이름으로 부서를 찾고, 없는 부서는 404', async () => {
  const t = await boot();
  const ok = await t.call('POST', '/api/harness/report', { token: AGENT, body: { agent: 'lumi', kind: 'assign', section: '인사팀', task: '채용 공고' } });
  assert.equal(ok.status, 200);
  assert.equal(t.store._db.agents[0].section_id, t.store._db.sections[0].id);
  assert.equal((await t.call('POST', '/api/harness/report', { token: AGENT, body: { agent: 'lumi', kind: 'assign', section: '없는팀' } })).status, 404);
  t.close();
});

test('같은 에이전트에 동시에 들어온 보고는 유실 없이 반영된다', async () => {
  const t = await boot();
  await runReport(t.store, { agent: 'lumi', kind: 'start', message: '일', steps: ['1', '2', '3'] });
  await Promise.all([1, 2, 3].map(() => runReport(t.store, { agent: 'lumi', kind: 'step' })));
  assert.equal(t.store._db.agents[0].progress, 100);
  t.close();
});

test('섹션 추가: 검증, 중복 409, 상위 부서 이름 지정', async () => {
  const t = await boot();
  const add = (body) => t.call('POST', '/api/harness/sections', { token: DASH, body });
  assert.equal((await add({ name: '' })).status, 400);
  assert.equal((await add({ name: '팀', pose: 'nope' })).status, 400);
  assert.equal((await add({ name: '팀', color: 'red' })).status, 400);
  assert.equal((await add({ name: '인사팀' })).status, 409);
  assert.equal((await add({ name: '채용', parent: '없음' })).status, 404);
  const ok = await add({ name: '채용', parent: '인사팀', pose: 'happy', color: 'mint' });
  assert.equal(ok.status, 201);
  assert.equal(t.store._db.sections.find((s) => s.name === '채용').parent_id, t.store._db.sections[0].id);
  t.close();
});

test('위젯은 (섹션, 제목)으로 덮어쓰고, 잘못된 입력은 400', async () => {
  const t = await boot();
  const put = (body) => t.call('PUT', '/api/harness/widgets', { token: AGENT, body });
  const w = { section: '인사팀', title: '지표', type: 'kpi', data: { items: [{ label: 'a', value: 1 }] } };
  assert.equal((await put(w)).status, 200);
  assert.equal((await put({ ...w, data: { items: [{ label: 'a', value: 2 }] } })).status, 200);
  assert.equal(t.store._db.widgets.length, 1);
  assert.equal(t.store._db.widgets[0].data.items[0].value, 2);
  assert.equal((await put({ ...w, type: 'pie' })).status, 400);
  assert.equal((await put({ ...w, data: [] })).status, 400);
  assert.equal((await put({ ...w, section: '없는팀' })).status, 404);
  t.close();
});

test('섹션 삭제는 대시보드 토큰만, 소속 에이전트는 대기실로', async () => {
  const t = await boot();
  const id = t.store._db.sections[0].id;
  t.store._db.agents[0].section_id = id;
  assert.equal((await t.call('DELETE', '/api/harness/sections/' + id, { token: DASH })).status, 200);
  assert.equal(t.store._db.agents[0].section_id, null);
  assert.equal((await t.call('DELETE', '/api/harness/sections/' + id, { token: DASH })).status, 404);
  t.close();
});

test('모션: 클립이 있으면 서명 URL로 302, 없으면 404, 에이전트 토큰은 403', async () => {
  const t = await boot();
  const hit = await t.call('GET', '/api/harness/motion/lumi/working', { token: DASH });
  assert.equal(hit.status, 302);
  assert.match(hit.headers.get('location'), /^https:\/\/storage\.example\.test\//);
  assert.equal((await t.call('GET', '/api/harness/motion/lumi/idle', { token: DASH })).status, 404);
  assert.equal((await t.call('GET', '/api/harness/motion/lumi/bogus', { token: DASH })).status, 404);
  assert.equal((await t.call('GET', '/api/harness/motion/lumi/working', { token: AGENT })).status, 403);
  t.close();
});

const login = async (t, token = DASH) => {
  const res = await t.call('POST', '/harness/login', { body: new URLSearchParams({ token }).toString(), headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Sec-Fetch-Site': 'same-origin' } });
  return { res, cookie: (res.headers.get('set-cookie') ?? '').split(';')[0] };
};

test('로그인 전 /harness는 로그인 폼, 주소의 ?token=은 무시한다', async () => {
  const t = await boot();
  const res = await t.call('GET', '/harness?token=' + DASH);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /<form method="post" action="\/harness\/login">/);
  assert.ok(!html.includes('const state ='), '대시보드 본문이 나오면 안 된다');
  assert.equal((await t.call('GET', '/api/harness?token=' + DASH)).status, 403); // 쿼리 토큰은 API에서도 받지 않는다
  t.close();
});

test('로그인(POST): 맞는 토큰이면 HttpOnly 쿠키, 그 쿠키로 페이지와 API를 쓴다', async () => {
  const t = await boot();
  const { res, cookie } = await login(t);
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/harness');
  const setc = res.headers.get('set-cookie');
  assert.match(setc, /HttpOnly/); assert.match(setc, /SameSite=Strict/); assert.match(setc, /Max-Age=43200/);
  assert.ok(!setc.includes(DASH), '쿠키에 토큰 자체가 들어가면 안 된다');

  const page = await t.call('GET', '/harness', { headers: { Cookie: cookie } });
  const csp = page.headers.get('content-security-policy');
  const nonce = /'nonce-([^']+)'/.exec(csp)[1];
  const html = await page.text();
  assert.ok(html.includes(`<script nonce="${nonce}">`) && !html.includes('__NONCE__'));
  assert.match(csp, /media-src 'self' https:\/\/proj\.supabase\.co/);
  assert.equal(page.headers.get('referrer-policy'), 'no-referrer');
  assert.equal((await t.call('GET', '/api/harness', { headers: { Cookie: cookie } })).status, 200);
  assert.equal((await t.call('GET', '/api/harness/motion/lumi/working', { headers: { Cookie: cookie } })).status, 302);
  t.close();
});

test('로그인 실패: 403과 로그인 폼, 쿠키 없음. 에이전트 토큰으로는 로그인 못 한다', async () => {
  const t = await boot();
  for (const bad of ['nope', AGENT, '']) {
    const { res } = await login(t, bad);
    assert.equal(res.status, 403);
    assert.equal(res.headers.get('set-cookie'), null);
    assert.match(await res.text(), /토큰이 맞지 않아요/);
  }
  assert.equal((await t.call('POST', '/harness/login', { body: new URLSearchParams({ token: DASH }).toString(), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })).status, 403); // 같은 출처 표시가 없으면 거부
  t.close();
});

test('쿠키 세션: 위조·만료·토큰 교체 후에는 무효, 쿠키로 쓰는 쓰기는 같은 출처만', async () => {
  const t = await boot();
  const { cookie } = await login(t);
  const forged = cookie.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'));
  assert.equal((await t.call('GET', '/api/harness', { headers: { Cookie: forged } })).status, 403);
  assert.equal((await t.call('GET', '/api/harness', { headers: { Cookie: 'harness_session=1.abc' } })).status, 403);

  const body = { agent: 'lumi', kind: 'info', message: 'x' };
  assert.equal((await t.call('POST', '/api/harness/report', { body, headers: { Cookie: cookie } })).status, 403); // 출처 표시 없음
  assert.equal((await t.call('POST', '/api/harness/report', { body, headers: { Cookie: cookie, 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  assert.equal((await t.call('POST', '/api/harness/report', { body, headers: { Cookie: cookie, 'Sec-Fetch-Site': 'same-origin' } })).status, 200);
  // Bearer 토큰(에이전트·스크립트)은 출처 표시가 필요 없다
  assert.equal((await t.call('POST', '/api/harness/report', { token: AGENT, body })).status, 200);

  // 같은 쿠키를 다른 DASHBOARD_TOKEN을 쓰는 서버에 내밀면 거부된다
  const other = createHarnessApi({ store: t.store, dashboardToken: 'rotated', agentToken: AGENT, sprites: SPRITES, pageHtml: 'x', onError: () => {} });
  const res = { writeHead(c) { this.c = c; return this; }, setHeader() {}, end() { return this; } };
  await other.handle({ method: 'GET', headers: { cookie: cookie } }, res, new URL('http://x/api/harness'));
  assert.equal(res.c, 403);
  t.close();
});

test('로그아웃은 쿠키를 지운다', async () => {
  const t = await boot();
  const { cookie } = await login(t);
  const out = await t.call('POST', '/harness/logout', { headers: { Cookie: cookie, 'Sec-Fetch-Site': 'same-origin' } });
  assert.equal(out.status, 200);
  assert.match(out.headers.get('set-cookie'), /Max-Age=0/);
  t.close();
});

test('Supabase 설정이 없으면 인증 후 503 (페이지는 열린다)', async () => {
  const t = await boot({ withStore: false });
  assert.equal((await t.call('GET', '/api/harness')).status, 403);
  assert.equal((await t.call('GET', '/api/harness', { token: DASH })).status, 503);
  assert.equal((await t.call('GET', '/harness')).status, 200); // 로그인 폼
  t.close();
});

// ---- 작업 지시 요청함 ----
const task = (t, token, body) => t.call('POST', '/api/harness/tasks', { token, body });

test('작업 지시: 사람(대시보드)만 만들 수 있고, 내용·비밀값·없는 에이전트·대기 상한을 검사한다', async () => {
  const t = await boot();
  assert.equal((await task(t, DASH, { agent: 'lumi', body: '10월 지출 분석\n이상치 위주로' })).status, 201);
  assert.equal(t.store._db.tasks[0].body, '10월 지출 분석\n이상치 위주로'); // 줄바꿈은 유지
  assert.equal(t.store._db.tasks[0].status, 'queued');
  assert.equal((await task(t, AGENT, { agent: 'lumi', body: 'x' })).status, 403); // 에이전트는 서로에게 일을 시키지 못한다
  assert.equal((await task(t, DASH, { agent: 'lumi', body: '   ' })).status, 400);
  assert.equal((await task(t, DASH, { agent: 'lumi', body: 'x'.repeat(2001) })).status, 400);
  assert.equal((await task(t, DASH, { agent: 'lumi', body: 'a\u0000b' })).status, 400);
  assert.equal((await task(t, DASH, { agent: 'lumi', body: 'key sk-abcdefghijklmnopqrstuv' })).status, 400);
  assert.equal((await task(t, DASH, { agent: 'ghost', body: 'x' })).status, 404);
  assert.equal((await task(t, DASH, { agent: 'Bad Id', body: 'x' })).status, 400);
  for (let i = 0; i < 19; i++) await task(t, DASH, { agent: 'lumi', body: 'n' + i });
  assert.equal((await task(t, DASH, { agent: 'lumi', body: '넘침' })).status, 409); // 20개 상한
  t.close();
});

test('에이전트가 next로 가장 오래된 작업을 하나씩 가져가고, done 보고로 닫힌다', async () => {
  const t = await boot();
  await task(t, DASH, { agent: 'lumi', body: '첫째' }); await task(t, DASH, { agent: 'lumi', body: '둘째' });
  const next = async () => (await (await t.call('POST', '/api/harness/tasks/next', { token: AGENT, body: { agent: 'lumi' } })).json()).task;
  const a = await next();
  assert.equal(a.body, '첫째');
  assert.equal(t.store._db.tasks.find((x) => x.id === a.id).status, 'claimed');
  assert.equal((await next()).body, '둘째');
  assert.equal(await next(), null); // 비었으면 null

  await t.call('POST', '/api/harness/report', { token: AGENT, body: { agent: 'lumi', kind: 'start', message: '일' } });
  await t.call('POST', '/api/harness/report', { token: AGENT, body: { agent: 'lumi', kind: 'done', message: '끝' } });
  assert.deepEqual(t.store._db.tasks.map((x) => x.status), ['done', 'done']);

  await task(t, DASH, { agent: 'lumi', body: '셋째' });
  await next();
  await t.call('POST', '/api/harness/report', { token: AGENT, body: { agent: 'lumi', kind: 'fail', message: '실패' } });
  assert.equal(t.store._db.tasks[2].status, 'failed');
  t.close();
});

test('작업 상태 변경: 허용된 전이만, 취소는 사람도 가능', async () => {
  const t = await boot();
  const id = (await (await task(t, DASH, { agent: 'lumi', body: '일' })).json()).id;
  const patch = (status, token = DASH) => t.call('PATCH', '/api/harness/tasks/' + id, { token, body: { status } });
  assert.equal((await patch('done')).status, 409); // 대기 중에서 바로 완료는 안 됨
  assert.equal((await patch('bogus')).status, 409);
  assert.equal((await patch('cancelled')).status, 200);
  assert.equal((await patch('claimed')).status, 409); // 취소된 작업은 되살릴 수 없음
  assert.equal((await t.call('PATCH', '/api/harness/tasks/00000000-0000-4000-8000-000000000000', { token: DASH, body: { status: 'cancelled' } })).status, 404);
  assert.equal((await t.call('PATCH', '/api/harness/tasks/' + id, { body: { status: 'cancelled' } })).status, 403);
  t.close();
});

test('목록·스냅샷: 에이전트별 필터, 스냅샷에 작업이 들어간다', async () => {
  const t = await boot();
  await task(t, DASH, { agent: 'lumi', body: '일' });
  const list = await (await t.call('GET', '/api/harness/tasks?agent=lumi&status=queued', { token: AGENT })).json();
  assert.equal(list.tasks.length, 1);
  assert.equal((await t.call('GET', '/api/harness/tasks?status=weird', { token: DASH })).status, 400);
  const snap = await (await t.call('GET', '/api/harness', { token: DASH })).json();
  assert.equal(snap.tasks[0].body, '일');
  t.close();
});

const PW = 'pw-for-test-1234';
const adminRow = async (username = 'tester', pw = PW) => ({ username, password_hash: await hashPassword(pw) });
const formLogin = (t, o) => t.call('POST', '/harness/login', { body: new URLSearchParams(o).toString(), headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Sec-Fetch-Site': 'same-origin' } });

test('계정이 테이블에 있으면 아이디/비밀번호 폼, 둘 다 맞아야 하고 토큰으로는 폼 로그인이 안 된다', async () => {
  const t = await boot({ admins: [await adminRow()] });
  const html = await (await t.call('GET', '/harness')).text();
  assert.match(html, /name="username"/); assert.match(html, /name="password"/); assert.ok(!html.includes('name="token"'));

  const ok = await formLogin(t, { username: 'Tester', password: PW }); // 아이디는 대소문자 무시
  assert.equal(ok.status, 303);
  const cookie = ok.headers.get('set-cookie').split(';')[0];
  assert.equal((await t.call('GET', '/api/harness', { headers: { Cookie: cookie } })).status, 200);

  for (const bad of [{ username: 'tester', password: 'x' }, { username: 'nobody', password: PW }, { token: DASH }, { username: '', password: '' }]) {
    const r = await formLogin(t, bad);
    assert.equal(r.status, 403); assert.equal(r.headers.get('set-cookie'), null);
    assert.match(await r.text(), /아이디 또는 비밀번호/);
  }
  assert.equal((await t.call('GET', '/api/harness', { token: DASH })).status, 200); // 스크립트용 Bearer는 그대로
  t.close();
});

test('계정이 하나도 없으면 최초 설정용 토큰 로그인', async () => {
  const t = await boot();
  assert.match(await (await t.call('GET', '/harness')).text(), /name="token"/);
  assert.equal((await login(t)).res.status, 303);
  t.close();
});

test('비밀번호를 바꾸거나 계정을 지우면 기존 세션이 무효가 된다', async () => {
  const t = await boot({ admins: [await adminRow()] });
  const cookie = (await formLogin(t, { username: 'tester', password: PW })).headers.get('set-cookie').split(';')[0];
  const get = () => t.call('GET', '/api/harness', { headers: { Cookie: cookie } });
  assert.equal((await get()).status, 200);
  t.store._db.admins[0].password_hash = (await adminRow('tester', 'another-pw-5678')).password_hash;
  assert.equal((await get()).status, 403);
  t.store._db.admins.length = 0;
  assert.equal((await get()).status, 403);
  t.close();
});

test('세션 쿠키는 암호화되어 있어 토큰·아이디·만료 시각이 평문으로 보이지 않고, 변조하면 무효', async () => {
  const t = await boot({ admins: [await adminRow()] });
  const r = await formLogin(t, { username: 'tester', password: PW });
  const value = r.headers.get('set-cookie').split(';')[0].split('=')[1];
  assert.match(value, /^[0-9a-f]{24}\.[0-9a-f]+\.[0-9a-f]{32}$/);
  const raw = Buffer.from(value.split('.')[1], 'hex').toString('latin1');
  assert.ok(!raw.includes('tester') && !raw.includes('exp') && !value.includes(DASH));
  const [iv, ct, tag] = value.split('.');
  const flipped = `${iv}.${(ct[0] === '0' ? '1' : '0') + ct.slice(1)}.${tag}`;
  assert.equal((await t.call('GET', '/api/harness', { headers: { Cookie: 'harness_session=' + flipped } })).status, 403);
  t.close();
});
