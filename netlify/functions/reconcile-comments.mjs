// Netlify 예약 함수: 10분마다 최근 댓글을 다시 훑어 웹훅이 놓친 댓글을 처리하고, 등록되지 않은 게시물의 미디어 ID를 기록한다.
import { createClient } from '../../scripts/lib/supabase.js';
import { runReconcile } from '../../src/bot-netlify.js';
import { repos } from '../generated/repos.mjs';

export default async () => {
  const result = await runReconcile({ env: process.env, db: createClient(), repos });
  console.log('재조회', JSON.stringify(result));
};

export const config = { schedule: '*/10 * * * *' };
