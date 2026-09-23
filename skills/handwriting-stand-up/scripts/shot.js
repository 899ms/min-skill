#!/usr/bin/env node
/* Screenshot any moment of a stand-up project (the timeline is seekable), plus a contact sheet.
 *
 *   node shot.js <project-dir | file.html> --times 6,24,37.5 [--size 1440x900] [--dpr 1] [--out dir]
 *   node shot.js <project-dir> --times 6,24 --size 390x844 --dpr 2     # phone portrait
 *   node shot.js <project-dir> --live 14 --size 1280x800                # real-time run: click, play, report errors & frame pacing
 *
 * Needs playwright-core (`npm i playwright-core` next to this script, or globally) and a Chrome/Chromium:
 * $CHROME_PATH, Playwright's own chromium, or the system Google Chrome.
 */
const path = require('path');
const fs = require('fs');

function loadPW() {
  for (const m of ['playwright-core', 'playwright']) {
    for (const base of [__dirname, process.cwd(), path.join(__dirname, 'node_modules')]) {
      try { return require(require.resolve(m, { paths: [base] })); } catch (e) { /* next */ }
    }
    try { return require(m); } catch (e) { /* next */ }
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
      const mac = path.join(cache, d, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
      const mac2 = path.join(cache, d, 'chrome-mac/Chromium.app/Contents/MacOS/Chromium');
      for (const p of [mac, mac2]) if (fs.existsSync(p)) tries.push({ executablePath: p });
    }
  }
  tries.push({ channel: 'chrome' });
  let err;
  for (const t of tries) {
    try { return await chromium.launch(Object.assign({ args }, t)); } catch (e) { err = e; }
  }
  throw err;
}

(async () => {
  const argv = process.argv.slice(2);
  const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
  const target = path.resolve(argv[0] || '.');
  const file = fs.statSync(target).isDirectory() ? path.join(target, 'index.html') : target;
  const [w, h] = opt('--size', '1440x900').split('x').map(Number);
  const dpr = +opt('--dpr', '1');
  const outDir = path.resolve(opt('--out', path.join(fs.statSync(target).isDirectory() ? target : path.dirname(target), 'shots')));
  fs.mkdirSync(outDir, { recursive: true });

  const { chromium } = loadPW();
  const browser = await launch(chromium);
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  page.on('requestfailed', (r) => { if (!/favicon|fonts\.css/.test(r.url())) errors.push('failed to load ' + r.url()); });
  await page.goto('file://' + file, { waitUntil: 'load' });
  await page.waitForTimeout(900);
  const info = await page.evaluate(() => ({ duration: window.__duration, word: window.__word }));
  console.log('timeline', info.duration && info.duration.toFixed(2) + 's', 'word', JSON.stringify(info.word));

  const live = opt('--live');
  if (live) {
    await page.mouse.click(w / 2, h / 2);
    await page.evaluate(() => { window.__ft = []; let l = performance.now(); const f = (t) => { window.__ft.push(t - l); l = t; requestAnimationFrame(f); }; requestAnimationFrame(f); });
    await page.waitForTimeout(+live * 1000);
    const st = await page.evaluate(() => { const a = window.__ft.slice(5).sort((x, y) => x - y); return { tl: window.__tl.time().toFixed(2), frames: a.length, p50: a[a.length >> 1], p95: a[Math.floor(a.length * 0.95)] }; });
    const f = path.join(outDir, `live_${live}s.png`);
    await page.screenshot({ path: f });
    console.log('live', JSON.stringify(st), '→', f);
  }

  const times = (opt('--times', '') || '').split(',').filter(Boolean).map(Number);
  const shots = [];
  for (const t of times) {
    await page.evaluate((t) => window.__seek(t), t);
    await page.waitForTimeout(160);
    const f = path.join(outDir, `t${String(t).replace('.', '_')}_${w}x${h}.png`);
    await page.screenshot({ path: f });
    shots.push({ t, f });
  }
  if (shots.length > 1) {
    const cols = w > h ? 3 : 6, tw = w > h ? 480 : 234, th = Math.round(tw * h / w);
    const sheet = await browser.newPage({ viewport: { width: cols * tw, height: Math.ceil(shots.length / cols) * (th + 22) } });
    const cells = shots.map((s) => `<div style="position:relative"><img src="data:image/png;base64,${fs.readFileSync(s.f).toString('base64')}" style="width:${tw}px;height:${th}px;display:block"><div style="font:12px/22px monospace;padding-left:6px">t=${s.t}</div></div>`).join('');
    await sheet.setContent(`<body style="margin:0;display:grid;grid-template-columns:repeat(${cols},${tw}px);background:#ddd">${cells}</body>`);
    await sheet.waitForTimeout(300);
    const f = path.join(outDir, `sheet_${w}x${h}.png`);
    await sheet.screenshot({ path: f, fullPage: true });
    console.log('sheet →', f);
  }
  shots.forEach((s) => console.log('shot', s.t, '→', s.f));
  if (errors.length) { console.log('ERRORS:\n' + errors.join('\n')); process.exitCode = 1; } else console.log('no page errors');
  await browser.close();
})();
