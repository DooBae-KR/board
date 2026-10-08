#!/usr/bin/env node
// 대시보드 로그인 계정 만들기/비밀번호 바꾸기. 회원가입은 없고 계정은 이 스크립트로만 만든다.
//   node scripts/admin-user.js <아이디> [--sql]
// 비밀번호는 ADMIN_PASSWORD 환경변수 또는 프롬프트(입력이 보이지 않음)로 받는다. 인자나 로그에 남기지 않는다.
//   기본: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY가 있으면 harness_admins에 바로 upsert
//   --sql: DB에 닿지 않고 Supabase SQL Editor에 붙여 넣을 insert문만 출력
import { createInterface } from 'node:readline';
import { hashPassword, USERNAME_RE } from './lib/password.js';

const args = process.argv.slice(2);
const sqlOnly = args.includes('--sql');
const weakOk = args.includes('--allow-weak');
const username = args.find((a) => !a.startsWith('--'))?.toLowerCase();
if (!username || !USERNAME_RE.test(username)) {
  console.error('사용법: node scripts/admin-user.js <아이디(영문 소문자·숫자·._-, 3~32자)> [--sql] [--allow-weak]');
  process.exit(2);
}

function ask(prompt) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: true });
    const write = rl._writeToOutput;
    rl._writeToOutput = (s) => { if (s.includes(prompt)) write.call(rl, s); }; // 입력 글자는 가린다
    rl.question(prompt, (v) => { rl.close(); process.stderr.write('\n'); resolve(v); });
  });
}

const password = process.env.ADMIN_PASSWORD ?? (await ask('비밀번호: '));
if (password.length < 8 && !weakOk) {
  console.error('비밀번호가 너무 짧아요(8자 이상). 정말 쓰려면 --allow-weak를 붙이세요. 공개 사이트에서는 권하지 않아요.');
  process.exit(2);
}
const hash = await hashPassword(password);

if (sqlOnly) {
  console.log(`insert into public.harness_admins (username, password_hash)\nvalues ('${username}', '${hash}')\non conflict (username) do update set password_hash = excluded.password_hash, updated_at = now();`);
} else {
  const { createClient } = await import('./lib/supabase.js');
  const { createStore } = await import('./lib/store.js');
  await createStore(createClient()).upsertAdmin(username, hash);
  console.log(`계정 '${username}' 저장 완료`);
}
