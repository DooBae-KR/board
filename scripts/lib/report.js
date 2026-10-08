// 진행 보고 실행: 서버 API와 CLI(직접 모드)가 같은 로직을 쓴다 (CLAUDE.md 6장).
import { applyReport, HarnessError, ID_RE, REPORT_KINDS, isLobby } from './harness.js';

const MAX = { message: 500, step: 100, steps: 20, output: 300, task: 100, section: 80 };

const text = (v, field, max) => {
  if (v == null || v === '') return '';
  if (typeof v !== 'string' && typeof v !== 'number') throw new HarnessError(`${field}는 문자열이어야 합니다`);
  const s = String(v).trim();
  if (s.length > max) throw new HarnessError(`${field}는 ${max}자 이하여야 합니다`);
  return s;
};

/** 바깥에서 들어온 값을 검사하고 applyReport가 받는 형태로 정리한다 */
export function cleanReportInput(input = {}) {
  const id = text(input.agent, 'agent', 40);
  if (!ID_RE.test(id)) throw new HarnessError('agent는 영문 소문자·숫자·하이픈 id여야 합니다');
  const kind = text(input.kind, 'kind', 20);
  if (!REPORT_KINDS.includes(kind)) throw new HarnessError(`알 수 없는 보고 종류: ${kind || '(없음)'} (허용: ${REPORT_KINDS.join(', ')})`);

  let steps = input.steps;
  if (typeof steps === 'string') steps = steps.split('|');
  if (steps != null && !Array.isArray(steps)) throw new HarnessError('steps는 목록이거나 "a|b|c" 문자열이어야 합니다');
  steps = (steps || []).map((s) => text(s, 'steps 항목', MAX.step)).filter(Boolean);
  if (steps.length > MAX.steps) throw new HarnessError(`단계는 ${MAX.steps}개 이하여야 합니다`);

  return {
    id, kind, steps,
    message: text(input.message, 'message', MAX.message),
    output: text(input.output, 'output', MAX.output),
    task: text(input.task, 'task', MAX.task),
    section: input.section == null ? '' : text(input.section, 'section', MAX.section),
    value: input.value,
  };
}

/**
 * 에이전트 한 명의 보고를 반영한다.
 * 같은 에이전트에 보고가 동시에 들어오면 읽은 뒤 바뀐 행은 갱신하지 않고 다시 읽어 최대 3번 시도한다.
 */
export async function runReport(store, rawInput) {
  const c = cleanReportInput(rawInput);

  for (let attempt = 0; attempt < 3; attempt++) {
    const agent = await store.getAgent(c.id);
    if (!agent) throw new HarnessError(`에이전트 "${c.id}"가 없습니다. agents/${c.id}.md를 만들고 agents-sync를 먼저 실행하세요`, 404);
    if (agent.archived_at) throw new HarnessError(`에이전트 "${c.id}"는 보관 처리되어 있습니다`, 409);

    const args = { message: c.message, steps: c.steps, output: c.output, task: c.task, value: c.value };
    if (c.kind === 'assign') {
      if (!isLobby(c.section)) {
        const to = await store.findSection(c.section);
        if (!to) throw new HarnessError(`부서 "${c.section}"를 찾지 못했습니다. 대시보드에서 섹션을 먼저 추가하세요`, 404);
        args.section = { id: to.id, name: to.name };
      }
      if (agent.section_id) args.fromName = (await store.findSection(agent.section_id))?.name;
      args.message = '';
    }

    const { patch, event } = applyReport(agent, c.kind, args);
    const rows = await store.updateAgent(c.id, patch, agent.updated_at);
    if (rows.length) {
      await store.addEvent(event);
      if (c.kind === 'done' || c.kind === 'fail') await store.closeClaimed(c.id, c.kind === 'done' ? 'done' : 'failed'); // 지시받은 작업을 닫는다
      const next = rows[0];
      return { agent: c.id, kind: c.kind, status: next.status, progress: next.progress, section_id: next.section_id };
    }
  }
  throw new HarnessError('같은 에이전트에 보고가 동시에 들어와 반영하지 못했습니다. 잠시 뒤 다시 시도하세요', 409);
}
