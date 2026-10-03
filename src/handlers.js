import { findById, matchRepo } from './repos.js';
import { messages } from './i18n.js';

const seen = new Set(); // 웹훅 중복 전송 방지 (단일 프로세스 기준)
const once = (key) => (seen.has(key) ? false : (seen.add(key), true));

// accounts: { [igUserId]: { lang, api } } — api는 { isFollowing, sendMessage }
export function createHandlers({ accounts, loadRepos }) {
  async function onComment(acc, selfId, { id, text, from, media }) {
    if (!once(`c:${id}`) || from?.id === selfId) return;
    const repo = matchRepo(loadRepos(), media?.id, text);
    if (!repo) return;
    const t = messages[acc.lang];

    let following = false;
    try {
      following = await acc.api.isFollowing(from.id);
    } catch {
      // 대화 이력이 없으면 조회가 막힐 수 있음 → 버튼 방식으로 진행
    }
    if (following) return acc.api.sendMessage({ comment_id: id }, t.link(repo));
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
      return acc.api.sendMessage({ id: senderId }, t.link(repo));
    }
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
