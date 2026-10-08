#!/usr/bin/env node
// 에이전트 모션 클립을 HyperFrames로 렌더한다 (CLAUDE.md 5장).
// 사용: node --env-file=.env scripts/render-motions.js [agent-id ...] [--state working] [--upload] [--dry-run]
//  - 에이전트마다 motions 목록의 상태별로 컴포지션을 motion/.build/<id>-<state>/에 준비하고
//    그 폴더에서 `npx hyperframes render`를 실행한다 (Node 22+, FFmpeg 필요).
//  - --upload: 결과 MP4를 Supabase Storage agent-motions/<id>/<state>.mp4에 올리고 harness_agent_motions를 갱신
//  - --dry-run: 컴포지션만 준비하고 렌더하지 않는다 (`npx hyperframes preview`로 확인할 때)
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readAgentsDir, motionPath } from './lib/harness.js';
import { createClient } from './lib/supabase.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (n) => { const i = argv.indexOf(n); if (i < 0) return null; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const onlyState = opt('--state');
const upload = argv.includes('--upload');
const dryRun = argv.includes('--dry-run');
const ids = argv.filter((a) => !a.startsWith('--'));

// 상태별 스프라이트: 감정이 드러나는 상태는 공용 표정, 나머지는 에이전트 자신의 포즈
const STATE_SPRITE = { done: 'happy', blocked: 'flustered' };

const { agents, errors } = readAgentsDir(join(root, 'agents'), root);
if (errors.length) { console.error('agents/ 검사 실패:\n- ' + errors.join('\n- ')); process.exit(1); }
const targets = ids.length ? agents.filter((a) => ids.includes(a.id)) : agents;
const missing = ids.filter((id) => !agents.some((a) => a.id === id));
if (missing.length) { console.error(`없는 에이전트: ${missing.join(', ')}`); process.exit(1); }
if (!dryRun && process.platform !== 'linux') console.warn('경고: 결정적 렌더는 Linux에서만 보장됩니다. 최종본은 Linux(CI)에서 만드세요.');

const newestMp4 = (dir, since) => {
  let best = null;
  const walk = (d) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f); const s = statSync(p);
      if (s.isDirectory()) { if (f !== 'node_modules') walk(p); }
      else if (f.endsWith('.mp4') && s.mtimeMs >= since && (!best || s.mtimeMs > best.t)) best = { p, t: s.mtimeMs };
    }
  };
  walk(dir);
  return best?.p ?? null;
};

async function uploadClip(db, id, state, file) {
  const url = process.env.SUPABASE_URL.replace(/\/+$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const path = `${id}/${state}.mp4`;
  const buf = readFileSync(file);
  const res = await fetch(`${url}/storage/v1/object/agent-motions/${path}`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'video/mp4', 'x-upsert': 'true' },
    body: buf,
  });
  if (!res.ok) throw new Error(`Storage 업로드 실패 (${res.status}): ${await res.text()}`);
  const sha256 = createHash('sha256').update(buf).digest('hex');
  await db.upsert('harness_agent_motions', [{ agent_id: id, state, composition_path: motionPath(root, id, state), storage_path: `agent-motions/${path}`, sha256, rendered_at: new Date().toISOString() }], 'agent_id,state');
  return `agent-motions/${path}`;
}

const db = upload ? createClient() : null;
let ok = 0; const failed = [];
for (const a of targets) {
  for (const state of a.motions.filter((s) => !onlyState || s === onlyState)) {
    const compId = `${a.id}-${state}`;
    const src = join(root, motionPath(root, a.id, state));
    const build = join(root, 'motion/.build', compId);
    rmSync(build, { recursive: true, force: true });
    cpSync(dirname(src), build, { recursive: true });
    writeFileSync(join(build, 'index.html'), readFileSync(src, 'utf8').replaceAll('__COMP_ID__', compId));
    const sprite = join(root, 'src/assets/char', `${STATE_SPRITE[state] || a.pose}.png`);
    mkdirSync(join(build, 'assets'), { recursive: true });
    if (!existsSync(join(build, 'assets/char.png'))) cpSync(sprite, join(build, 'assets/char.png'));
    if (dryRun) { console.log(`준비: motion/.build/${compId}/`); ok++; continue; }

    const lint = spawnSync('npx', ['hyperframes', 'lint'], { cwd: build, encoding: 'utf8' });
    const lintOut = `${lint.stdout || ''}${lint.stderr || ''}`;
    if (lint.status !== 0 || /[1-9]\d* errors?|[1-9]\d* warnings?/.test(lintOut)) {
      failed.push(compId); console.error(`lint 통과 실패: ${compId}\n${lintOut}`); continue;
    }
    const started = Date.now();
    const r = spawnSync('npx', ['hyperframes', 'render'], { cwd: build, stdio: 'inherit' });
    const out = r.status === 0 ? newestMp4(build, started - 1000) : null;
    if (!out) { failed.push(compId); console.error(`렌더 실패: ${compId}`); continue; }
    console.log(`렌더 완료: ${compId} → ${out.replace(root + '/', '')}`);
    if (upload) {
      try { console.log(`  업로드: ${await uploadClip(db, a.id, state, out)}`); }
      catch (e) { failed.push(compId); console.error(`  ${e.message}`); continue; }
    }
    ok++;
  }
}
console.log(`${dryRun ? '준비' : '렌더'} ${ok}개${failed.length ? ` · 실패 ${failed.length}개: ${failed.join(', ')}` : ''}`);
process.exit(failed.length ? 1 : 0);
