import { findById, matchRepo } from './repos.js';
import { messages } from './i18n.js';
import { record } from './stats.js';

const seen = new Set(); // 웹훅 중복 전송 방지 (기본: 단일 프로세스 메모리)
const memoryOnce = (key) => (seen.has(key) ? false : (seen.add(key), true));

// accounts: { [igUserId]: { lang, api } } — api는 { isFollowing, sendMessage }
// once(key): 처음 보는 키면 true. 서버리스에서는 DB 기반(비동기)으로 바꿔 끼운다
export function createHandlers({ accounts, loadRepos, once = memoryOnce }) {
  async function onComment(acc, selfId, { id, text, from, media }) {
    if (from?.id === selfId || !(await once(`c:${id}`))) return;
    const repo = matchRepo(loadRepos(), media?.id, text);
    if (!repo) return;
    const t = messages[acc.lang];
    record(acc.lang, 'matched', { repoId: repo.id });

    let following = false;
    try {
      following = await acc.api.isFollowing(from.id);
    } catch {
      // 대화 이력이 없으면 조회가 막힐 수 있음 → 버튼 방식으로 진행
    }
    if (following) {
      record(acc.lang, 'link_direct', { repoId: repo.id });
      return acc.api.sendMessage({ comment_id: id }, t.link(repo));
    }
    record(acc.lang, 'asked', { repoId: repo.id });
    return acc.api.sendMessage({ comment_id: id }, t.ask(repo), [[t.button, `CHECK:${repo.id}`]]);
  }

  async function onMessaging(acc, selfId, evt) {
    const payload = evt.postback?.payload ?? evt.message?.quick_reply?.payload;
    const senderId = evt.sender?.id;
    if (!payload?.startsWith('CHECK:') || senderId === selfId) return;
    const repo = findById(loadRepos(), payload.slice(6));
    if (!repo) return;
    const t = messages[acc.lang];

    if (await acc.api.isFollowing(senderId)) {
      record(acc.lang, 'click_ok', { repoId: repo.id });
      return acc.api.sendMessage({ id: senderId }, t.link(repo));
    }
    record(acc.lang, 'click_retry', { repoId: repo.id });
    return acc.api.sendMessage({ id: senderId }, t.retry, [[t.button, `CHECK:${repo.id}`]]);
  }

  return async function handleWebhook(body) {
    for (const entry of body.entry ?? []) {
      const acc = accounts[entry.id]; // entry.id = 이벤트가 발생한 내 IG 계정
      if (!acc) continue;
      for (const ch of entry.changes ?? []) {
        if (ch.field === 'comments') await onComment(acc, entry.id, ch.value);
      }
      for (const evt of entry.messaging ?? []) await onMessaging(acc, entry.id, evt);
    }
  };
}
