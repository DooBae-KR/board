// Netlify Functions(v2, Web Request/Response)에서 harness-api의 Node 스타일 핸들러를 부른다.
// harness-api는 req(method, headers, 본문 스트림)와 res(writeHead/setHeader/end)만 쓰므로 그만큼만 흉내 낸다.
const NO_BODY = new Set([101, 204, 205, 304]);

export async function handleRequest(api, request) {
  const url = new URL(request.url);
  const body = ['GET', 'HEAD'].includes(request.method) ? Buffer.alloc(0) : Buffer.from(await request.arrayBuffer());

  const req = {
    method: request.method,
    headers: Object.fromEntries(request.headers),
    async *[Symbol.asyncIterator]() { if (body.length) yield body; },
  };

  let status = 200;
  const headers = new Headers();
  let resolve;
  const done = new Promise((r) => { resolve = r; });
  const res = {
    setHeader(k, v) { headers.set(k, String(v)); },
    writeHead(code, h = {}) { status = code; for (const [k, v] of Object.entries(h)) headers.set(k, String(v)); return res; },
    end(payload) {
      resolve(new Response(NO_BODY.has(status) || payload == null || payload === '' ? null : payload, { status, headers }));
      return res;
    },
  };

  const handled = await api.handle(req, res, url);
  if (!handled) return new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  return done;
}
