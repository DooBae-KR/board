#!/usr/bin/env node
// 에이전트 진행 보고 → Supabase (CLAUDE.md 6장)
// 사용:
//   node --env-file=.env scripts/harness-report.js <id> start    "업무 이름" --steps "단계1|단계2|단계3"
//   node --env-file=.env scripts/harness-report.js <id> step     ["끝낸 단계 한 줄"]
//   node --env-file=.env scripts/harness-report.js <id> progress 60 ["메모"]      (단계가 없는 업무만)
//   node --env-file=.env scripts/harness-report.js <id> blocked  "확인이 필요한 이유"
//   node --env-file=.env scripts/harness-report.js <id> done     "결과 한 줄" [산출물 경로]
//   node --env-file=.env scripts/harness-report.js <id> fail     "원인"
//   node --env-file=.env scripts/harness-report.js <id> assign   "부서 이름|대기실" ["새 업무"]
//   node --env-file=.env scripts/harness-report.js <id> info     "메모"
import { applyReport, REPORT_KINDS, isLobby } from './lib/harness.js';
import { createClient } from './lib/supabase.js';

const argv = process.argv.slice(2);
const flag = (name) => { const i = argv.indexOf(name); if (i < 0) return null; const v = argv[i + 1]; argv.splice(i, 2); return v ?? ''; };
const stepsArg = flag('--steps');
const [id, kind, a1, a2] = argv;

if (!id || !REPORT_KINDS.includes(kind)) {
  console.error(`usage: harness-report.js <agent-id> <${REPORT_KINDS.join('|')}> ...  (CLAUDE.md 6장 참고)`);
  process.exit(1);
}

try {
  const db = createClient();
  const [agent] = await db.select('harness_agents', `select=*&${db.eq('id', id)}`);
  if (!agent) throw new Error(`에이전트 "${id}"가 없습니다. agents/${id}.md를 만들고 scripts/agents-sync.js를 먼저 실행하세요`);
  if (agent.archived_at) throw new Error(`에이전트 "${id}"는 보관 처리되어 있습니다`);

  const args = { message: a1 };
  if (kind === 'start') args.steps = stepsArg ? stepsArg.split('|').map((s) => s.trim()).filter(Boolean) : [];
  if (kind === 'progress') Object.assign(args, { value: a1, message: a2 });
  if (kind === 'done') args.output = a2;
  if (kind === 'assign') {
    const name = String(a1 ?? '').trim();
    if (!isLobby(name)) {
      const [sec] = await db.select('harness_sections', `select=id,name&${db.eq('name', name)}`);
      if (!sec) throw new Error(`부서 "${name}"를 찾지 못했습니다 (대시보드나 agents-sync로 먼저 만드세요)`);
      args.section = sec;
    }
    if (agent.section_id) {
      const [from] = await db.select('harness_sections', `select=name&${db.eq('id', agent.section_id)}`);
      args.fromName = from?.name;
    }
    Object.assign(args, { message: '', task: a2 });
  }

  const { patch, event } = applyReport(agent, kind, args);
  await db.update('harness_agents', db.eq('id', id), patch);
  await db.insert('harness_agent_events', [event]);
  const p = patch.progress ?? agent.progress;
  console.log(`${id}: ${kind} 기록 · 상태 ${patch.status ?? agent.status} · 진행률 ${p}%`);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
