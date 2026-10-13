// 사용: node video/story/render.mjs <stories/xxx.json> <출력.mp4> [--stills 1,10,20,30,40]
// index.html을 프레임 단위로 그려(setT) ffmpeg로 인코딩한다. 무음 영상이며 음성·음악은 넣지 않는다.
import { spawn } from 'node:child_process';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const [storyPath, out = 'story.mp4'] = process.argv.slice(2);
if (!storyPath) { console.error('story json 경로가 필요합니다'); process.exit(1); }
const story = JSON.parse(readFileSync(storyPath, 'utf8'));
const lang = story.id;
const stillsArg = process.argv.indexOf('--stills');
const stills = stillsArg > 0 ? process.argv[stillsArg + 1].split(',').map(Number) : [];
const FPS = 30, DURATION = 44;

let chromium;
try { ({ chromium } = await import('playwright')); }
catch { ({ chromium } = await import(process.env.PLAYWRIGHT_MODULE || '/opt/node-tools/node_modules/playwright/index.mjs')); }

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
await page.goto(pathToFileURL(join(here, 'index.html')).href);
await page.evaluate(() => document.fonts.ready);
await page.evaluate((s) => init(s), story);

if (stills.length) {
  mkdirSync(join(here, 'stills'), { recursive: true });
  for (const t of stills) { await page.evaluate((x) => setT(x), t); await page.screenshot({ path: join(here, 'stills', `${lang}-${String(t).padStart(2, '0')}.png`) }); }
  await browser.close(); process.exit(0);
}

const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
  '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-shortest',
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'medium', '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', out], { stdio: ['pipe', 'inherit', 'inherit'] });
const done = new Promise((r) => ff.on('close', r));
for (let f = 0; f < Math.round(FPS * DURATION); f++) {
  await page.evaluate((t) => setT(t), f / FPS);
  const buf = await page.screenshot({ type: 'jpeg', quality: 94 });
  if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
}
ff.stdin.end(); await done; await browser.close();
console.log(`${out} 완료 (${DURATION}초, ${FPS}fps)`);
