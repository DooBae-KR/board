import { createHmac, timingSafeEqual } from 'node:crypto';

const GRAPH = 'https://graph.instagram.com/v23.0';

export function verifySignature(rawBody, header, appSecret = process.env.APP_SECRET) {
  if (!appSecret) return true; // 로컬 테스트용
  if (!header?.startsWith('sha256=')) return false;
  const expected = createHmac('sha256', appSecret).update(rawBody).digest();
  const given = Buffer.from(header.slice(7), 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

// 계정(한국어/영어)별 API 클라이언트
export function createApi({ igUserId, token }) {
  async function graph(path, { method = 'GET', body } = {}) {
    const res = await fetch(`${GRAPH}/${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body && JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(`Graph API ${res.status}: ${JSON.stringify(json)}`);
    return json;
  }

  return {
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
