import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHandlers } from './handlers.js';

const repos = [{ id: 'r1', mediaId: 'm1', keyword: '링크', name: 'Repo', url: 'https://github.com/a/b' }];

function setup(following, lang = 'ko') {
  const sent = [];
  const api = {
    isFollowing: async () => following,
    sendMessage: async (to, text, qr) => sent.push({ to, text, qr }),
  };
  const accounts = { acc: { lang, api } };
  return { sent, handle: createHandlers({ accounts, loadRepos: () => repos }) };
}
const comment = (id, text, mediaId = 'm1') => ({
  entry: [{ id: 'acc', changes: [{ field: 'comments', value: { id, text, from: { id: 'u1' }, media: { id: mediaId } } }] }],
});

test('팔로워 댓글 → 링크 즉시 전송', async () => {
  const { sent, handle } = setup(true);
  await handle(comment('c1', '링크 주세요'));
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /github\.com\/a\/b/);
});

test('비팔로워 댓글 → 버튼 안내만', async () => {
  const { sent, handle } = setup(false);
  await handle(comment('c2', '링크'));
  assert.doesNotMatch(sent[0].text, /github\.com/);
  assert.equal(sent[0].qr[0][1], 'CHECK:r1');
});

test('키워드/게시물 불일치, 중복 웹훅은 무시', async () => {
  const { sent, handle } = setup(true);
  await handle(comment('c3', '안녕'));
  await handle(comment('c4', '링크', 'other'));
  await handle(comment('c5', '링크'));
  await handle(comment('c5', '링크'));
  assert.equal(sent.length, 1);
});

test('버튼 클릭: 팔로우 확인 시 링크, 아니면 재안내', async () => {
  const evt = { entry: [{ id: 'acc', messaging: [{ sender: { id: 'u1' }, message: { quick_reply: { payload: 'CHECK:r1' } } }] }] };
  const a = setup(true);
  await a.handle(evt);
  assert.match(a.sent[0].text, /github\.com/);
  const b = setup(false);
  await b.handle(evt);
  assert.doesNotMatch(b.sent[0].text, /github\.com/);
});

test('영어 계정은 영어 메시지, 알 수 없는 계정은 무시', async () => {
  const en = setup(true, 'en');
  await en.handle(comment('c9', '링크'));
  assert.match(en.sent[0].text, /Thanks for following/);
  const none = setup(true);
  await none.handle({ entry: [{ id: 'unknown', changes: [{ field: 'comments', value: { id: 'c10', text: '링크', from: { id: 'u1' }, media: { id: 'm1' } } }] }] });
  assert.equal(none.sent.length, 0);
});
