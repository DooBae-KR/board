import { createServer } from 'node:http';
import { createApi, verifySignature } from './instagram.js';
import { loadRepos } from './repos.js';
import { createHandlers } from './handlers.js';

const { PORT = 3000, VERIFY_TOKEN } = process.env;

// 한국어/영어 계정 분리 운영: 환경변수에 설정된 계정만 활성화
const accounts = {};
for (const [lang, key] of [['ko', 'KO'], ['en', 'EN']]) {
  const igUserId = process.env[`IG_${key}_USER_ID`];
  const token = process.env[`IG_${key}_ACCESS_TOKEN`];
  if (igUserId && token) accounts[igUserId] = { lang, api: createApi({ igUserId, token }) };
}
if (!Object.keys(accounts).length) console.warn('설정된 인스타그램 계정이 없습니다 (.env 확인)');

const handleWebhook = createHandlers({ accounts, loadRepos });

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname !== '/webhook') return res.writeHead(404).end();

  // Meta 웹훅 등록 시 확인 요청
  if (req.method === 'GET') {
    const ok =
      url.searchParams.get('hub.mode') === 'subscribe' &&
      url.searchParams.get('hub.verify_token') === VERIFY_TOKEN;
    return ok
      ? res.writeHead(200).end(url.searchParams.get('hub.challenge'))
      : res.writeHead(403).end();
  }
  if (req.method !== 'POST') return res.writeHead(405).end();

  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks);
  if (!verifySignature(raw, req.headers['x-hub-signature-256'])) return res.writeHead(401).end();

  res.writeHead(200).end('ok'); // 먼저 응답하고 처리 (Meta 재시도 방지)
  try {
    await handleWebhook(JSON.parse(raw));
  } catch (e) {
    console.error(e);
  }
}).listen(PORT, () => console.log(`webhook listening on :${PORT}`));
