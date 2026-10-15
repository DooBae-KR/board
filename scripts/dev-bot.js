#!/usr/bin/env node
// 로컬 봇 시험 서버: Meta·Supabase·인터넷 없이 웹훅 처리와 놓친 댓글 재조회를 그대로 돌려 본다.
//   node scripts/dev-bot.js   →  봇 http://127.0.0.1:3200/webhook, 모의 인스타 API http://127.0.0.1:3201
// 운영과 같은 코드(src/bot-netlify.js)를 쓰고, 저장소는 메모리(igbot_* 흉내), 인스타 API는 모의 서버다. 재시작하면 초기화된다.
// 이벤트 보내기: node scripts/sim-webhook.js comment|click ...   상태 보기: GET /__state
import { createServer } from 'node:http';
import { handleWebhook, runReconcile } from '../src/bot-netlify.js';
import { SupabaseError } from './lib/supabase.js';

const BOT_PORT = Number(process.env.DEV_BOT_PORT || 3200), MOCK_PORT = Number(process.env.DEV_MOCK_PORT || 3201);
const ME = 'acc-ko';
// 모의 서버를 가리키게 한다(운영 값은 건드리지 않는다)
process.env.IG_GRAPH_BASE = `http://127.0.0.1:${MOCK_PORT}`;
const env = { APP_SECRET: 'dev-secret', VERIFY_TOKEN: 'dev-verify', IG_KO_USER_ID: ME, IG_KO_ACCESS_TOKEN: 'dev-token', ...process.env };

// 시험용 영상: 아래 mediaId의 댓글만 반응한다(실제 data/repos.json과 무관)
const repos = [
  { id: 'dev-ko', mediaId: 'media-1', keyword: '두배', name: 'MarkItDown', url: 'https://github.com/microsoft/markitdown' },
];

// ── igbot_* 흉내 내는 메모리 DB (scripts/lib/supabase.js의 insert/select/upsert/remove 모양)
const t = { igbot_tokens: [], igbot_seen: [], igbot_events: [] };
const pk = { igbot_tokens: 'lang', igbot_seen: 'key' };
let eventId = 0;
const db = {
  async select(table) { return structuredClone(t[table]); },
  async insert(table, rows) {
    for (const r of rows) if (pk[table] && t[table].some((x) => x[pk[table]] === r[pk[table]])) throw new SupabaseError('duplicate', 409, '23505');
    for (const r of rows) t[table].push({ ...structuredClone(r), ...(table === 'igbot_events' ? { id: ++eventId, at: new Date().toISOString() } : { created_at: new Date().toISOString() }) });
    return rows;
  },
  async upsert(table, rows) {
    for (const r of rows) { const i = t[table].findIndex((x) => x[pk[table]] === r[pk[table]]); if (i >= 0) t[table][i] = { ...t[table][i], ...r }; else t[table].push({ ...r }); }
    return rows;
  },
  async remove(table, filter) { const cut = decodeURIComponent(filter.split('lt.')[1]); t[table] = t[table].filter((x) => !(x.created_at < cut)); return []; },
};

// ── 모의 인스타 Graph API
const mock = { media: [{ id: 'media-1', permalink: 'https://www.instagram.com/p/DEVAAA/' }, { id: 'media-2', permalink: 'https://www.instagram.com/p/DEVBBB/' }], comments: {}, following: {}, sent: [] };
const json = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }).end(JSON.stringify(body)); };
const readBody = async (req) => { const c = []; for await (const x of req) c.push(x); return Buffer.concat(c).toString(); };

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname.replace(/^\/+/, '');
  if (req.headers.authorization !== 'Bearer dev-token' && !p.startsWith('__')) return json(res, 401, { error: 'bad token' });
  if (req.method === 'GET' && p === `${ME}/media`) return json(res, 200, { data: mock.media });
  if (req.method === 'GET' && /\/comments$/.test(p)) return json(res, 200, { data: [...(mock.comments[p.split('/')[0]] ?? [])].reverse() });
  if (req.method === 'GET' && url.searchParams.get('fields') === 'is_user_follow_business') return json(res, 200, { is_user_follow_business: mock.following[p] === true });
  if (req.method === 'POST' && p === `${ME}/messages`) { const b = JSON.parse(await readBody(req)); mock.sent.push({ at: new Date().toISOString(), recipient: b.recipient, text: b.message.text, buttons: (b.message.quick_replies ?? []).map((q) => q.payload) }); return json(res, 200, { ok: true }); }
  if (p === '__mock/comment' && req.method === 'POST') { const b = JSON.parse(await readBody(req)); (mock.comments[b.mediaId] ??= []).push({ id: b.id, text: b.text, from: { id: b.fromId }, timestamp: b.timestamp ?? new Date().toISOString() }); return json(res, 200, { ok: true }); }
  if (p === '__mock/follow' && req.method === 'POST') { const b = JSON.parse(await readBody(req)); mock.following[b.id] = b.following !== false; return json(res, 200, { ok: true }); }
  json(res, 404, { error: 'not found' });
}).listen(MOCK_PORT, '127.0.0.1');

// ── 봇 서버: 운영과 같은 handleWebhook / runReconcile
createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname === '/webhook') {
      const body = ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(await (async () => { const c = []; for await (const x of req) c.push(x); return c; })());
      const r = await handleWebhook(new Request(url, { method: req.method, headers: req.headers, body }), { env, db, repos });
      return res.writeHead(r.status, { 'Content-Type': 'text/plain; charset=utf-8' }).end(await r.text());
    }
    if (url.pathname === '/__reconcile' && req.method === 'POST') return json(res, 200, await runReconcile({ env, db, repos }));
    if (url.pathname === '/__state') return json(res, 200, { events: t.igbot_events.map(({ at, lang, event, repo_id, detail }) => ({ at, lang, event, repo_id, detail })), seen: t.igbot_seen.map((x) => x.key), dmsSent: mock.sent });
    if (url.pathname === '/__mock/comment' || url.pathname === '/__mock/follow') {
      const r = await fetch(`http://127.0.0.1:${MOCK_PORT}${url.pathname}`, { method: 'POST', body: Buffer.concat(await (async () => { const c = []; for await (const x of req) c.push(x); return c; })()) });
      return json(res, r.status, await r.json());
    }
    res.writeHead(404).end('not found');
  } catch (e) { console.error(e); res.writeHead(500).end(String(e.message)); }
}).listen(BOT_PORT, '127.0.0.1', () => {
  console.log(`로컬 봇 http://127.0.0.1:${BOT_PORT}/webhook  (모의 인스타 API :${MOCK_PORT}, APP_SECRET=${env.APP_SECRET}, VERIFY_TOKEN=${env.VERIFY_TOKEN})`);
  console.log(`시험 영상: media-1, 키워드 '두배'.  이벤트 보내기: node scripts/sim-webhook.js comment|click|follow|reconcile|state`);
});
