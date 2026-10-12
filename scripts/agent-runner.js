#!/usr/bin/env node
// Actor 없이 대시보드 '작업 지시'를 처리하는 실행기 (GitHub Actions 등에서 주기적으로 실행)
//   node scripts/agent-runner.js
// 환경변수
//   HARNESS_API_URL, HARNESS_API_TOKEN   하네스 서버 (에이전트용 토큰만 쓴다. 서비스 롤 키는 쓰지 않는다)
//   ANTHROPIC_API_KEY                    답변을 만드는 모델 호출용 (CI 비밀값. 에이전트 정의·로그·답변에 넣지 않는다)
//   RUNNER_AGENTS=stock-analyst          처리할 에이전트 id (쉼표로 여러 명, 기본 stock-analyst)
//   RUNNER_MAX_TASKS=3                   한 번 실행에 에이전트당 처리할 최대 작업 수
//   RUNNER_WEB_SEARCH=1                  0이면 웹 검색 도구를 쓰지 않는다
// 키가 하나라도 없으면 작업을 가져가지 않고 끝낸다(요청함의 작업이 '진행 중'에 갇히지 않게).
import { readAgentFile } from './lib/harness.js';
import { runAgents, extractText } from './lib/agent-runner.js';

const env = process.env;
const need = ['HARNESS_API_URL', 'HARNESS_API_TOKEN', 'ANTHROPIC_API_KEY'].filter((k) => !env[k]);
if (need.length) { console.log(`${need.join(', ')}이(가) 비어 있어 작업을 가져가지 않았어요.`); process.exit(0); }

const ids = (env.RUNNER_AGENTS || 'stock-analyst').split(',').map((s) => s.trim()).filter(Boolean);
const maxTasks = Math.max(1, Math.min(10, Number(env.RUNNER_MAX_TASKS) || 3));
const base = env.HARNESS_API_URL.replace(/\/$/, '');

async function api(method, path, body) { // 요청마다 새로 연결한다 (CLAUDE.md 4-3)
  const res = await fetch(base + path, { method, headers: { authorization: `Bearer ${env.HARNESS_API_TOKEN}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20_000) });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error || `하네스 서버가 ${res.status}로 응답했습니다`);
  return out;
}

async function ask(system, user, agent) {
  const model = env.RUNNER_MODEL || agent.model || 'claude-sonnet-5-5';
  const useSearch = env.RUNNER_WEB_SEARCH !== '0';
  const call = async (messages, withTools) => {
    const res = await fetch((env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com') + '/v1/messages', {
      method: 'POST', headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: 2500, system, messages, ...(withTools ? { tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }] } : {}) }),
      signal: AbortSignal.timeout(180_000),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(`모델 호출 실패 (${res.status}): ${j.error?.message || '응답 없음'}`); e.status = res.status; throw e; }
    return j;
  };
  let withTools = useSearch, messages = [{ role: 'user', content: user }], out = '';
  for (let turn = 0; turn < 4; turn++) {
    let j;
    try { j = await call(messages, withTools); } catch (e) { if (withTools && e.status === 400) { withTools = false; j = await call(messages, false); } else throw e; } // 검색 도구를 못 쓰는 계정이면 검색 없이
    out += extractText(j.content);
    if (j.stop_reason !== 'pause_turn') break;
    messages = [...messages, { role: 'assistant', content: j.content }];
  }
  return out;
}

const agents = [];
for (const id of ids) {
  const r = readAgentFile(`agents/${id}.md`, '.');
  if (r.agent) agents.push({ ...r.agent }); else console.log(`${id}: 정의를 읽지 못했어요 (${r.errors?.[0] ?? '없음'})`);
}

const results = await runAgents(agents, {
  claim: async (id) => (await api('POST', '/api/harness/tasks/next', { agent: id })).task,
  report: (id, kind, message, extra = {}) => api('POST', '/api/harness/report', { agent: id, kind, message, ...extra }),
  ask,
  putAnswers: (agent, items) => api('PUT', '/api/harness/widgets', { section: agent.department || '우리 허브', type: 'feed', title: `${agent.name} 답변`, data: { items } }),
  now: () => new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }),
}, { maxTasks });

if (!results.length) console.log('대기 중인 작업이 없어요.');
for (const r of results) console.log(`${r.agent}: ${r.ok ? '완료' : '실패'} ${r.id ?? ''} ${r.error ?? ''}`.trim());
process.exit(results.some((r) => !r.ok) ? 1 : 0);
