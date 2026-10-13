import test from 'node:test';
import assert from 'node:assert/strict';
import { checkEnv, checkRepos, checkOnline, runChecks, render, exitCode } from './check-bot.js';

const SECRETS = { VERIFY_TOKEN: 'verify-secret-111', APP_SECRET: 'appsecret-222222', SUPABASE_URL: 'https://x.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-333333', DASHBOARD_TOKEN: 'dash-token-444444', HARNESS_API_TOKEN: 'harness-555555',
  IG_KO_USER_ID: '111', IG_KO_ACCESS_TOKEN: 'IGQ-ko-token-666666', IG_EN_USER_ID: '222', IG_EN_ACCESS_TOKEN: 'IGQ-en-token-777777' };
const goodRepos = [
  { id: 'a-ko', mediaId: '1789', keyword: '링크', name: 'A', url: 'https://github.com/o/a' },
  { id: 'a-en', mediaId: '1790', keyword: 'link', name: 'A', url: 'https://github.com/o/a' },
];
const by = (rows, name) => rows.find((r) => r.name === name);
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });

test('환경변수: 전부 있으면 실패 없음', () => {
  assert.equal(exitCode(checkEnv(SECRETS)), 0);
});
test('환경변수: 비어 있으면 실패, 반쪽 계정도 실패', () => {
  const rows = checkEnv({ IG_KO_USER_ID: '1' });
  assert.equal(by(rows, 'VERIFY_TOKEN').status, 'fail');
  assert.equal(by(rows, 'IG_KO_*').status, 'fail');
  assert.equal(by(rows, '봇 계정').status, 'fail');
  assert.equal(exitCode(rows), 1);
});
test('환경변수: 영어 계정만 완전해도 통과, HARNESS_API_TOKEN 없음은 경고', () => {
  const env = { ...SECRETS, IG_KO_USER_ID: '', IG_KO_ACCESS_TOKEN: '', HARNESS_API_TOKEN: '' };
  const rows = checkEnv(env);
  assert.equal(by(rows, 'IG_KO_*').status, 'warn');
  assert.equal(by(rows, 'HARNESS_API_TOKEN').status, 'warn');
  assert.equal(exitCode(rows), 0);
});
test('repos: 정상', () => {
  const rows = checkRepos(goodRepos);
  assert.equal(exitCode(rows), 0);
  assert.equal(by(rows, 'placeholder mediaId').status, 'pass');
});
test('repos: 형식 오류는 실패, placeholder는 경고', () => {
  assert.equal(checkRepos({})[0].status, 'fail');
  assert.equal(checkRepos(null)[0].status, 'fail');
  const rows = checkRepos([{ ...goodRepos[0], mediaId: '한국어 계정 릴스 미디어 ID' }, goodRepos[1]]);
  assert.equal(by(rows, 'placeholder mediaId').status, 'warn');
  assert.match(by(rows, 'placeholder mediaId').detail, /a-ko/);
});
test('repos: 키워드 없으면 경고, 같은 영상 같은 키워드는 실패, 포함관계는 경고', () => {
  assert.equal(by(checkRepos([goodRepos[0]]), '영어 키워드').status, 'warn');
  const dup = checkRepos([goodRepos[0], { ...goodRepos[1], mediaId: '1789', keyword: '링크' }]);
  assert.equal(exitCode(dup), 1);
  const risk = checkRepos([goodRepos[0], { ...goodRepos[1], id: 'x', mediaId: '1789', keyword: '링크주세요' }]);
  assert.equal(by(risk, 'keyword 중복 위험').status, 'warn');
});

function fakeFetch({ meOk = true, fields = ['comments', 'messages'], hook = 'ok', throws = false } = {}) {
  return async (u) => {
    if (throws) throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } });
    u = String(u);
    if (u.includes('/webhook')) {
      const c = new URL(u).searchParams.get('hub.challenge');
      return hook === 'ok' ? new Response(c) : new Response('forbidden', { status: 403 });
    }
    if (u.includes('/me?')) return meOk ? json({ user_id: '111', username: 'tester' }) : json({ error: { message: 'Invalid OAuth access token' } }, 400);
    return json({ data: [{ subscribed_fields: fields }] });
  };
}

test('온라인: 정상', async () => {
  const rows = await checkOnline({ env: SECRETS, fetchImpl: fakeFetch(), url: 'https://site.example/' });
  assert.equal(exitCode(rows), 0);
  assert.equal(by(rows, '핸드셰이크').status, 'pass');
});
test('온라인: 토큰 무효/구독 누락/핸드셰이크 실패는 실패', async () => {
  assert.equal(by(await checkOnline({ env: SECRETS, fetchImpl: fakeFetch({ meOk: false }) }), '토큰 유효성 /me').status, 'fail');
  assert.equal(by(await checkOnline({ env: SECRETS, fetchImpl: fakeFetch({ fields: ['comments'] }) }), '구독 messages').status, 'fail');
  assert.equal(by(await checkOnline({ env: SECRETS, fetchImpl: fakeFetch({ hook: 'bad' }), url: 'https://s.example' }), '핸드셰이크').status, 'fail');
});
test('온라인: 네트워크 실패는 확인못함이며 실패 코드가 아님', async () => {
  const rows = await checkOnline({ env: SECRETS, fetchImpl: fakeFetch({ throws: true }), url: 'https://s.example' });
  assert.ok(rows.every((r) => r.status === 'unknown'));
  assert.equal(exitCode(rows), 0);
});
test('토큰은 Authorization 헤더로만 보내고 URL에 넣지 않는다', async () => {
  const seen = [];
  const f = async (u, o) => { seen.push([String(u), o?.headers?.Authorization]); return json({ user_id: '111', data: [] }); };
  await checkOnline({ env: SECRETS, fetchImpl: f });
  assert.ok(seen.length >= 2);
  for (const [u, h] of seen) { assert.ok(!u.includes('IGQ'), u); assert.match(h, /^Bearer IGQ-/); }
});
test('출력 어디에도 비밀값이 없다(오류 본문에 섞여도 가림)', async () => {
  const leaky = async () => json({ error: { message: `bad token IGQ-ko-token-666666 / ${SECRETS.APP_SECRET}` } }, 400);
  const rows = await runChecks({ env: SECRETS, reposData: goodRepos, online: true, url: 'https://s.example', fetchImpl: leaky });
  const out = render(rows, SECRETS);
  for (const k of ['VERIFY_TOKEN', 'APP_SECRET', 'SUPABASE_SERVICE_ROLE_KEY', 'DASHBOARD_TOKEN', 'HARNESS_API_TOKEN', 'IG_KO_ACCESS_TOKEN', 'IG_EN_ACCESS_TOKEN']) {
    assert.ok(!out.includes(SECRETS[k]), `${k} 값이 출력에 있음`);
  }
  assert.match(out, /VERIFY_TOKEN/); // 이름은 나온다
});
