#!/usr/bin/env node
// 인스타 DM 봇 사전 점검. 사용: npm run bot:check [-- --online] [-- --url https://사이트]
// 환경변수는 이름의 설정 여부만 보고하며 값은 출력하지 않는다. .env가 있으면 읽는다.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runChecks, render, exitCode } from './lib/check-bot.js';

const root = fileURLToPath(new URL('..', import.meta.url));
if (existsSync(`${root}.env`)) { try { process.loadEnvFile(`${root}.env`); } catch { /* 무시 */ } }

const args = process.argv.slice(2);
const urlIdx = args.indexOf('--url');
const url = urlIdx >= 0 ? args[urlIdx + 1] : undefined;
if (urlIdx >= 0 && !/^https?:\/\//.test(url ?? '')) { console.error('--url 뒤에 https://사이트주소 를 주세요'); process.exit(2); }
const online = args.includes('--online');

let reposData = null;
try { reposData = JSON.parse(readFileSync(`${root}data/repos.json`, 'utf8')); } catch { /* 형식 오류로 보고됨 */ }

const rows = await runChecks({ env: process.env, reposData, online, url });
console.log(render(rows, process.env));
if (!online && !url) console.log('(네트워크 점검은 --online, 웹훅 핸드셰이크는 --url https://사이트 를 추가하세요)');
process.exit(exitCode(rows));
