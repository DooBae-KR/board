// agents/*.md 정의를 Supabase harness_agents에 반영한다 (CLAUDE.md 1·3장).
// scripts/agents-sync.js(CLI)와 서버 시작 시 동기화가 같이 쓴다.
// 정의 컬럼만 덮어쓴다. 현재 부서·업무·진행률 같은 런타임 값은 건드리지 않는다.
// 새 에이전트만 department를 처음 배치 부서로 쓴다. 이후 이동은 보고(assign)로 한다.
import { join } from 'node:path';
import { readAgentsDir, motionPath, isLobby } from './harness.js';

const DEF_COLS = ['id', 'name', 'role', 'pose', 'color', 'model', 'substrate_template', 'motions', 'tools', 'example', 'md_path', 'md_sha256'];
const pick = (a) => Object.fromEntries(DEF_COLS.map((k) => [k, a[k]]));

/** @returns {{agents: object[], errors: string[]}} agents/ 폴더를 읽고 검사만 한다 */
export const checkAgents = (root) => readAgentsDir(join(root, 'agents'), root);

/**
 * @param {object} o
 * @param {object} o.db     createClient() 결과
 * @param {string} o.root   저장소(또는 /app) 루트
 * @param {boolean} [o.prune] MD가 없는 에이전트를 보관 처리
 * @param {(msg: string) => void} [o.log]
 */
export async function syncAgents({ db, root, prune = false, log = () => {} }) {
  const { agents, errors } = checkAgents(root);
  if (errors.length) throw new Error(`agents/ 검사 실패 (${errors.length}건):\n- ` + errors.join('\n- '));
  log(`agents/ 정의 ${agents.length}개 확인`);

  // 1) 부서: 없는 부서는 만든다 (상위 부서 먼저)
  const byName = new Map((await db.select('harness_sections', 'select=id,name')).map((s) => [s.name, s]));
  async function ensureSection(name, parentName) {
    if (isLobby(name)) return null;
    if (byName.has(name)) return byName.get(name);
    const parent = parentName && !isLobby(parentName) ? await ensureSection(parentName, '') : null;
    const [row] = await db.insert('harness_sections', [{ name, parent_id: parent ? parent.id : null }]);
    byName.set(name, row);
    log(`  + 부서 생성: ${name}${parent ? ` (상위: ${parent.name})` : ''}`);
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
    const placed = fresh.filter((a) => deptOf.get(a.id));
    if (placed.length) {
      await db.insert('harness_agent_events', placed.map((a) => ({
        agent_id: a.id, kind: 'assign', to_section: deptOf.get(a.id).id, message: `대기실 → ${deptOf.get(a.id).name} 배치 (정의 동기화)`,
      })));
    }
  }
  log(`  에이전트: 새로 추가 ${fresh.length} · 정의 갱신 ${known.length}`);

  // 3) 모션 클립 경로 (렌더 결과 경로·해시는 렌더 단계에서 채운다)
  const motionRows = agents.flatMap((a) => a.motions.map((state) => ({ agent_id: a.id, state, composition_path: motionPath(root, a.id, state) })));
  if (motionRows.length) await db.upsert('harness_agent_motions', motionRows, 'agent_id,state');
  log(`  모션 클립 ${motionRows.length}개 경로 갱신`);

  // 4) prune: MD가 사라진 에이전트 보관
  let archived = [];
  if (prune) {
    const ids = new Set(agents.map((a) => a.id));
    archived = [...existing.values()].filter((r) => !ids.has(r.id) && !r.archived_at).map((r) => r.id);
    for (const id of archived) await db.update('harness_agents', db.eq('id', id), { archived_at: new Date().toISOString(), status: 'waiting' });
    log(`  보관 처리 ${archived.length}명${archived.length ? ': ' + archived.join(', ') : ''}`);
  }
  return { agents: agents.length, created: fresh.length, updated: known.length, archived };
}
