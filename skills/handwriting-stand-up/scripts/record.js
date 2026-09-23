#!/usr/bin/env node
/* Export a stand-up project as an MP4 — frame by frame (the timeline is seekable, so no dropped
 * frames), with the synthesized soundtrack rendered offline and muxed in.
 *
 *   node record.js <project-dir | file.html> [--out film.mp4] [--size 1280x720 --dpr 1.5] [--fps 30]
 *   node record.js <project-dir> --size 540x960 --dpr 2 --out film_9x16.mp4      # vertical 1080×1920
 *   node record.js <project-dir> --from 60 --to 70                              # just a slice (film seconds)
 *
 * Output pixels = size × dpr (default 1920×1080). Film time 0 = the recording starts; the story
 * follows it; 1.5 s are held on the last card. Needs playwright-core + Chrome (as shot.js) and ffmpeg.
 */
const path = require('path');
const fs = require('fs');
const { spawn, execFileSync } = require('child_process');

function loadPW() {
  for (const m of ['playwright-core', 'playwright']) {
    for (const base of [__dirname, process.cwd(), path.join(__dirname, 'node_modules')]) {
      try { return require(require.resolve(m, { paths: [base] })); } catch (e) { /* next */ }
    }
  }
  console.error('playwright-core not found — run: (cd ' + __dirname + ' && npm i playwright-core)');
  process.exit(1);
}
async function launch(chromium) {
  const args = ['--autoplay-policy=no-user-gesture-required', '--enable-gpu-rasterization', '--ignore-gpu-blocklist'].concat(process.platform === 'darwin' ? ['--use-angle=metal'] : []);
  const tries = [];
  if (process.env.CHROME_PATH) tries.push({ executablePath: process.env.CHROME_PATH });
  tries.push({});
  const cache = path.join(process.env.HOME || '', 'Library/Caches/ms-playwright');
  if (fs.existsSync(cache)) {
    for (const d of fs.readdirSync(cache).filter((d) => d.startsWith('chromium-')).sort().reverse()) {
      for (const p of [path.join(cache, d, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),
        path.join(cache, d, 'chrome-mac/Chromium.app/Contents/MacOS/Chromium')]) if (fs.existsSync(p)) tries.push({ executablePath: p });
    }
  }
  tries.push({ channel: 'chrome' });
  let err;
  for (const t of tries) { try { return await chromium.launch(Object.assign({ args }, t)); } catch (e) { err = e; } }
  throw err;
}

(async () => {
  const argv = process.argv.slice(2);
  const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
  const target = path.resolve(argv[0] || '.');
  const isDir = fs.statSync(target).isDirectory();
  const file = isDir ? path.join(target, 'index.html') : target;
  const [w, h] = opt('--size', '1280x720').split('x').map(Number);
  const dpr = +opt('--dpr', '1.5');
  const fps = +opt('--fps', '30');
  const hold = +opt('--hold', '1.5');
  const out = path.resolve(opt('--out', path.join(isDir ? target : path.dirname(target), 'dist', `${path.basename(isDir ? target : path.dirname(target))}_${w * dpr}x${h * dpr}.mp4`)));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const tmpV = out.replace(/\.mp4$/, '.video.mp4'), tmpA = out.replace(/\.mp4$/, '.audio.wav');

  const { chromium } = loadPW();
  const browser = await launch(chromium);
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + file, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => { const v = document.getElementById('vid'); return !v || !window.__vidDur || v.readyState >= 2; }, null, { timeout: 20000 });
  const { vid, dur } = await page.evaluate(() => ({ vid: window.__vidDur || 0, dur: window.__duration }));
  const total = vid + dur + hold;
  const from = +opt('--from', '0'), to = Math.min(total, +opt('--to', String(total)));
  const n = Math.round((to - from) * fps);
  console.log(`film ${total.toFixed(2)}s (recording ${vid.toFixed(2)}s + story ${dur.toFixed(2)}s) → ${n} frames @${fps}fps, ${w * dpr}×${h * dpr}`);

  // audio first (fast), so a broken soundtrack fails early
  let haveAudio = !argv.includes('--no-audio');
  if (haveAudio) {
    const b64 = await page.evaluate(() => window.__renderAudio(3));
    fs.writeFileSync(tmpA, Buffer.from(b64, 'base64'));
  }

  const ff = spawn('ffmpeg', ['-v', 'error', '-y', '-f', 'image2pipe', '-framerate', String(fps), '-i', '-',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', tmpV], { stdio: ['pipe', 'inherit', 'inherit'] });
  const t0 = Date.now();
  for (let i = 0; i < n; i++) {
    const t = from + i / fps;
    await page.evaluate((t) => window.__frame(t), t);
    const img = await page.screenshot({ type: 'jpeg', quality: 94 });
    if (!ff.stdin.write(img)) await new Promise((r) => ff.stdin.once('drain', r));
    if (i % Math.round(fps * 5) === 0) {
      const el = (Date.now() - t0) / 1000;
      console.log(`  film ${t.toFixed(1)}s  ${((i / n) * 100).toFixed(0)}%  elapsed ${el.toFixed(0)}s  eta ${i ? ((el / i) * (n - i)).toFixed(0) : '?'}s`);
    }
  }
  ff.stdin.end();
  await new Promise((r) => ff.on('close', r));
  await browser.close();

  if (haveAudio) {
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', tmpV, '-ss', String(from), '-t', String(to - from), '-i', tmpA,
      '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', out]);
    fs.unlinkSync(tmpV); fs.unlinkSync(tmpA);
  } else fs.renameSync(tmpV, out);
  console.log('→', out, `${(fs.statSync(out).size / 1048576).toFixed(1)} MB`, `in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  if (errors.length) { console.log('PAGE ERRORS:\n' + errors.join('\n')); process.exitCode = 1; }
})();
