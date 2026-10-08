import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFrontmatter } from './frontmatter.js';
import { readAgentsDir, readAgentFile, applyReport, looksSecret, motionPath } from './harness.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

test('frontmatter: 스칼라·인라인 리스트·블록 리스트·주석', () => {
  const { data, body } = parseFrontmatter('---\nid: a-1  # 주석\nname: "루미 #1"\nmotions: [idle, working]\ntools:\n  - Read\n  - Bash\nexample: true\nempty:\nn: 3\n---\n본문');
  assert.deepEqual(data, { id: 'a-1', name: '루미 #1', motions: ['idle', 'working'], tools: ['Read', 'Bash'], example: true, empty: '', n: 3 });
  assert.equal(body, '본문');
});

test('저장소의 agents/ 정의가 모두 규칙을 통과한다', () => {
  const { agents, errors } = readAgentsDir(join(root, 'agents'), root);
  assert.deepEqual(errors, []);
  assert.ok(agents.length >= 1);
  for (const a of agents) assert.match(a.md_sha256, /^[0-9a-f]{64}$/);
});

test('템플릿도 형식상 읽힌다 (id만 파일명과 다름)', () => {
  const r = readAgentFile(join(root, 'agents/_template.md'), root);
  assert.ok(r.errors.some((e) => e.includes('파일 이름')));
});

test('잘못된 정의는 이유와 함께 거절한다', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agents-'));
  writeFileSync(join(dir, 'bad.md'), '---\nid: Bad\nname: x\nrole: y\ndepartment:\npose: nope\nsubstrate_template: missing\nmotions: [idle, dance]\n---\n');
  const { errors } = readAgentsDir(dir, root);
  const all = errors.join('\n');
  for (const s of ['영문 소문자', '파일 이름', 'dance', 'nope.png', 'actortemplate.missing.yaml']) assert.ok(all.includes(s), s);
});

test('모션 경로: 전용 클립이 없으면 공용 템플릿', () => {
  assert.equal(motionPath(root, 'no-such-agent', 'working'), 'motion/templates/working/index.html');
});

test('진행 보고: start → step → done', () => {
  let a = { id: 'lumi', steps: [], progress: 0, status: 'waiting', section_id: 's1' };
  let r = applyReport(a, 'start', { message: '지출 분석', steps: ['수집', '분석', '보고'] });
  assert.equal(r.patch.status, 'working'); assert.equal(r.patch.progress, 0);
  a = { ...a, ...r.patch };
  r = applyReport(a, 'step', {});
  assert.equal(r.patch.progress, 33); assert.equal(r.event.data.step, '수집'); assert.equal(r.event.message, '수집 완료');
  a = { ...a, ...r.patch };
  assert.throws(() => applyReport(a, 'progress', { value: 50 }), /step으로/);
  r = applyReport(a, 'done', { message: '보고서 완료', output: 'docs/x.md' });
  assert.equal(r.patch.progress, 100); assert.ok(r.patch.steps.every((s) => s.done)); assert.equal(r.event.output, 'docs/x.md');
});

test('진행 보고: 단계 없는 업무는 progress, 범위 검사', () => {
  const a = { id: 'x', steps: [], progress: 0, status: 'working' };
  assert.equal(applyReport(a, 'progress', { value: '60' }).patch.progress, 60);
  assert.throws(() => applyReport(a, 'progress', { value: 120 }), /0~100/);
  assert.throws(() => applyReport(a, 'step', {}), /단계가 없습니다/);
});

test('부서 이동: 새 업무를 주면 초기화, 대기실이면 waiting', () => {
  const a = { id: 'toto', steps: [{ t: 'a', done: true }], progress: 100, status: 'done', section_id: 's1' };
  let r = applyReport(a, 'assign', { section: { id: 's2', name: '개발팀' }, task: '배포 노트', fromName: '재무팀' });
  assert.deepEqual([r.patch.section_id, r.patch.status, r.patch.progress, r.event.from_section, r.event.to_section], ['s2', 'working', 0, 's1', 's2']);
  assert.equal(r.event.message, '재무팀 → 개발팀 배치');
  r = applyReport(a, 'assign', { section: null, fromName: '재무팀' });
  assert.equal(r.patch.section_id, null); assert.equal(r.patch.status, 'waiting'); assert.equal(r.event.message, '재무팀 → 대기실 복귀');
});

test('비밀값으로 보이는 메시지는 기록하지 않는다', () => {
  assert.ok(looksSecret('token ghp_abcdefghijklmnopqrstuvwxyz0123'));
  assert.ok(!looksSecret('PR #412 리뷰 완료'));
  assert.throws(() => applyReport({ id: 'x', steps: [] }, 'info', { message: 'key sk-abcdefghijklmnopqrstuv' }), /토큰/);
});

test('blocked·fail은 이유가 필요하다', () => {
  assert.throws(() => applyReport({ id: 'x', steps: [] }, 'blocked', {}), /이유/);
  assert.equal(applyReport({ id: 'x', steps: [] }, 'fail', { message: 'API 오류' }).patch.status, 'failed');
});
