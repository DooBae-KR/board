#!/usr/bin/env node
// 사용: node scripts/log-activity.js <agent> <start|done|fail|info> "<메시지>" [산출물 경로]
import { appendFileSync, mkdirSync } from 'node:fs';

const [agent, status, message = '', output = ''] = process.argv.slice(2);
if (!agent || !['start', 'done', 'fail', 'info'].includes(status)) {
  console.error('usage: log-activity.js <agent> <start|done|fail|info> "<message>" [output]');
  process.exit(1);
}
const file = new URL('../data/activity.jsonl', import.meta.url);
mkdirSync(new URL('../data/', import.meta.url), { recursive: true });
appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), agent, status, message, output }) + '\n');
