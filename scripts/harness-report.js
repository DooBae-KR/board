#!/usr/bin/env node
// 에이전트 진행 보고 (CLAUDE.md 6장)
// 사용:
//   node scripts/harness-report.js <id> start    "업무 이름" --steps "단계1|단계2|단계3"
//   node scripts/harness-report.js <id> step     ["끝낸 단계 한 줄"]
//   node scripts/harness-report.js <id> progress 60 ["메모"]      (단계가 없는 업무만)
//   node scripts/harness-report.js <id> blocked  "확인이 필요한 이유"
//   node scripts/harness-report.js <id> done     "결과 한 줄" [산출물 경로]
//   node scripts/harness-report.js <id> fail     "원인"
//   node scripts/harness-report.js <id> assign   "부서 이름|대기실" ["새 업무"]
//   node scripts/harness-report.js <id> info     "메모"
// 전달 방식 (자동 선택)
//   HARNESS_API_URL + HARNESS_API_TOKEN 이 있으면 서버 API(POST /api/harness/report)로 보낸다 → 에이전트(Actor)용.
//   없으면 SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY로 직접 쓴다 → 서버 관리자·로컬 개발용.
import { REPORT_KINDS } from './lib/harness.js';

const argv = process.argv.slice(2);
const flag = (name) => { const i = argv.indexOf(name); if (i < 0) return null; const v = argv[i + 1]; argv.splice(i, 2); return v ?? ''; };
const stepsArg = flag('--steps');
const [agent, kind, a1, a2] = argv;

if (!agent || !REPORT_KINDS.includes(kind)) {
  console.error(`usage: harness-report.js <agent-id> <${REPORT_KINDS.join('|')}> ...  (CLAUDE.md 6장 참고)`);
  process.exit(1);
}

const input = { agent, kind, message: a1 };
if (kind === 'start') input.steps = stepsArg ?? '';
if (kind === 'progress') Object.assign(input, { value: a1, message: a2 });
if (kind === 'done') input.output = a2;
if (kind === 'assign') Object.assign(input, { section: a1 ?? '', task: a2, message: '' });

const { HARNESS_API_URL, HARNESS_API_TOKEN } = process.env;
try {
  let out;
  if (HARNESS_API_URL) {
    if (!HARNESS_API_TOKEN) throw new Error('HARNESS_API_URL을 쓰려면 HARNESS_API_TOKEN도 필요합니다');
    // 복원된 Actor에서도 안전하도록 요청마다 새로 연결한다 (CLAUDE.md 4-3)
    const res = await fetch(new URL('/api/harness/report', HARNESS_API_URL), {
      method: 'POST',
      headers: { Authorization: `Bearer ${HARNESS_API_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(15_000),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `서버가 ${res.status}로 응답했습니다`);
    out = body;
  } else {
    const [{ createClient }, { createStore }, { runReport }] = await Promise.all([
      import('./lib/supabase.js'), import('./lib/store.js'), import('./lib/report.js'),
    ]);
    out = await runReport(createStore(createClient()), input);
  }
  console.log(`${out.agent}: ${out.kind} 기록 · 상태 ${out.status} · 진행률 ${out.progress}%`);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
