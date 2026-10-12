import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSystem, buildUser, extractText, splitAnswer, runAgents, RULES } from './agent-runner.js';

const agent = { id: 'stock-analyst', name: '미장분석', role: '분석', body: '본문 지침', department: '우리 허브' };

test('시스템 프롬프트에 정의와 실행 규칙이 들어가고, 질문은 task 태그로 감싼다', () => {
  const s = buildSystem(agent);
  assert.ok(s.includes('본문 지침') && s.includes(RULES.trim().slice(0, 20)) && s.includes('단정하지 않는다'));
  assert.equal(buildUser({ body: '질문' }), '<task>\n질문\n</task>');
});

test('응답에서 text 블록만 모으고 첫 문단을 요약으로 자른다', () => {
  assert.equal(extractText([{ type: 'server_tool_use' }, { type: 'text', text: '가' }, { type: 'web_search_tool_result' }, { type: 'text', text: '나' }]), '가나');
  const { summary, full } = splitAnswer('요약 한 줄\n둘째 줄\n\n본문 시작');
  assert.equal(summary, '요약 한 줄 둘째 줄'); assert.ok(full.includes('본문 시작'));
  assert.equal(splitAnswer('가'.repeat(900)).summary.length, 480);
});

const mk = (tasks, ask) => {
  const log = [], q = [...tasks];
  return { log, deps: { claim: async () => q.shift() ?? null, report: async (id, kind, message, extra) => { log.push([kind, message, extra?.steps]); }, ask, putAnswers: async (a, items) => log.push(['widget', a.department, items.length]), now: () => 't' } };
};

test('작업을 가져와 start → step → done 순서로 보고하고 답변 위젯을 한 번 올린다', async () => {
  const { log, deps } = mk([{ id: 1, body: '질문1' }, { id: 2, body: '질문2' }], async () => '요약\n\n본문');
  const r = await runAgents([agent], deps, { maxTasks: 3 });
  assert.deepEqual(r.map((x) => x.ok), [true, true]);
  assert.deepEqual(log.map((l) => l[0]), ['start', 'step', 'done', 'start', 'step', 'done', 'widget']);
  assert.equal(log[0][2], '질문 확인|답변 작성'); assert.deepEqual(log.at(-1), ['widget', '우리 허브', 2]);
});

test('대기 작업이 없으면 아무것도 보고하지 않고, 실패하면 fail로 닫고 다음 작업을 계속한다', async () => {
  const none = mk([], async () => 'x');
  assert.deepEqual(await runAgents([agent], none.deps), []); assert.equal(none.log.length, 0);
  let n = 0;
  const { log, deps } = mk([{ id: 1, body: 'a' }, { id: 2, body: 'b' }], async () => { if (n++ === 0) throw new Error('모델 호출 실패 (529)'); return '답'; });
  const r = await runAgents([agent], deps);
  assert.deepEqual(r.map((x) => x.ok), [false, true]);
  assert.ok(log.some((l) => l[0] === 'fail' && /529/.test(l[1])));
  const empty = mk([{ id: 3, body: 'c' }], async () => '');
  assert.equal((await runAgents([agent], empty.deps))[0].ok, false);
});

test('maxTasks를 넘겨 가져가지 않는다', async () => {
  const { deps } = mk([1, 2, 3, 4].map((id) => ({ id, body: 'q' })), async () => 'a');
  assert.equal((await runAgents([agent], deps, { maxTasks: 2 })).length, 2);
});
