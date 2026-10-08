// 하네스 공통 로직: 에이전트 정의 검증, 진행 보고 → DB 변경 계산.
// DB 접근 없이 순수 함수로 두어 테스트할 수 있게 한다.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, join } from 'node:path';
import { parseFrontmatter } from './frontmatter.js';

export const MOTION_STATES = ['idle', 'working', 'walk', 'done', 'blocked'];
export const REPORT_KINDS = ['start', 'step', 'progress', 'blocked', 'done', 'fail', 'assign', 'info'];
const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const LOBBY = new Set(['', '대기실', 'lobby', '-']);

const list = (v) => (Array.isArray(v) ? v : v === '' || v == null ? [] : [v]).map(String);

/** agents/<id>.md 하나를 읽어 검증된 정의로 바꾼다. 문제가 있으면 errors에 담는다. */
export function readAgentFile(file, root) {
  const errors = [];
  const text = readFileSync(file, 'utf8');
  let data, body;
  try { ({ data, body } = parseFrontmatter(text)); } catch (e) { return { errors: [`${basename(file)}: ${e.message}`] }; }
  const fileId = basename(file, '.md');
  const need = ['id', 'name', 'role', 'pose', 'substrate_template', 'motions'];
  for (const k of need) if (data[k] === undefined || data[k] === '' || (Array.isArray(data[k]) && !data[k].length)) errors.push(`${k} 값이 필요합니다`);
  if (!('department' in data)) errors.push('department 키가 필요합니다 (대기실이면 비워 두세요)');
  const id = String(data.id ?? '');
  if (id && !ID_RE.test(id)) errors.push(`id "${id}"는 영문 소문자·숫자·하이픈만 쓸 수 있습니다`);
  if (id && id !== fileId) errors.push(`파일 이름(${fileId}.md)과 id(${id})가 다릅니다`);
  const motions = list(data.motions);
  const badMotion = motions.filter((m) => !MOTION_STATES.includes(m));
  if (badMotion.length) errors.push(`motions에 알 수 없는 상태: ${badMotion.join(', ')} (허용: ${MOTION_STATES.join(', ')})`);
  if (data.pose && root && !existsSync(join(root, 'src/assets/char', `${data.pose}.png`))) errors.push(`pose "${data.pose}"에 맞는 src/assets/char/${data.pose}.png가 없습니다`);
  const tpl = String(data.substrate_template || '');
  if (tpl && root && !existsSync(join(root, 'substrate', `actortemplate.${tpl}.yaml`))) errors.push(`substrate/actortemplate.${tpl}.yaml이 없습니다`);
  const prefixed = errors.map((e) => `${basename(file)}: ${e}`);
  if (prefixed.length) return { errors: prefixed };
  return {
    errors: [],
    agent: {
      id, name: String(data.name), role: String(data.role), pose: String(data.pose),
      color: data.color ? String(data.color) : null, model: data.model ? String(data.model) : null,
      substrate_template: tpl, motions, tools: list(data.tools), example: data.example === true,
      md_path: `agents/${fileId}.md`, md_sha256: createHash('sha256').update(text).digest('hex'),
      department: String(data.department ?? '').trim(), parent_department: String(data.parent_department ?? '').trim(),
      body: body.trim(),
    },
  };
}

/** agents/ 폴더 전체를 읽는다. `_`로 시작하는 파일과 README.md는 건너뛴다. */
export function readAgentsDir(dir, root) {
  const files = readdirSync(dir).filter((f) => f.endsWith('.md') && !f.startsWith('_') && f !== 'README.md').sort();
  const agents = []; const errors = [];
  for (const f of files) { const r = readAgentFile(join(dir, f), root); errors.push(...r.errors); if (r.agent) agents.push(r.agent); }
  const seen = new Set();
  for (const a of agents) { if (seen.has(a.id)) errors.push(`id 중복: ${a.id}`); seen.add(a.id); }
  return { agents, errors };
}

/** 모션 컴포지션 경로: 에이전트 전용 클립이 있으면 그것, 없으면 공용 템플릿 */
export function motionPath(root, id, state) {
  const own = `motion/${id}/${state}/index.html`;
  return existsSync(join(root, own)) ? own : `motion/templates/${state}/index.html`;
}

