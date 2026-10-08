#!/usr/bin/env node
// agents/*.md 정의를 Supabase harness_agents에 반영한다 (CLAUDE.md 1·3장).
// 사용: node --env-file=.env scripts/agents-sync.js [--dry-run] [--prune]
//  --dry-run  검사와 변경 계획만 출력 (DB 접속 안 함)
//  --prune    MD가 없는 에이전트를 보관 처리(archived_at). 기록은 지우지 않는다.
// 서버(src/server.js)도 시작할 때 같은 동기화를 실행한다. 이 스크립트는 수동 실행·검사용이다.
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { checkAgents, syncAgents } from './lib/agents-sync.js';
import { createClient } from './lib/supabase.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));

try {
  if (args.has('--dry-run')) {
    const { agents, errors } = checkAgents(root);
    if (errors.length) throw new Error(`agents/ 검사 실패 (${errors.length}건):\n- ` + errors.join('\n- '));
    console.log(`agents/ 정의 ${agents.length}개 확인`);
    for (const a of agents) console.log(`  ${a.id.padEnd(12)} ${a.name} · ${a.role} · 기본 부서: ${a.department || '대기실'} · 모션 ${a.motions.length}개`);
    console.log('--dry-run: DB는 바꾸지 않았습니다');
  } else {
    await syncAgents({ db: createClient(), root, prune: args.has('--prune'), log: console.log });
    console.log('동기화 완료');
  }
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
