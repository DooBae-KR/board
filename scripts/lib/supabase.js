// Supabase PostgREST 최소 클라이언트 (fetch만 사용, 외부 의존성 없음).
// 하네스 스크립트 전용: service_role 키로 RLS를 우회해 쓴다. 브라우저 코드에서 쓰지 말 것 (CLAUDE.md 2-4).

export function createClient({ url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY } = {}) {
  if (!url || !key) throw new Error('.env에 SUPABASE_URL과 SUPABASE_SERVICE_ROLE_KEY를 설정하세요');
  const base = url.replace(/\/+$/, '') + '/rest/v1/';
  const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };

  async function req(method, path, { body, prefer } = {}) {
    const res = await fetch(base + path, {
      method,
      headers: prefer ? { ...headers, Prefer: prefer } : headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) {
      let detail = text;
      try { const j = JSON.parse(text); detail = j.message || j.hint || text; } catch { /* 본문이 JSON이 아님 */ }
      throw new Error(`Supabase ${method} ${path.split('?')[0]} 실패 (${res.status}): ${detail}`);
    }
    return text ? JSON.parse(text) : null;
  }

  const enc = encodeURIComponent;
  return {
    select: (table, query = 'select=*') => req('GET', `${table}?${query}`),
    insert: (table, rows) => req('POST', table, { body: rows, prefer: 'return=representation' }),
    upsert: (table, rows, onConflict) =>
      req('POST', `${table}${onConflict ? `?on_conflict=${enc(onConflict)}` : ''}`, { body: rows, prefer: 'resolution=merge-duplicates,return=representation' }),
    update: (table, filter, patch) => req('PATCH', `${table}?${filter}`, { body: patch, prefer: 'return=representation' }),
    eq: (col, v) => `${col}=eq.${enc(v)}`,
  };
}
