// Netlify Function: 인스타그램 웹훅 (/webhook). 로직은 src/bot-netlify.js.
import { createClient } from '../../scripts/lib/supabase.js';
import { handleWebhook } from '../../src/bot-netlify.js';
import { repos } from '../generated/repos.mjs';

export default async (request) => {
  try {
    return await handleWebhook(request, { env: process.env, db: createClient(), repos });
  } catch (e) {
    console.error('webhook:', e.message);
    return new Response('error', { status: 500 });
  }
};

export const config = { path: '/webhook' };
