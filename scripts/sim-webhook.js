#!/usr/bin/env node
// 로컬 봇(scripts/dev-bot.js)에 서명된 인스타 이벤트를 보내 시험한다.
//   node scripts/sim-webhook.js comment [두배] [fromId] [mediaId]   댓글 웹훅 (기본: 두배, user-1, media-1)
//   node scripts/sim-webhook.js click   [fromId]                    "팔로우했어요" 버튼 클릭 웹훅
//   node scripts/sim-webhook.js follow  <fromId> [on|off]           모의 인스타의 팔로우 상태 바꾸기
//   node scripts/sim-webhook.js late    [두배] [fromId]              웹훅 없이 모의 인스타에만 댓글 추가(재조회 시험)
//   node scripts/sim-webhook.js reconcile                           놓친 댓글 재조회 실행
//   node scripts/sim-webhook.js state                               이벤트·중복 키·보낸 DM 보기
import { createHmac } from 'node:crypto';

const BASE = process.env.DEV_BOT_URL || 'http://127.0.0.1:3200';
const SECRET = process.env.APP_SECRET || 'dev-secret', ME = 'acc-ko';
const [cmd = 'state', ...a] = process.argv.slice(2);
let n = Date.now();
const signed = async (body) => {
  const raw = JSON.stringify(body);
  const r = await fetch(`${BASE}/webhook`, { method: 'POST', headers: { 'x-hub-signature-256': 'sha256=' + createHmac('sha256', SECRET).update(raw).digest('hex') }, body: raw });
  console.log(`웹훅 응답 ${r.status} ${await r.text()}`);
};
const post = async (path, body) => console.log(path, (await fetch(`${BASE}${path}`, { method: 'POST', body: JSON.stringify(body ?? {}) })).status);

if (cmd === 'comment') {
  const [text = '두배', from = 'user-1', media = 'media-1'] = a;
  await signed({ entry: [{ id: ME, changes: [{ field: 'comments', value: { id: `c-${n}`, text, from: { id: from }, media: { id: media } } }] }] });
} else if (cmd === 'click') {
  const [from = 'user-1'] = a;
  await signed({ entry: [{ id: ME, messaging: [{ sender: { id: from }, postback: { payload: 'CHECK:dev-ko' } }] }] });
} else if (cmd === 'follow') {
  await post('/__mock/follow', { id: a[0], following: a[1] !== 'off' });
} else if (cmd === 'late') {
  const [text = '두배', from = 'user-9'] = a;
  await post('/__mock/comment', { mediaId: 'media-1', id: `late-${n}`, text, fromId: from });
} else if (cmd === 'reconcile') {
  console.log(JSON.stringify(await (await fetch(`${BASE}/__reconcile`, { method: 'POST' })).json()));
} else if (cmd === 'state') {
  console.log(JSON.stringify(await (await fetch(`${BASE}/__state`)).json(), null, 2));
} else { console.error('알 수 없는 명령: ' + cmd); process.exit(1); }