const SECRET_RE = [/\bsk-[A-Za-z0-9_-]{16,}/, /\bgh[pousr]_[A-Za-z0-9]{20,}/, /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./, /\bxox[abpr]-[A-Za-z0-9-]{10,}/, /\bAKIA[0-9A-Z]{16}\b/];
export const looksSecret = (s) => SECRET_RE.some((r) => r.test(String(s || '')));

const pct = (steps) => (steps.length ? Math.round((steps.filter((s) => s.done).length / steps.length) * 100) : null);

/**
 * 진행 보고 하나를 에이전트 행 변경(patch)과 기록(event)으로 바꾼다.
 * @param agent  현재 harness_agents 행
 * @param kind   start|step|progress|blocked|done|fail|assign|info
 * @param args   { message, steps, value, output, section }  section은 assign 때 { id, name } 또는 null(대기실)
 */
export function applyReport(agent, kind, args = {}) {
  if (!REPORT_KINDS.includes(kind)) throw new Error(`알 수 없는 보고 종류: ${kind} (허용: ${REPORT_KINDS.join(', ')})`);
  const message = String(args.message ?? '').trim();
  if (looksSecret(message) || looksSecret(args.output)) throw new Error('메시지에 토큰·키로 보이는 값이 있어 기록하지 않았습니다 (CLAUDE.md 6장)');
  const steps = (agent.steps || []).map((s) => ({ t: s.t, done: !!s.done }));
  const patch = { last_report_at: args.now || new Date().toISOString() };
  const event = { agent_id: agent.id, kind, message };

  switch (kind) {
    case 'start': {
      if (!message) throw new Error('start에는 업무 이름이 필요합니다');
      const st = (args.steps || []).map((t) => ({ t, done: false }));
      Object.assign(patch, { task: message, steps: st, progress: 0, status: 'working', note: '' });
      if (st.length) event.data = { steps: st.map((s) => s.t) };
      break;
    }
    case 'step': {
      const i = steps.findIndex((s) => !s.done);
      if (i < 0) throw new Error(steps.length ? '이미 모든 단계를 끝냈습니다. done으로 마무리하세요' : '단계가 없습니다. start --steps로 단계를 정하거나 progress를 쓰세요');
      steps[i].done = true;
      Object.assign(patch, { steps, progress: pct(steps), status: 'working' });
      event.data = { step: steps[i].t, index: i + 1, total: steps.length };
      if (!event.message) event.message = `${steps[i].t} 완료`;
      break;
    }
    case 'progress': {
      if (steps.length) throw new Error('단계가 있는 업무는 step으로 보고합니다 (진행률은 자동 계산, CLAUDE.md 2-6)');
      const v = Number(args.value);
      if (!Number.isFinite(v) || v < 0 || v > 100) throw new Error('progress 값은 0~100 사이 숫자여야 합니다');
      Object.assign(patch, { progress: Math.round(v), status: 'working' });
      event.data = { progress: Math.round(v) };
      break;
    }
    case 'blocked':
      if (!message) throw new Error('blocked에는 사람이 확인할 이유가 필요합니다');
      Object.assign(patch, { status: 'blocked', note: message });
      break;
    case 'done':
      Object.assign(patch, { status: 'done', progress: 100, steps: steps.map((s) => ({ ...s, done: true })), note: message });
      if (args.output) event.output = String(args.output);
      break;
    case 'fail':
      if (!message) throw new Error('fail에는 원인이 필요합니다');
      Object.assign(patch, { status: 'failed', note: message });
      break;
    case 'assign': {
      const to = args.section || null;
      patch.section_id = to ? to.id : null;
      event.from_section = agent.section_id || null;
      event.to_section = patch.section_id;
      const task = String(args.task ?? '').trim();
      if (task) Object.assign(patch, { task, steps: [], progress: 0, status: 'working', note: '' });
      if (!to) Object.assign(patch, { status: 'waiting' });
      event.message = message || `${args.fromName || '대기실'} → ${to ? to.name : '대기실'} ${to ? '배치' : '복귀'}`;
      if (task) event.data = { task };
      break;
    }
    case 'info':
      break;
  }
  return { patch, event };
}

export const isLobby = (name) => LOBBY.has(String(name ?? '').trim());
