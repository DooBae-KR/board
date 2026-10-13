// 사용: node video/markitdown/render.mjs <ko|en> <출력.mp4> [--stills 1,6,12,20,25,30,36]
// index.html을 프레임 단위로 그려(setT) ffmpeg로 인코딩한다. 무음 영상이며 음성·음악은 넣지 않는다.
import { spawn } from 'node:child_process';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const [lang = 'ko', out = `markitdown-${lang}.mp4`] = process.argv.slice(2);
const stillsArg = process.argv.indexOf('--stills');
const stills = stillsArg > 0 ? process.argv[stillsArg + 1].split(',').map(Number) : [];
const FPS = 30, DURATION = 40;

let chromium;
try { ({ chromium } = await import('playwright')); }
catch { ({ chromium } = await import(process.env.PLAYWRIGHT_MODULE || '/opt/node-tools/node_modules/playwright/index.mjs')); }

const demo = {
  out: readFileSync(join(here, 'demo', `out_${lang}.md`), 'utf8'),
  plain: readFileSync(join(here, 'demo', `plain_${lang}.txt`), 'utf8'),
};
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
await page.goto(pathToFileURL(join(here, 'index.html')).href);
await page.evaluate(() => document.fonts.ready);
await page.evaluate(([l, d]) => init(l, d), [lang, demo]);

if (stills.length) {
  mkdirSync(join(here, 'stills'), { recursive: true });
  for (const t of stills) { await page.evaluate((x) => setT(x), t); await page.screenshot({ path: join(here, 'stills', `${lang}-${String(t).padStart(2, '0')}.png`) }); }
  await browser.close(); process.exit(0);
}

const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
  '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-shortest',
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'medium', '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', out], { stdio: ['pipe', 'inherit', 'inherit'] });
const done = new Promise((r) => ff.on('close', r));
for (let f = 0; f < FPS * DURATION; f++) {
  await page.evaluate((t) => setT(t), f / FPS);
  const buf = await page.screenshot({ type: 'jpeg', quality: 94 });
  if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
}
ff.stdin.end(); await done; await browser.close();
console.log(`${out} 완료 (${DURATION}초, ${FPS}fps)`);
