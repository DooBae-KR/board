#!/usr/bin/env node
// agents/*.md 정의를 Supabase harness_agents에 반영한다 (CLAUDE.md 1·3장).
// 사용: node --env-file=.env scripts/agents-sync.js [--dry-run] [--prune]
//  --dry-run  검사와 변경 계획만 출력 (DB 접속 안 함)
//  --prune    MD가 없는 에이전트를 보관 처리(archived_at). 기록은 지우지 않는다.
// 정의 컬럼만 덮어쓴다. 현재 부서·업무·진행률 같은 런타임 값은 건드리지 않는다.
// 새 에이전트만 department를 처음 배치 부서로 쓴다. 이후 이동은 harness-report.js assign.
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readAgentsDir, motionPath, isLobby } from './lib/harness.js';
import { createClient } from './lib/supabase.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const prune = args.has('--prune');

const { agents, errors } = readAgentsDir(join(root, 'agents'), root);
if (errors.length) {
  console.error(`agents/ 검사 실패 (${errors.length}건):\n- ` + errors.join('\n- '));
  process.exit(1);
}
console.log(`agents/ 정의 ${agents.length}개 확인`);

const DEF_COLS = ['id', 'name', 'role', 'pose', 'color', 'model', 'substrate_template', 'motions', 'tools', 'example', 'md_path', 'md_sha256'];
const pick = (a) => Object.fromEntries(DEF_COLS.map((k) => [k, a[k]]));

if (dryRun) {
  for (const a of agents) console.log(`  ${a.id.padEnd(12)} ${a.name} · ${a.role} · 기본 부서: ${a.department || '대기실'} · 모션 ${a.motions.length}개`);
  console.log('--dry-run: DB는 바꾸지 않았습니다');
  process.exit(0);
}

const db = createClient();

// 1) 부서: 없는 부서는 만든다 (상위 부서 먼저)
const sections = await db.select('harness_sections', 'select=id,name');
const byName = new Map(sections.map((s) => [s.name, s]));
async function ensureSection(name, parentName) {
  if (isLobby(name)) return null;
  if (byName.has(name)) return byName.get(name);
  const parent = parentName && !isLobby(parentName) ? await ensureSection(parentName, '') : null;
  const [row] = await db.insert('harness_sections', [{ name, parent_id: parent ? parent.id : null }]);
  byName.set(name, row);
  console.log(`  + 부서 생성: ${name}${parent ? ` (상위: ${parent.name})` : ''}`);
  return row;
}
const deptOf = new Map();
for (const a of agents) deptOf.set(a.id, await ensureSection(a.department, a.parent_department));

// 2) 에이전트: 기존 행은 정의만, 새 행은 첫 배치까지
const existing = new Map((await db.select('harness_agents', 'select=id,archived_at')).map((r) => [r.id, r]));
const fresh = agents.filter((a) => !existing.has(a.id));
const known = agents.filter((a) => existing.has(a.id));
if (known.length) await db.upsert('harness_agents', known.map((a) => ({ ...pick(a), archived_at: null })), 'id');
if (fresh.length) {
  await db.upsert('harness_agents', fresh.map((a) => {
    const d = deptOf.get(a.id);
    return { ...pick(a), section_id: d ? d.id : null, status: 'waiting' };
  }), 'id');
  await db.insert('harness_agent_events', fresh.filter((a) => deptOf.get(a.id)).map((a) => ({
    agent_id: a.id, kind: 'assign', to_section: deptOf.get(a.id).id, message: `대기실 → ${deptOf.get(a.id).name} 배치 (정의 동기화)`,
  })));
}
console.log(`  에이전트: 새로 추가 ${fresh.length} · 정의 갱신 ${known.length}`);

// 3) 모션 클립 경로 (렌더 결과 경로·해시는 렌더 단계에서 채운다)
const motionRows = agents.flatMap((a) => a.motions.map((state) => ({ agent_id: a.id, state, composition_path: motionPath(root, a.id, state) })));
if (motionRows.length) await db.upsert('harness_agent_motions', motionRows, 'agent_id,state');
console.log(`  모션 클립 ${motionRows.length}개 경로 갱신`);

// 4) --prune: MD가 사라진 에이전트 보관
if (prune) {
  const ids = new Set(agents.map((a) => a.id));
  const gone = [...existing.values()].filter((r) => !ids.has(r.id) && !r.archived_at);
  for (const r of gone) await db.update('harness_agents', db.eq('id', r.id), { archived_at: new Date().toISOString(), status: 'waiting' });
  console.log(`  보관 처리 ${gone.length}명${gone.length ? ': ' + gone.map((r) => r.id).join(', ') : ''}`);
}
console.log('동기화 완료');
