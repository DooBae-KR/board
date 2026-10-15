import { createHmac, timingSafeEqual } from 'node:crypto';

const GRAPH_DEFAULT = 'https://graph.instagram.com/v23.0';
// 로컬 시험(scripts/dev-bot.js)에서는 IG_GRAPH_BASE로 모의 Graph 서버를 가리킨다. 운영에서는 설정하지 않는다
const graphBase = () => process.env.IG_GRAPH_BASE || GRAPH_DEFAULT;

export function verifySignature(rawBody, header, appSecret = process.env.APP_SECRET) {
  if (!appSecret) return true; // 로컬 테스트용
  if (!header?.startsWith('sha256=')) return false;
  const expected = createHmac('sha256', appSecret).update(rawBody).digest();
  const given = Buffer.from(header.slice(7), 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

// 계정(한국어/영어)별 API 클라이언트
export function createApi({ igUserId, token }) {
  const getToken = typeof token === 'function' ? token : () => token; // 갱신되는 토큰 지원
  async function graph(path, { method = 'GET', body } = {}) {
    const res = await fetch(`${graphBase()}/${path}`, {
      method,
      headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
      body: body && JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(`Graph API ${res.status}: ${JSON.stringify(json)}`);
    return json;
  }

  return {
    // 이 계정의 최근 게시물(미디어 ID·주소). 웹훅이 오지 않아도 미디어 ID를 알 수 있다
    async listMedia(limit = 25) {
      const r = await graph(`${igUserId}/media?fields=id,permalink,timestamp&limit=${limit}`);
      return r.data ?? [];
    },
    // 게시물의 최근 댓글(sinceMs 이후). 웹훅이 놓친 댓글을 다시 줍는 용도. 한 번에 최대 maxPages*50개
    async listComments(mediaId, sinceMs, maxPages = 2) {
      const out = [];
      let path = `${mediaId}/comments?fields=id,text,timestamp,from&limit=50`;
      for (let page = 0; page < maxPages && path; page++) {
        const r = await graph(path);
        for (const c of r.data ?? []) if (!c.timestamp || Date.parse(c.timestamp) >= sinceMs) out.push(c);
        const oldest = r.data?.at(-1)?.timestamp;
        path = r.paging?.next && !(oldest && Date.parse(oldest) < sinceMs) ? r.paging.next.replace(`${graphBase()}/`, '') : null;
      }
      return out;
    },
    // 사용자가 이 계정을 팔로우 중인지 확인
    async isFollowing(igsid) {
      const r = await graph(`${igsid}?fields=is_user_follow_business`);
      return r.is_user_follow_business === true;
    },
    // recipient: { comment_id } (댓글 비공개 답장) 또는 { id } (24시간 내 DM)
    sendMessage(recipient, text, quickReplies) {
      const message = { text };
      if (quickReplies) {
        message.quick_replies = quickReplies.map(([title, payload]) => ({
          content_type: 'text',
          title,
          payload,
        }));
      }
      return graph(`${igUserId}/messages`, { method: 'POST', body: { recipient, message } });
    },
  };
}
