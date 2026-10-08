// Supabase PostgREST 최소 클라이언트 (fetch만 사용, 외부 의존성 없음).
// 서버와 하네스 스크립트 전용: service_role 키로 RLS를 우회해 쓴다. 브라우저 코드에서 쓰지 말 것 (CLAUDE.md 2-4).

const TIMEOUT_MS = 10_000;

export class SupabaseError extends Error {
  constructor(message, status, code) {
    super(message);
    this.name = 'SupabaseError';
    this.status = status;
    this.code = code; // Postgres/PostgREST 오류 코드 (예: 23505 = 유니크 위반)
  }
}

export function createClient({ url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY } = {}) {
  if (!url || !key) throw new Error('.env에 SUPABASE_URL과 SUPABASE_SERVICE_ROLE_KEY를 설정하세요');
  const root = url.replace(/\/+$/, '');
  const base = root + '/rest/v1/';
  const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };

  async function call(target, method, { body, prefer } = {}) {
    let res;
    try {
      res = await fetch(target, {
        method,
        headers: prefer ? { ...headers, Prefer: prefer } : headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      throw new SupabaseError(`Supabase에 연결하지 못했습니다 (${e.name === 'TimeoutError' ? '시간 초과' : e.message})`, 0);
    }
    const text = await res.text();
    if (!res.ok) {
      let detail = text, code;
      try { const j = JSON.parse(text); detail = j.message || j.error || j.hint || text; code = j.code; } catch { /* 본문이 JSON이 아님 */ }
      throw new SupabaseError(`Supabase ${method} ${target.replace(root, '').split('?')[0]} 실패 (${res.status}): ${detail}`, res.status, code);
    }
    return text ? JSON.parse(text) : null;
  }
  const req = (method, path, opts) => call(base + path, method, opts);

  const enc = encodeURIComponent;
  return {
    select: (table, query = 'select=*') => req('GET', `${table}?${query}`),
    insert: (table, rows) => req('POST', table, { body: rows, prefer: 'return=representation' }),
    upsert: (table, rows, onConflict) =>
      req('POST', `${table}${onConflict ? `?on_conflict=${enc(onConflict)}` : ''}`, { body: rows, prefer: 'resolution=merge-duplicates,return=representation' }),
    update: (table, filter, patch) => req('PATCH', `${table}?${filter}`, { body: patch, prefer: 'return=representation' }),
    remove: (table, filter) => req('DELETE', `${table}?${filter}`, { prefer: 'return=representation' }),
    eq: (col, v) => `${col}=eq.${enc(v)}`,
    /** 비공개 버킷 파일을 잠시 볼 수 있는 서명 URL */
    async signStorageUrl(bucket, path, expiresIn = 3600) {
      const r = await call(`${root}/storage/v1/object/sign/${bucket}/${path.split('/').map(enc).join('/')}`, 'POST', { body: { expiresIn } });
      const signed = r && (r.signedURL || r.signedUrl);
      if (!signed) throw new SupabaseError('서명 URL을 받지 못했습니다', 502);
      return `${root}/storage/v1${signed.startsWith('/') ? '' : '/'}${signed}`;
    },
  };
}
