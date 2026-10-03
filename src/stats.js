// 대시보드용 집계 (메모리 기반: 서버 재시작 시 초기화)
const EVENTS = ['matched', 'link_direct', 'asked', 'click_ok', 'click_retry', 'error'];
const counters = {}; // { [lang]: { [event]: n } }
const recent = []; // 최근 이벤트 50개

export function record(lang, event, { repoId, detail } = {}) {
  const c = (counters[lang] ??= Object.fromEntries(EVENTS.map((e) => [e, 0])));
  c[event]++;
  recent.unshift({ at: new Date().toISOString(), lang, event, repoId, detail });
  if (recent.length > 50) recent.pop();
}

export const snapshot = () => ({ counters, recent, startedAt });
const startedAt = new Date().toISOString();
