#!/usr/bin/env node
// 사용: node scripts/check-story.js video/story/stories/<id>.json [...]
// 영상 스토리 JSON이 docs/video-spec.md 규격을 지키는지 점검한다. 오류가 있으면 종료 코드 1.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const BUDGET = [24, 34, 50, 32, 40]; // 장면별 나레이션 음절 예산(docs/video-spec.md)
const syl = (s) => (s.match(/[가-힣0-9a-zA-Z]/g) || []).length;
const files = process.argv.slice(2);
if (!files.length) {
  const dir = 'video/story/stories';
  for (const f of readdirSync(dir)) if (f.endsWith('.json') && !f.startsWith('_')) files.push(join(dir, f));
}
let bad = 0;
for (const file of files) {
  const errs = [], warns = [];
  let s;
  try { s = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { console.error(`${file}: JSON 오류 ${e.message}`); bad++; continue; }
  const str = (v, p) => { if (typeof v !== 'string' || !v.trim()) errs.push(`${p}: 비어 있음`); else if (/[<>]/.test(v.replace(/<\/?em>/g, ''))) errs.push(`${p}: 채우지 않은 자리표시자(<...>)`); };
  for (const k of ['id', 'lang', 'keyword']) str(s[k], k);
  str(s.problem?.k, 'problem.k'); str(s.problem?.h, 'problem.h');
  str(s.why?.k, 'why.k');
  if (s.why?.diagram) {
    // 개념 애니메이션: 문제 줄(bad) → 해결 줄(good), 줄마다 칸 3개
    const rows = s.why.diagram.rows;
    if (!Array.isArray(rows) || rows.length !== 2) errs.push('why.diagram.rows: 2줄(문제, 해결)이어야 함');
    else rows.forEach((r, i) => {
      str(r?.label, `why.diagram.rows[${i}].label`); str(r?.result, `why.diagram.rows[${i}].result`);
      if (r?.tone !== (i ? 'good' : 'bad')) errs.push(`why.diagram.rows[${i}].tone: ${i ? 'good' : 'bad'}여야 함`);
      if (r?.nodes?.length !== 3) errs.push(`why.diagram.rows[${i}].nodes: 3칸이어야 함`);
      else r.nodes.forEach((x, j) => { str(x, `why.diagram.rows[${i}].nodes[${j}]`); if (String(x).length > 8) errs.push(`why.diagram.rows[${i}].nodes[${j}]: 8자 이하(화면 폭)`); });
    });
  } else if (s.why?.points?.length !== 3) errs.push('why.points: 3개여야 함(또는 why.diagram)');
  else s.why.points.forEach((x, i) => str(x, `why.points[${i}]`));
  for (const k of ['k', 'name', 'sub']) str(s.repo?.[k], `repo.${k}`);
  if (s.repo?.features?.length !== 3) errs.push('repo.features: 3개여야 함'); else s.repo.features.forEach((x, i) => str(x, `repo.features[${i}]`));
  if (!s.repo?.chips?.length) errs.push('repo.chips: 비어 있음'); else s.repo.chips.forEach((x, i) => str(x, `repo.chips[${i}]`));
  for (const k of ['k', 'asof', 'label', 'verdict', 'caveat']) str(s.stars?.[k], `stars.${k}`);
  if (!(s.stars?.value > 0)) errs.push('stars.value: 직접 확인한 스타 수(양수)가 필요함');
  if (s.stars?.caveat && !/품질/.test(s.stars.caveat)) warns.push('stars.caveat: "별이 많다고 품질이 보장되는 건 아니에요" 한계 문구가 없음');
  str(s.cta?.k, 'cta.k'); str(s.cta?.note, 'cta.note');
  if (s.cta?.steps?.length !== 3) errs.push('cta.steps: 3개여야 함'); else s.cta.steps.forEach((x, i) => str(x, `cta.steps[${i}]`));
  const n = s.narration;
  if (!Array.isArray(n) || n.length !== 5) errs.push('narration: 문장 5개여야 함');
  else {
    n.forEach((x, i) => { str(x, `narration[${i}]`); const c = syl(x); if (c > BUDGET[i]) errs.push(`narration[${i}]: ${c}음절 > 예산 ${BUDGET[i]}`); });
    if (s.keyword && !n[4].includes(s.keyword)) errs.push(`narration[4]: 키워드 '${s.keyword}'가 없음`);
    if (!/팔로우/.test(n[4])) errs.push('narration[4]: "먼저 팔로우" 안내가 없음');
    if (/무조건|100%|혁명|써 ?봤|후기/.test(n.join(' '))) errs.push('narration: 과장·경험 지어내기 표현');
  }
  if (/(sk-|eyJ|token|secret)/i.test(JSON.stringify(s))) errs.push('비밀값처럼 보이는 문자열');
  console.log(`${errs.length ? '✗' : '✓'} ${file}`);
  errs.forEach((e) => console.log('  오류: ' + e)); warns.forEach((w) => console.log('  주의: ' + w));
  if (errs.length) bad++;
}
process.exit(bad ? 1 : 0);
