// 대시보드용 집계 (메모리 기반: 서버 재시작 시 초기화)
const EVENTS = ['matched', 'link_direct', 'asked', 'click_ok', 'click_retry', 'error'];
let sink = null;
let pending = [];
const counters = {}; // { [lang]: { [event]: n } }
const recent = []; // 최근 이벤트 50개

export function record(lang, event, { repoId, detail } = {}) {
  const c = (counters[lang] ??= Object.fromEntries(EVENTS.map((e) => [e, 0])));
  c[event]++;
  recent.unshift({ at: new Date().toISOString(), lang, event, repoId, detail });
  if (sink) pending.push({ lang, event, repo_id: repoId ?? null, detail: detail ? String(detail).slice(0, 300) : null });
  if (recent.length > 50) recent.pop();
}

export const snapshot = () => ({ counters, recent, startedAt });
const startedAt = new Date().toISOString();

// 서버리스처럼 메모리가 유지되지 않는 환경용: 기록을 DB 같은 곳으로 내보내는 훅
export function setSink(fn) { sink = fn; pending = []; }
export async function flushSink() {
  const rows = pending; pending = [];
  if (sink && rows.length) await sink(rows);
}
