// Netlify Function: /harness 페이지와 /api/harness/* 를 처리한다 (CLAUDE.md 6-1).
// ../generated/page.mjs는 빌드(scripts/netlify-build.js)가 만든다. 환경변수는 Netlify 사이트 설정에서 넣는다.
import { createClient } from '../../scripts/lib/supabase.js';
import { createStore } from '../../scripts/lib/store.js';
import { createHarnessApi } from '../../src/harness-api.js';
import { handleRequest } from '../../src/netlify-adapter.js';
import { pageHtml, sprites } from '../generated/page.mjs';

export default async (request) => {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DASHBOARD_TOKEN, HARNESS_API_TOKEN } = process.env;
  // 호출마다 새로 만든다(서버리스는 연결을 재사용한다고 가정하지 않는다, CLAUDE.md 4-3)
  const api = createHarnessApi({
    store: SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY ? createStore(createClient()) : null,
    dashboardToken: DASHBOARD_TOKEN, agentToken: HARNESS_API_TOKEN,
    sprites, pageHtml, supabaseUrl: SUPABASE_URL,
    onError: (e) => console.error('harness:', e.message),
  });
  return handleRequest(api, request);
};

export const config = { path: ['/harness', '/api/harness', '/api/harness/*'] };
