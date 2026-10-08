// Netlify 예약 함수: 12시간마다 인스타 토큰 갱신(만료 20일 이내) + 중복 방지 키 정리.
import { createClient } from '../../scripts/lib/supabase.js';
import { runMaintenance } from '../../src/bot-netlify.js';

export default async () => {
  const expires = await runMaintenance({ env: process.env, db: createClient() });
  console.log('토큰 만료일', JSON.stringify(expires));
};

export const config = { schedule: '0 */12 * * *' };
