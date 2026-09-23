/* handwriting-stand-up · engine
 *
 * Reads window.SOURCE (written by scripts/prepare.py) and window.STORY (story.js),
 * builds a CSS-3D paper stage on which the traced handwriting stands up, then hands
 * a toolkit `S` to STORY.build(S) so the story can choreograph on ONE paused GSAP
 * timeline. Everything is seekable: window.__seek(t) renders any moment.
 *
 * Page units: the page is SOURCE.page[0] × SOURCE.page[1] (the source frame, rescaled
 * so the written word is ~233 units tall). 3D: x → right, y → down the page (towards
 * the viewer once the camera tilts), z/h → up off the paper.
 */
(() => {
  'use strict';

  const SRC = window.SOURCE, STORY = window.STORY;
  if (!SRC || !STORY) { document.body.textContent = 'missing SOURCE or STORY'; return; }

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const NS = 'http://www.w3.org/2000/svg';
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const TAU = Math.PI * 2;

  const PAGE_W = SRC.page[0], PAGE_H = SRC.page[1];
  const INK = '#2a2422';
  const SKIN = '#f3d9c1';
  const PARCH = '#f7eedb';
  const META = Object.assign({ title: 'Stand Up', tagline: '一行字，站起来之后的故事', hero: ['Stand', 'Up'], heroSub: '站起来了。', fin: 'Finis.', replay: '再看一遍', hint: '轻点开始 · 建议开声音' }, STORY.meta || {});

  const svgEl = (tag, attrs = {}, parent) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  };
  const div = (cls, parent, style) => {
    const e = document.createElement('div');
    if (cls) e.className = cls;
    if (style) Object.assign(e.style, style);
    if (parent) parent.appendChild(e);
    return e;
  };

  /* ------------------------------------------------------------------ */
  /* Copy                                                                */
  /* ------------------------------------------------------------------ */
  document.title = META.docTitle || `${META.title} · ${META.heroSub}`;
  $('#intro .k1').textContent = META.title;
  $('#intro .k2').textContent = META.tagline;
  $('#intro .k3').textContent = META.hint;
  $('#title .t1').innerHTML = META.hero.map((w) => `<span>${w}</span>`).join(' ');
  $('#title .t2').innerHTML = `<span>${META.heroSub}</span>`;
  $('#endcard .fin').textContent = META.fin;
  $('#replay2').textContent = META.replay;

  /* ------------------------------------------------------------------ */
  /* Layout: the device mock the recording plays in                      */
  /* ------------------------------------------------------------------ */
  const V = { w: innerWidth, h: innerHeight, s0: 0.5, P: 1800 };
  const phone = $('#phone');
  const viewport = $('#viewport');
  const DEVICE = SRC.device || (SRC.video ? 'phone' : 'card');
  phone.classList.add('dev-' + DEVICE);

  function layout() {
    V.w = innerWidth; V.h = innerHeight;
    const aspect = PAGE_W / PAGE_H;
    let screenW = V.w * 0.84, screenH = screenW / aspect;
    if (screenH > V.h * 0.8) { screenH = V.h * 0.8; screenW = screenH * aspect; }
    const phoneLike = DEVICE === 'phone';
    const b = phoneLike ? Math.max(6, Math.min(screenW, screenH) * 0.035) : 0;
    V.s0 = screenH / PAGE_H;
    const W = screenW + b * 2, H = screenH + b * 2;
    const r = phoneLike ? Math.min(screenW, screenH) * 0.155 : 14;
    Object.assign(phone.style, { width: W + 'px', height: H + 'px' });
    Object.assign($('.screen', phone).style, { left: b + 'px', top: b + 'px', width: screenW + 'px', height: screenH + 'px', borderRadius: r + 'px' });
    Object.assign($('.bezel', phone).style, { borderWidth: b + 'px', borderRadius: (r + b) + 'px' });
    Object.assign($('.rim', phone).style, { borderRadius: (r + b) + 'px' });
    const island = $('.island', phone);
    if (phoneLike && aspect < 1) {
      const iw = screenW * 0.31, ih = screenW * 0.088;
      Object.assign(island.style, { display: 'block', width: iw + 'px', height: ih + 'px', left: (W - iw) / 2 + 'px', top: b + screenH * 0.0125 + 'px' });
    } else island.style.display = 'none';
    const bw = Math.max(2, b * 0.3);
    const btn = (el, side, top, len) => Object.assign(el.style, { display: phoneLike && aspect < 1 ? 'block' : 'none', width: bw + 'px', height: len * H + 'px', top: top * H + 'px', [side]: -bw + 'px' });
    btn($('.b1', phone), 'left', 0.2, 0.04);
    btn($('.b2', phone), 'left', 0.27, 0.075);
    btn($('.b3', phone), 'left', 0.36, 0.075);
    btn($('.b4', phone), 'right', 0.3, 0.11);
    V.P = Math.max(V.w, V.h) * 1.25;
    viewport.style.perspective = V.P + 'px';
  }

  /* ------------------------------------------------------------------ */
  /* Camera                                                              */
  /* ------------------------------------------------------------------ */
  const cameraEl = $('#camera');
  // x,y = focus point on the page, z = focus height above it; fit blends phone-scale → scene-scale.
  // span = page units across a landscape frame, pspan = the tighter crop used on portrait phones.
  const cam = { x: PAGE_W / 2, y: PAGE_H / 2, z: 0, tilt: 0, yaw: 0, span: 700, pspan: 600, fit: 0, oy: 0, shake: 0 };
  let camM = new DOMMatrix();
  const portraitK = () => clamp((0.9 - V.w / V.h) / 0.4, 0, 1);

  function camZ() {
    const span = lerp(cam.span, cam.pspan, portraitK());
    const zf = Math.min(V.w / span, V.h / (span * 0.62));
    return lerp(V.s0 * stage.pscale, zf, cam.fit);
  }
  function applyCamera(t) {
    const Z = camZ();
    const sk = cam.shake;
    const shx = sk ? Math.sin(t * 91) * sk * 9 + Math.sin(t * 57) * sk * 5 : 0;
    const shy = sk ? Math.cos(t * 73) * sk * 7 : 0;
    const oy = (cam.oy + portraitK() * 0.075) * V.h * cam.fit + stage.py * V.h * (1 - cam.fit);
    const tf = `translate3d(${shx}px, ${oy + shy}px, 0) scale3d(${Z}, ${Z}, ${Z}) rotateX(${cam.tilt}deg) rotateZ(${cam.yaw}deg) translate3d(${-cam.x}px, ${-cam.y}px, ${-cam.z}px)`;
    cameraEl.style.transform = tf;
    camM = new DOMMatrix(tf);
  }
  function project(x, y, z = 0) {
    const p = camM.transformPoint(new DOMPoint(x, y, z, 1));
    const s = V.P / Math.max(1, V.P - p.z);
    return { x: V.w / 2 + p.x * s, y: V.h / 2 + p.y * s, s };
  }

  /* ------------------------------------------------------------------ */
  /* The handwriting                                                     */
  /* ------------------------------------------------------------------ */
  const page = $('#page');
  Object.assign(page.style, { width: PAGE_W + 'px', height: PAGE_H + 'px' });
  const plateEl = $('#plate');
  Object.assign(plateEl.style, { width: PAGE_W + 'px', height: PAGE_H + 'px' });
  $('#floor').style.background = SRC.bg || '#fff';
  $('#sky').style.setProperty('--floorC', SRC.bg || '#fff');

  const LAYERS = 18;
  const DEPTH = 17;   // extrusion in page units once a piece is fully up
  const glyphs = [];

  function buildGlyph(g, i) {
    const pad = 4;
    const [bx, by, bw, bh] = g.bbox;
    const x = bx - pad, y = by - pad, w = bw + pad * 2, h = bh + pad * 2;
    const pivot = g.pivot;
    const vb = `${x} ${y} ${w} ${h}`;

    // the imprint / cast shadow left on the paper (only the part above the hinge)
    const sh = div('gshadow', page, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px', transformOrigin: `50% ${pivot - y}px` });
    const ssvg = svgEl('svg', { viewBox: vb, width: w, height: h, overflow: 'visible' }, sh);
    const cid = 'clip-g' + i;
    const cp = svgEl('clipPath', { id: cid }, svgEl('defs', {}, ssvg));
    svgEl('rect', { x, y: y - 400, width: w, height: pivot - y + 400 }, cp);
    svgEl('path', { d: g.d, fill: '#1a1512', 'fill-rule': 'evenodd', 'clip-path': `url(#${cid})` }, ssvg);

    const root = div('glyph', page, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px', transformOrigin: `50% ${pivot - y}px` });
    const layers = [];
    for (let k = LAYERS - 1; k >= 0; k--) {
      const s = svgEl('svg', { class: 'layer', viewBox: vb, width: w, height: h, overflow: 'visible' });
      if (k === 0) {
        svgEl('path', { d: g.d, fill: SRC.ink || '#262424', 'fill-rule': 'evenodd' }, s);
        s._face = svgEl('path', { d: g.d, fill: 'url(#inkFace)', 'fill-rule': 'evenodd', opacity: 0 }, s);
        s._gold = svgEl('path', { d: g.d, fill: 'url(#goldFace)', 'fill-rule': 'evenodd', opacity: 0 }, s);
      } else {
        const c = Math.round(lerp(62, 92, k / (LAYERS - 1)));
        svgEl('path', { d: g.d, fill: `rgb(${c},${c},${c + 3})`, 'fill-rule': 'evenodd' }, s);
      }
      root.appendChild(s);
      layers[k] = s;
    }
    const o = { i, label: g.label || String(i), root, layers, sh, x, y, w, h, pivot, cx: x + w / 2, top: by,
      rx: 0, depth: 0, face: 0, wob: 0, glow: 0, spin: 0, _d: -1, _f: -1, _g: -1 };
    glyphs.push(o);
    return o;
  }
  SRC.glyphs.forEach(buildGlyph);

  // word metrics — stories place everything relative to these
  const WORD = (() => {
    const x0 = Math.min(...glyphs.map((g) => g.x)), x1 = Math.max(...glyphs.map((g) => g.x + g.w));
    const top = Math.min(...glyphs.map((g) => g.top)), base = Math.max(...glyphs.map((g) => g.pivot));
    return { x0, x1, cx: (x0 + x1) / 2, w: x1 - x0, top, base, h: base - top };
  })();

  function renderGlyph(g) {
    g.root.style.transform = `rotateX(${g.rx}deg) rotateY(${g.spin}deg) rotateZ(${g.wob}deg)`;
    if (g.depth !== g._d) {
      g._d = g.depth;
      for (let k = 1; k < LAYERS; k++) g.layers[k].style.transform = `translateZ(${(-k * DEPTH / (LAYERS - 1)) * g.depth}px)`;
    }
    if (g.face !== g._f) { g._f = g.face; g.layers[0]._face.setAttribute('opacity', g.face); }
    if (g.glow !== g._g) {
      g._g = g.glow;
      g.layers[0]._gold.setAttribute('opacity', g.glow);
      g.layers[0].style.filter = g.glow > 0.01 ? `drop-shadow(0 0 ${14 * g.glow}px rgba(240,196,98,${0.85 * g.glow}))` : '';
    }
    const up = clamp(-g.rx / 90, 0, 1.2);
    g.sh.style.opacity = (0.2 * Math.min(1, up)).toFixed(3);
    g.sh.style.transform = `translateZ(.1px) scaleY(${1 - 0.5 * Math.min(1, up)})`;
    g.sh.style.filter = `blur(${(1 + up * 5).toFixed(2)}px)`;
    g.sh.style.visibility = up > 0.01 ? 'visible' : 'hidden';
  }

  /* ------------------------------------------------------------------ */
  /* Props: a boxing ring drawn on the paper (posts & ropes pop up)      */
  /* ------------------------------------------------------------------ */
  const rings = [];
  function makeRing(o = {}) {
    const w = o.w || 360, d = o.d || 240;
    const cx = clamp(o.cx != null ? o.cx : WORD.cx, w / 2 + 12, PAGE_W - w / 2 - 12);
    const y0 = o.y0 != null ? o.y0 : WORD.base + 76;
    const R = { x0: cx - w / 2, x1: cx + w / 2, y0, y1: y0 + d, cx, cy: y0 + d / 2, canvas: 0, border: 0, ropes: 0, ropeA: 1, posts: [], ropeList: [] };
    const svg = svgEl('svg', { class: 'flat', width: PAGE_W, height: PAGE_H, viewBox: `0 0 ${PAGE_W} ${PAGE_H}`, overflow: 'visible' });
    svg.style.transform = 'translateZ(.12px)';
    page.appendChild(svg);
    const gid = 'canvasGrad' + rings.length;
    const cg = svgEl('radialGradient', { id: gid, cx: 0.5, cy: 0.5, r: 0.7 }, svgEl('defs', {}, svg));
    svgEl('stop', { offset: 0, 'stop-color': '#f8f1e2' }, cg);
    svgEl('stop', { offset: 1, 'stop-color': '#ecdfc2' }, cg);
    R.canvasRect = svgEl('rect', { x: R.x0, y: R.y0, width: w, height: d, fill: `url(#${gid})`, opacity: 0 }, svg);
    R.borders = [0, 6].map((ins, i) => svgEl('rect', {
      x: R.x0 + ins, y: R.y0 + ins, width: w - ins * 2, height: d - ins * 2,
      fill: 'none', stroke: INK, 'stroke-width': i ? 0.9 : 1.8, pathLength: 1, 'stroke-dasharray': '1 1', 'stroke-dashoffset': 1,
    }, svg));
    R.ornaments = svgEl('g', { opacity: 0 }, svg);
    [[R.x0, R.y0], [R.x1, R.y0], [R.x0, R.y1], [R.x1, R.y1]].forEach(([x, y]) => svgEl('circle', { cx: x, cy: y, r: 7, fill: 'url(#gold)', stroke: INK, 'stroke-width': 1.2 }, R.ornaments));
    svgEl('circle', { cx, cy: R.y0 + d * 0.5, r: 30, fill: 'none', stroke: '#c9a45a', 'stroke-width': 1, 'stroke-dasharray': '2 3', opacity: 0.7 }, R.ornaments);

    const post = (x, y, color, flip) => {
      const st = div('stand3d', page);
      const s = svgEl('svg', { viewBox: '0 0 20 92', width: 20, height: 92, overflow: 'visible' });
      Object.assign(s.style, { position: 'absolute', left: '-10px', top: '-90px', overflow: 'visible' });
      st.appendChild(s);
      const flag = svgEl('g', {}, s);
      svgEl('path', { d: flip ? 'M10 6 L-14 11 L-6 14.5 L-14 18 L10 20 Z' : 'M10 6 L34 11 L26 14.5 L34 18 L10 20 Z', fill: color, stroke: INK, 'stroke-width': 1.1, 'stroke-linejoin': 'round' }, flag);
      svgEl('rect', { x: 7.5, y: 8, width: 5, height: 82, rx: 1.2, fill: '#efe4ca', stroke: INK, 'stroke-width': 1.2 }, s);
      [30, 50, 70].forEach((yy) => svgEl('rect', { x: 6.8, y: yy, width: 6.4, height: 3, fill: 'url(#gold)', stroke: INK, 'stroke-width': 0.7 }, s));
      svgEl('circle', { cx: 10, cy: 6, r: 4, fill: 'url(#gold)', stroke: INK, 'stroke-width': 1.1 }, s);
      R.posts.push({ st, flag, x, y, rx: 0, a: 0 });
    };
    const lc = o.left || '#c4633f', rc = o.right || '#2f6b63';
    post(R.x0, R.y0, lc, true); post(R.x1, R.y0, rc, false); post(R.x0, R.y1, lc, true); post(R.x1, R.y1, rc, false);

    const rope = (x, y, len, vertical) => {
      const st = div('stand3d', page);
      const s = svgEl('svg', { viewBox: `0 0 ${len} 80`, width: len, height: 80, overflow: 'visible' });
      Object.assign(s.style, { position: 'absolute', left: 0, top: '-80px', overflow: 'visible' });
      st.appendChild(s);
      const paths = [];
      [[20, '#efe4ca'], [40, o.rope || '#b8402c'], [60, '#efe4ca']].forEach(([h, c]) => {
        const yy = 80 - h, dd = `M0 ${yy} Q${len / 2} ${yy + len * 0.012} ${len} ${yy}`;
        paths.push(svgEl('path', { d: dd, stroke: INK, 'stroke-width': 3.2, fill: 'none', 'stroke-linecap': 'round', pathLength: 1, 'stroke-dasharray': '1 1', 'stroke-dashoffset': 1 }, s));
        paths.push(svgEl('path', { d: dd, stroke: c, 'stroke-width': 1.6, fill: 'none', 'stroke-linecap': 'round', pathLength: 1, 'stroke-dasharray': '1 1', 'stroke-dashoffset': 1 }, s));
      });
      R.ropeList.push({ st, paths, x, y, vertical });
    };
    rope(R.x0, R.y0, w, false); rope(R.x0, R.y0, d, true); rope(R.x1, R.y0, d, true); rope(R.x0, R.y1, w, false);
    rings.push(R);
    return R;
  }
  function renderRing(R, t) {
    R.canvasRect.setAttribute('opacity', (R.canvas * 0.62).toFixed(3));
    R.ornaments.setAttribute('opacity', R.canvas.toFixed(3));
    R.borders.forEach((p) => p.setAttribute('stroke-dashoffset', (1 - R.border).toFixed(4)));
    R.posts.forEach((p, i) => {
      p.st.style.transform = `translate3d(${p.x}px, ${p.y}px, .2px) rotateX(${p.rx}deg)`;
      p.st.style.visibility = p.a > 0.001 ? 'visible' : 'hidden';
      p.st.style.opacity = p.a;
      const w = Math.sin(t * 5.2 + i * 1.3) * 0.12 + Math.sin(t * 8.1 + i) * 0.05;
      p.flag.setAttribute('transform', `translate(10 13) skewY(${w * 40}) scale(${1 - Math.abs(w) * 0.5} 1) translate(-10 -13)`);
    });
    R.ropeList.forEach((r) => {
      r.st.style.transform = `translate3d(${r.x}px, ${r.y}px, .2px) ${r.vertical ? 'rotateZ(90deg) ' : ''}rotateX(-90deg)`;
      r.st.style.visibility = R.ropes > 0.001 && R.ropeA > 0.001 ? 'visible' : 'hidden';
      r.st.style.opacity = R.ropeA;
      r.paths.forEach((p) => p.setAttribute('stroke-dashoffset', (1 - R.ropes).toFixed(4)));
    });
  }

  /* ------------------------------------------------------------------ */
  /* Marginalia figures (IK arms & legs)                                 */
  /* ------------------------------------------------------------------ */
  const FIG_S = 0.72;          // svg unit → page unit
  const FIG_W = 120, FIG_H = 180, GROUND = 174;

  function hemPath(x0, x1, y, n, dep) {
    let d = '';
    const w = (x1 - x0) / n;
    for (let i = 0; i < n; i++) { const a = x0 + i * w; d += ` Q${(a + w / 2).toFixed(2)} ${y + dep} ${(a + w).toFixed(2)} ${y}`; }
    return d;
  }
  function spiral(cx, cy, r0, r1, turns, steps = 60) {
    let d = '';
    for (let i = 0; i <= steps; i++) {
      const k = i / steps, a = k * turns * TAU, r = lerp(r0, r1, k);
      d += (i ? ' L' : 'M') + (cx + Math.cos(a) * r).toFixed(2) + ' ' + (cy + Math.sin(a) * r).toFixed(2);
    }
    return d;
  }
  const EMBLEMS = {
    star: 'M62 88 l2.2 4.6 l5 .6 l-3.7 3.4 l1 5 l-4.5 -2.5 l-4.5 2.5 l1 -5 l-3.7 -3.4 l5 -.6 Z',
    cross: 'M62 86 m-6 0 a6 6 0 1 0 12 0 a6 6 0 1 0 -12 0 M62 82 v8 M58 86 h8',
    heart: 'M62 97 C54 91 55 84 59 84 C61 84 62 86 62 87 C62 86 63 84 65 84 C69 84 70 91 62 97 Z',
    moon: 'M64 83 A7 7 0 1 0 64 97 A5.5 5.5 0 1 1 64 83 Z',
  };

  function buildFigureSVG(o) {
    const skin = o.skin || SKIN;
    const s = svgEl('svg', { viewBox: `0 0 ${FIG_W} ${FIG_H}`, width: FIG_W * FIG_S, height: FIG_H * FIG_S, overflow: 'visible', class: 'fig' });
    s.style.overflow = 'visible';
    const rig = svgEl('g', { id: o.id + '-rig', transform: o.mirror ? `translate(${FIG_W} 0) scale(-1 1)` : '' }, s);
    const P = {};
    const inkc = (extra) => Object.assign({ stroke: INK, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', pathLength: 1, class: 'ink' }, extra);
    const circles = (parent, list, fill) => {
      list.forEach(([x, y, r]) => svgEl('circle', inkc({ cx: x, cy: y, r, fill, class: 'ink pig' }), parent));
      list.forEach(([x, y, r]) => svgEl('circle', { cx: x, cy: y, r: r - 1.15, fill, class: 'pig' }, parent));
    };

    const leg = (color) => {
      const g = svgEl('g', {}, rig);
      const ol = svgEl('path', { fill: 'none', stroke: INK, 'stroke-width': 8.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', class: 'ink', pathLength: 1 }, g);
      const fl = svgEl('path', { fill: 'none', stroke: color, 'stroke-width': 6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', class: 'pigs' }, g);
      const shoe = svgEl('path', inkc({ d: 'M-6 -3.5 C-5 -8 3 -8.5 6 -5 C12 -3 18 -3.5 23 -9 C24 -3 18 1 9 1 L-5 1 C-8 1 -8 -2 -6 -3.5 Z', fill: o.shoe || '#3b2c24', class: 'ink pig', 'stroke-width': 1.5 }), g);
      return { g, ol, fl, shoe };
    };
    P.legB = leg(o.hoseB || '#2f2b33');
    P.legF = leg(o.hoseA || '#efe6d2');

    const body = svgEl('g', {}, rig); P.body = body;
    const arm = (parent, color) => {
      const g = svgEl('g', {}, parent);
      const ol = svgEl('path', { fill: 'none', stroke: INK, 'stroke-width': 9.4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', class: 'ink', pathLength: 1 }, g);
      const fl = svgEl('path', { fill: 'none', stroke: color, 'stroke-width': 6.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', class: 'pigs' }, g);
      return { g, ol, fl };
    };
    const tunic = o.tunic || '#c8694a', tunicDk = o.tunicDk || '#8e3f2a';
    P.armB = arm(body, o.sleeveDk || tunicDk);

    const torso = svgEl('g', {}, body);
    svgEl('path', inkc({ d: 'M57 62 L67 62 L68 78 L56 78 Z', fill: skin, class: 'ink pig', 'stroke-width': 1.8 }), torso);
    svgEl('path', inkc({ d: `M53 76 C47 77 44 81 44 88 L46.5 107 L40 130${hemPath(40, 86, 130, 6, 5.5)} L78.5 107 L80 88 C80 81 77 77 71 76 Q62 83 53 76 Z`, fill: tunic, class: 'ink pig' }), torso);
    svgEl('path', { d: 'M47 90 L49.5 128 L41 130 L46.5 107 Z', fill: tunicDk, opacity: 0.55, class: 'pig' }, torso);
    ['M49 94 l4 -4', 'M49 100 l4.5 -4.5', 'M48 116 l4 -4', 'M47 122 l4.5 -4.5', 'M72 114 l4 -3', 'M73 120 l4 -3'].forEach((d) =>
      svgEl('path', inkc({ d, fill: 'none', 'stroke-width': 0.9, opacity: 0.55 }), torso));
    svgEl('path', inkc({ d: 'M53 76 Q62 83 71 76', fill: 'none', stroke: '#c99a3e', 'stroke-width': 2.2 }), torso);
    svgEl('path', inkc({ d: `M40.8 130${hemPath(40, 86, 130, 6, 5.5)}`, fill: 'none', stroke: '#c99a3e', 'stroke-width': 1.3, opacity: 0.9 }), torso);
    svgEl('path', inkc({ d: 'M45.9 104.5 L79 104.5 L79.2 110 L45.6 110 Z', fill: '#5a3a26', class: 'ink pig', 'stroke-width': 1.4 }), torso);
    svgEl('rect', inkc({ x: 65.5, y: 103.2, width: 6.5, height: 8, rx: 1, fill: 'url(#gold)', class: 'ink pig', 'stroke-width': 1.2 }), torso);
    const em = EMBLEMS[o.emblem] || o.emblem;
    if (em) svgEl('path', inkc({ d: em, fill: 'url(#gold)', class: 'ink pig', 'stroke-width': 1 }), torso);

    // head
    const head = svgEl('g', {}, body); P.head = head;
    const hairC = o.hairC || '#3a2a22';
    const hair = o.hair || 'short';
    if (hair === 'curly') circles(svgEl('g', {}, head), [[46, 36, 10], [50, 24.5, 10.5], [61, 18, 10.5], [72.5, 18.5, 9.5], [81, 24.5, 7.5], [42.5, 48, 7], [45.5, 58, 5.5], [85, 31, 5]], hairC);
    else if (hair === 'long') svgEl('path', inkc({ d: 'M42 30 C44 13 76 9 85 26 C88 34 87 42 85 48 L79 39 C70 34 57 35 51 43 C49 56 50 70 55 82 C45 84 37 76 37 62 C37 50 39 38 42 30 Z', fill: hairC, class: 'ink pig' }), head);
    else if (hair === 'short') svgEl('path', inkc({ d: 'M44 52 C38 40 40 22 56 16.5 C68 12.5 82 16 86 27 C87 31 86.5 35 85 38 L50 44 Z', fill: hairC, class: 'ink pig' }), head);
    svgEl('ellipse', inkc({ cx: 46.5, cy: 48, rx: 4.3, ry: 5.8, fill: skin, class: 'ink pig', 'stroke-width': 1.7 }), head);
    svgEl('path', inkc({ d: 'M84 43 C88 47 90 51 84.5 52.8', fill: skin, class: 'ink pig', 'stroke-width': 1.7 }), head);
    svgEl('ellipse', inkc({ cx: 64.5, cy: 45, rx: 20, ry: 21.5, fill: skin, class: 'ink pig' }), head);
    svgEl('path', { d: 'M84.2 44.5 C87.4 47.6 88.4 50.6 84.8 51.8', fill: skin, class: 'pig' }, head);
    svgEl('path', inkc({ d: 'M84.4 44.2 C88 47.5 89.4 51 84.6 52.6', fill: 'none', 'stroke-width': 1.6 }), head);
    svgEl('circle', { cx: 74.5, cy: 53, r: 4.2, fill: '#ec9f90', opacity: 0.42, class: 'pig' }, head);
    if (hair === 'curly') {
      circles(svgEl('g', {}, head), [[56, 27, 6.2], [64.5, 23.5, 6.4], [73, 24.5, 6], [80.5, 28.5, 5], [85, 34.5, 3.6], [49, 32, 5.5]], hairC);
      ['M58 25 q2 -2.5 4 0', 'M67 21.5 q2 -2.5 4 0', 'M48 23 q2 -2.5 4 0', 'M60 15 q2 -2.5 4 0', 'M75 23 q1.8 -2.2 3.6 0', 'M42 44 q2 -2.4 4 0'].forEach((d) =>
        svgEl('path', inkc({ d, fill: 'none', 'stroke-width': 1.1, opacity: 0.75 }), head));
    } else if (hair === 'short') {
      svgEl('path', inkc({ d: 'M46 40 C48 28 60 21 72 22.5 C80 23.5 86 28 86.5 36 C82 30.5 76 29.5 71.5 31.5 C68 28.5 61 29 56 33 C52 35.5 49 38 47.5 42 Z', fill: hairC, class: 'ink pig' }), head);
      ['M56 26 q6 -3.5 12 -2.5', 'M60 30 q5 -3 10 -2.4', 'M74 25.5 q5 1 8.5 4.5'].forEach((d) => svgEl('path', inkc({ d, fill: 'none', 'stroke-width': 0.9, opacity: 0.6 }), head));
    } else if (hair === 'long') {
      svgEl('path', inkc({ d: 'M46 38 C50 24 64 20 76 23 C82 25 86 30 86.5 36 C80 31 72 30 66 33 C60 30 52 33 47.5 42 Z', fill: hairC, class: 'ink pig' }), head);
    } else if (hair === 'bald') {
      svgEl('path', inkc({ d: 'M44 50 C41 42 43 34 48 30 C47 36 48 42 51 48 Z', fill: hairC, class: 'ink pig', 'stroke-width': 1.5 }), head);
    }
    if (o.beard) svgEl('path', inkc({ d: 'M48 50 C49 64 58 72 69 71 C78 70 84 63 85.5 54 C81 59 76 60.5 72 59 C66 62 57 60 52 53 Z', fill: hairC, class: 'ink pig', 'stroke-width': 1.7 }), head);
    // hats
    if (o.hat === 'crown') {
      svgEl('path', inkc({ d: 'M47 27 L48.5 11 L56 20 L64 8 L72 20 L79.5 11 L81 27 Q64 23 47 27 Z', fill: 'url(#gold)', class: 'ink pig', 'stroke-width': 1.6 }), head);
      [[56, 24.5, '#b8402c'], [64, 23.5, '#2d4f9a'], [72, 24.5, '#b8402c']].forEach(([x, y, c]) => svgEl('circle', { cx: x, cy: y, r: 1.6, fill: c, class: 'pig' }, head));
    } else if (o.hat === 'helmet') {
      svgEl('path', inkc({ d: 'M44 33 C44 14 85 13 85 33 Z', fill: '#aeb2b8', class: 'ink pig', 'stroke-width': 1.8 }), head);
      svgEl('path', inkc({ d: 'M35 33.5 Q64 26 93 33.5 Q64 40 35 33.5 Z', fill: '#c5c9ce', class: 'ink pig', 'stroke-width': 1.6 }), head);
      svgEl('path', { d: 'M52 20 Q60 16 70 17', stroke: '#fff', 'stroke-width': 1.6, fill: 'none', opacity: 0.6, class: 'pigs' }, head);
    } else if (o.hat === 'beret') {
      svgEl('path', inkc({ d: 'M43 31 C41 18 69 11 87 21 C91 25 87 30 81 29 L48 33 Z', fill: o.hatC || '#2d4f9a', class: 'ink pig', 'stroke-width': 1.7 }), head);
      svgEl('path', inkc({ d: 'M50 22 C44 10 36 6 30 8 C36 12 42 17 47 24 Z', fill: '#efe4ca', class: 'ink pig', 'stroke-width': 1.3 }), head);
    }
    P.brows = svgEl('path', inkc({ d: o.brows || 'M66.5 37.6 Q70 35.6 74 36.8 M78.6 36.4 Q81.2 35 83.6 36.6', fill: 'none', 'stroke-width': 1.6 }), head);
    const eyeR = o.eyeR || 1.8;
    P.eyesOpen = svgEl('g', {}, head);
    svgEl('ellipse', { cx: 71.5, cy: 45.2, rx: eyeR, ry: eyeR * 1.15, fill: INK }, P.eyesOpen);
    svgEl('ellipse', { cx: 81.6, cy: 44.4, rx: eyeR * 0.9, ry: eyeR * 1.05, fill: INK }, P.eyesOpen);
    svgEl('circle', { cx: 72.2, cy: 44.3, r: 0.6, fill: '#fff' }, P.eyesOpen);
    P.eyesX = svgEl('path', { d: 'M69 42.5 l5 5 M74 42.5 l-5 5 M79.6 41.8 l4 4.2 M83.6 41.8 l-4 4.2', stroke: INK, 'stroke-width': 1.5, 'stroke-linecap': 'round', fill: 'none', display: 'none' }, head);
    P.eyesShut = svgEl('path', { d: 'M68.8 45.6 Q71.5 47.6 74.2 45.6 M79.4 44.8 Q81.6 46.4 83.8 44.8', stroke: INK, 'stroke-width': 1.5, 'stroke-linecap': 'round', fill: 'none', display: 'none' }, head);
    if (o.glasses) {
      svgEl('circle', inkc({ cx: 71.5, cy: 45.2, r: 5.7, fill: 'rgba(255,255,255,.18)', stroke: '#5b4526', 'stroke-width': 1.35 }), head);
      svgEl('circle', inkc({ cx: 81.8, cy: 44.4, r: 4.3, fill: 'rgba(255,255,255,.18)', stroke: '#5b4526', 'stroke-width': 1.35 }), head);
      svgEl('path', inkc({ d: 'M77.2 45 Q77.4 43.2 77.6 44.6 M65.8 45.4 L49.5 47', fill: 'none', stroke: '#5b4526', 'stroke-width': 1.2 }), head);
    }
    P.mouths = {
      calm: svgEl('path', { d: 'M74 58.2 Q77.6 60.4 81 57.6', stroke: INK, 'stroke-width': 1.5, fill: 'none', 'stroke-linecap': 'round' }, head),
      smile: svgEl('path', { d: 'M72.8 57.4 Q77.5 62.4 82.2 57', stroke: INK, 'stroke-width': 1.6, fill: 'none', 'stroke-linecap': 'round' }, head),
      grin: svgEl('path', { d: 'M72 56.6 Q77.5 64 83.4 55.8 Q77.5 59.6 72 56.6 Z', stroke: INK, 'stroke-width': 1.4, fill: '#fff', 'stroke-linejoin': 'round' }, head),
      ouch: svgEl('ellipse', { cx: 78, cy: 59, rx: 2.4, ry: 3.1, stroke: INK, 'stroke-width': 1.3, fill: '#7a2e24' }, head),
      tired: svgEl('path', { d: 'M72.5 59 q2 -2.2 4 0 q2 2.2 4 0 q1.2 -1.4 2.4 0', stroke: INK, 'stroke-width': 1.4, fill: 'none', 'stroke-linecap': 'round' }, head),
      firm: svgEl('path', { d: 'M73.6 58.4 L81 57.6', stroke: INK, 'stroke-width': 1.7, fill: 'none', 'stroke-linecap': 'round' }, head),
      sad: svgEl('path', { d: 'M73.4 59.8 Q77.5 56.4 81.6 59.4', stroke: INK, 'stroke-width': 1.5, fill: 'none', 'stroke-linecap': 'round' }, head),
    };
    P.sweat = svgEl('path', { d: 'M52 34 q-2.6 4 0 5.4 q2.6 -1.4 0 -5.4 Z M88 30 q-2.2 3.4 0 4.6 q2.2 -1.2 0 -4.6 Z', fill: '#bfe0f0', stroke: INK, 'stroke-width': 0.8, opacity: 0 }, head);

    const hand = (parent, color) => {
      const g = svgEl('g', {}, parent);
      const inner = svgEl('g', {}, g);
      if (o.hands === 'hands') {
        svgEl('path', inkc({ d: 'M-2 -5 C3 -8.5 10.5 -7.5 11.5 -2 C12.5 3 8.5 6.5 4 6.5 C0 6.5 -2 4 -2 1 Z', fill: skin, class: 'ink pig', 'stroke-width': 1.6 }), inner);
        svgEl('path', inkc({ d: 'M2.5 -6 C3 -9.5 7.5 -10 8.4 -6.8', fill: skin, class: 'ink pig', 'stroke-width': 1.3 }), inner);
      } else {
        svgEl('rect', inkc({ x: -4, y: -6.5, width: 6, height: 13, rx: 1.6, fill: 'url(#gold)', class: 'ink pig', 'stroke-width': 1.5 }), inner);
        svgEl('path', inkc({ d: 'M1 -7.5 C6 -12 16 -11 18 -3.5 C20 3.5 15.5 9.5 8 9.5 C4 9.5 1 7.2 1 4 Z', fill: color, class: 'ink pig', 'stroke-width': 1.9 }), inner);
        svgEl('path', inkc({ d: 'M4.5 -8.2 C5 -13 11.5 -13.5 12.5 -9', fill: color, class: 'ink pig', 'stroke-width': 1.6 }), inner);
        svgEl('path', { d: 'M7 -5.5 Q11.5 -7 14.2 -3', stroke: 'rgba(255,255,255,.6)', 'stroke-width': 1.4, fill: 'none', 'stroke-linecap': 'round', class: 'pigs' }, inner);
      }
      return { g, inner };
    };
    P.gloveB = hand(body, o.glove || '#2d4f9a');
    P.armF = arm(body, o.sleeve || tunic);
    P.gloveF = hand(body, o.glove || '#2d4f9a');
    if (o.gloveLabel) {
      const t = svgEl('text', { x: 9, y: 3.2, 'text-anchor': 'middle', 'font-size': 7.5, 'font-weight': 700, fill: '#fff6dc', opacity: 0 }, P.gloveF.inner);
      t.textContent = o.gloveLabel;
      P.gloveLabel = t;
    }
    if (o.book) {
      // a small bound book, held up by the front hand; title stacked vertically
      const b = svgEl('g', { opacity: 0 }, body);
      svgEl('rect', { x: -12.5, y: -17, width: 25, height: 31, rx: 2, fill: o.bookC || '#6f2a22', stroke: INK, 'stroke-width': 1.8 }, b);
      svgEl('rect', { x: -9.8, y: -14.3, width: 19.6, height: 25.6, rx: 1, fill: 'none', stroke: '#d8b25b', 'stroke-width': 1.1 }, b);
      svgEl('path', { d: 'M12.5 -15 L15 -13.5 L15 13.5 L12.5 14', fill: '#efe4ca', stroke: INK, 'stroke-width': 1.2 }, b);
      const chars = [...String(o.book)].slice(0, 3);
      const fs = chars.length > 2 ? 7 : 9, step = fs * 1.25, y0 = -1.5 - ((chars.length - 1) * step) / 2 + fs * 0.35;
      chars.forEach((c, i) => {
        const t = svgEl('text', { x: 0, y: y0 + i * step, 'text-anchor': 'middle', 'font-size': fs, 'font-weight': 700, fill: '#e9c878' }, b);
        t.textContent = c;
      });
      P.book = b;
    }
    return { svg: s, P };
  }

  function ik(sx, sy, tx, ty, l1, l2, px, py) {
    let dx = tx - sx, dy = ty - sy, d = Math.hypot(dx, dy) || 0.001;
    const max = l1 + l2 - 0.01;
    if (d > max) { tx = sx + dx / d * max; ty = sy + dy / d * max; dx = tx - sx; dy = ty - sy; d = max; }
    const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    const ux = dx / d, uy = dy / d;
    let nx = -uy, ny = ux;
    if (nx * px + ny * py < 0) { nx = -nx; ny = -ny; }
    return { ex: sx + ux * a + nx * h, ey: sy + uy * a + ny * h, tx, ty };
  }

  const GUARD = { fx: 93, fy: 66, gbx: 81, gby: 73 };
  const REST = { fx: 78, fy: 112, gbx: 60, gby: 112 };   // arms hanging, for non-fighting stories
  class Figure {
    constructor(o) {
      this.o = o;
      const { svg, P } = buildFigureSVG(o);
      this.svg = svg; this.P = P;
      const arms = o.hands === 'hands' ? REST : GUARD;
      this.s = { bx: 0, by: 0, lean: 0, head: 0, fx: arms.fx, fy: arms.fy, gbx: arms.gbx, gby: arms.gby, gF: 1, glowF: 0,
        footBx: 47, footBy: 173, footFx: 80, footFy: 173, idle: 0, idleRate: 1, book: 0, sweat: 0, draw: 0, fill: 0,
        face: o.face || 'calm', eyes: 'open', label: 0 };
      this.phase = o.phase || 0;
      this._face = null; this._eyes = null;
    }
    render(t) {
      const s = this.s, P = this.P;
      const w = t * TAU * 1.55 * s.idleRate + this.phase;
      const bob = Math.sin(w) * 2.1 * s.idle;
      const sway = Math.sin(w * 0.5) * 1.6 * s.idle;
      const bx = s.bx + sway * 0.6, by = s.by + Math.abs(bob) * 1.2;
      P.body.setAttribute('transform', `translate(${bx.toFixed(2)} ${by.toFixed(2)}) rotate(${(s.lean + sway * 0.5).toFixed(2)} 62 124)`);
      P.head.setAttribute('transform', `translate(0 3.5) rotate(${(s.head + Math.sin(w + 1) * 1.5 * s.idle).toFixed(2)} 62 70)`);
      const gb = Math.sin(w + 0.6) * 1.8 * s.idle;
      const fa = ik(74, 84, s.fx, s.fy + gb, 17.5, 17.5, -0.35, 1);
      const ba = ik(55, 85, s.gbx, s.gby - gb, 17.5, 17.5, -0.35, 1);
      const armD = (sx, sy, a) => `M${sx} ${sy} L${a.ex.toFixed(2)} ${a.ey.toFixed(2)} L${a.tx.toFixed(2)} ${a.ty.toFixed(2)}`;
      const dF = armD(74, 84, fa), dB = armD(55, 85, ba);
      P.armF.ol.setAttribute('d', dF); P.armF.fl.setAttribute('d', dF);
      P.armB.ol.setAttribute('d', dB); P.armB.fl.setAttribute('d', dB);
      const angF = Math.atan2(fa.ty - fa.ey, fa.tx - fa.ex) * 180 / Math.PI;
      const angB = Math.atan2(ba.ty - ba.ey, ba.tx - ba.ex) * 180 / Math.PI;
      const rotF = angF * 0.55 - 20;
      P.gloveF.g.setAttribute('transform', `translate(${fa.tx.toFixed(2)} ${fa.ty.toFixed(2)}) rotate(${rotF.toFixed(2)}) scale(${s.gF.toFixed(3)})`);
      P.gloveB.g.setAttribute('transform', `translate(${ba.tx.toFixed(2)} ${ba.ty.toFixed(2)}) rotate(${(angB * 0.55 - 20).toFixed(2)})`);
      P.gloveF.g.style.filter = s.glowF > 0.01 ? `drop-shadow(0 0 ${6 * s.glowF}px rgba(245,200,95,${s.glowF}))` : '';
      if (P.gloveLabel) {
        P.gloveLabel.setAttribute('opacity', s.label);
        P.gloveLabel.setAttribute('transform', `rotate(${(-rotF).toFixed(2)} 9 0)${this.o.mirror ? ' translate(18 0) scale(-1 1)' : ''}`);
      }
      if (P.book) {
        P.book.setAttribute('opacity', s.book);
        P.book.setAttribute('transform', `translate(${(fa.tx + 3).toFixed(2)} ${(fa.ty - 5).toFixed(2)}) scale(${(this.o.mirror ? -1 : 1) * (0.6 + 0.4 * s.book)} ${(0.6 + 0.4 * s.book).toFixed(3)})`);
      }
      const lean = (s.lean * Math.PI) / 180;
      const hipX = (hx) => bx + 62 + (hx - 62) * Math.cos(lean);
      const hipY = by + 125;
      const legD = (hx, fx, fy) => {
        const a = ik(hipX(hx), hipY, fx, fy - 2, 25, 25, 1, -0.15);
        return `M${hipX(hx).toFixed(2)} ${hipY.toFixed(2)} L${a.ex.toFixed(2)} ${a.ey.toFixed(2)} L${fx.toFixed(2)} ${(fy - 2).toFixed(2)}`;
      };
      const lB = legD(57, s.footBx, s.footBy), lF = legD(68, s.footFx, s.footFy);
      P.legB.ol.setAttribute('d', lB); P.legB.fl.setAttribute('d', lB);
      P.legF.ol.setAttribute('d', lF); P.legF.fl.setAttribute('d', lF);
      P.legB.shoe.setAttribute('transform', `translate(${s.footBx.toFixed(2)} ${s.footBy.toFixed(2)})`);
      P.legF.shoe.setAttribute('transform', `translate(${s.footFx.toFixed(2)} ${s.footFy.toFixed(2)})`);
      if (s.face !== this._face) {
        this._face = s.face;
        for (const k in P.mouths) P.mouths[k].setAttribute('display', k === s.face ? 'inline' : 'none');
      }
      const blink = s.eyes === 'open' && ((t * 0.31 + this.phase * 0.13) % 1) < 0.022;
      const eyes = blink ? 'shut' : s.eyes;
      if (eyes !== this._eyes) {
        this._eyes = eyes;
        P.eyesOpen.setAttribute('display', eyes === 'open' ? 'inline' : 'none');
        P.eyesX.setAttribute('display', eyes === 'x' ? 'inline' : 'none');
        P.eyesShut.setAttribute('display', eyes === 'shut' ? 'inline' : 'none');
      }
      P.sweat.setAttribute('opacity', s.sweat);
      this.svg.style.setProperty('--draw', s.draw);
      this.svg.style.setProperty('--fill', s.fill);
    }
  }

  function buildSnailSVG(SN) {
    const s = svgEl('svg', { viewBox: '0 0 80 60', width: 80 * SN, height: 60 * SN, overflow: 'visible', class: 'fig' });
    s.style.overflow = 'visible';
    const g = svgEl('g', {}, s);
    const body = svgEl('path', { d: 'M4 57 C8 51 20 50 42 51 C52 51 57 46 59 39 C60 34 64 33 66.5 36.5 C68 41 66 49 63 53 C60 57 52 58 40 58 L8 58 C4 58 2 58 4 57 Z', fill: '#cfd4b4', stroke: INK, 'stroke-width': 1.6, class: 'ink pig', pathLength: 1 }, g);
    svgEl('path', { d: 'M61 37 L62 22 M65 37 L70.5 24', stroke: INK, 'stroke-width': 1.6, 'stroke-linecap': 'round', fill: 'none', class: 'ink', pathLength: 1 }, g);
    svgEl('circle', { cx: 62, cy: 21, r: 2.3, fill: INK, class: 'pig' }, g);
    svgEl('circle', { cx: 70.8, cy: 23, r: 2.3, fill: INK, class: 'pig' }, g);
    svgEl('path', { d: 'M63.6 45.5 q2 1.6 3.4 -.4', stroke: INK, 'stroke-width': 1.1, fill: 'none', 'stroke-linecap': 'round', class: 'pigs' }, g);
    const shell = svgEl('g', {}, g);
    svgEl('circle', { cx: 33, cy: 36, r: 17, fill: 'url(#gold)', stroke: INK, 'stroke-width': 1.8, class: 'ink pig', pathLength: 1 }, shell);
    svgEl('path', { d: spiral(33, 36, 1.2, 14.5, 2.4), fill: 'none', stroke: INK, 'stroke-width': 1.3, 'stroke-linecap': 'round', class: 'ink', pathLength: 1 }, shell);
    const sign = svgEl('g', { opacity: 0 }, g);
    svgEl('path', { d: 'M54 50 L54 6', stroke: '#6b4a2e', 'stroke-width': 2.2, 'stroke-linecap': 'round' }, sign);
    svgEl('rect', { x: 40, y: -12, width: 28, height: 20, rx: 2.5, fill: PARCH, stroke: INK, 'stroke-width': 1.5 }, sign);
    const num = svgEl('text', { x: 54, y: 3.6, 'text-anchor': 'middle', 'font-size': 14, 'font-weight': 700, fill: '#8e2f22' }, sign);
    return { svg: s, body, shell, sign, num };
  }

  /* actors: a foot point on the paper + a pop-up card that can stand, spin, fly and fold */
  const actors = [];
  function makeActor(o) {
    const el = div('actor', page);
    const sh = div('a-shadow', el);
    const blob = div('blob', sh);
    const stand = div('a-stand', el);
    const figWrap = div('a-fig', stand);
    const a = { el, sh, blob, stand, figWrap, x: o.x, y: o.y, rx: 0, lift: 0, spin: 0, tip: 0, a: 0, w: o.w, h: o.h, name: o.name, fold: o.fold !== false };
    figWrap.appendChild(o.svg);
    Object.assign(figWrap.style, { left: -o.ax + 'px', top: -o.foot + 'px', width: o.w + 'px', height: o.h + 'px' });
    blob.style.transform = `scale(${o.w / 68}, 1)`;
    if (o.castId) {
      const cast = svgEl('svg', { class: 'cast', viewBox: o.viewBox, width: o.w, height: o.h, overflow: 'visible' });
      svgEl('use', { href: '#' + o.castId }, cast);
      Object.assign(cast.style, { left: -o.ax + 'px', top: -o.foot + 'px', filter: 'brightness(0) blur(2.4px)' });
      sh.appendChild(cast);
      a.cast = cast;
    }
    if (o.banner) {
      const b = svgEl('svg', { viewBox: '0 0 150 40', width: 66, height: 17.6, overflow: 'visible', class: 'a-banner' });
      Object.assign(b.style, { position: 'absolute', left: '-33px', top: -(o.foot + 26) + 'px' });
      svgEl('path', { d: 'M22 13 L4 13 L11 22.5 L4 32 L26 32 Z', fill: '#e6d6b2', stroke: INK, 'stroke-width': 1.3, 'stroke-linejoin': 'round' }, b);
      svgEl('path', { d: 'M128 13 L146 13 L139 22.5 L146 32 L124 32 Z', fill: '#e6d6b2', stroke: INK, 'stroke-width': 1.3, 'stroke-linejoin': 'round' }, b);
      svgEl('path', { d: 'M18 8 Q75 3 132 8 L132 30 Q75 25 18 30 Z', fill: PARCH, stroke: INK, 'stroke-width': 1.4, 'stroke-linejoin': 'round' }, b);
      svgEl('path', { d: 'M22 11.5 Q75 6.8 128 11.5 M22 26.6 Q75 21.8 128 26.6', fill: 'none', stroke: '#c99a3e', 'stroke-width': 0.8 }, b);
      const tx = svgEl('text', { x: 75, y: 23.2, 'text-anchor': 'middle', 'font-size': o.banner.length > 8 ? 12 : 15.5, fill: INK }, b);
      tx.style.fontFamily = /[㐀-鿿]/.test(o.banner) ? 'var(--serif)' : 'var(--black)';
      tx.textContent = o.banner;
      stand.appendChild(b);
      a.banner = b; a.bannerK = 0;
    }
    actors.push(a);
    return a;
  }
  function renderActor(a, t) {
    const up = clamp(-a.rx / 90, 0, 1.2);
    a.el.style.transform = `translate3d(${a.x.toFixed(2)}px, ${a.y.toFixed(2)}px, .3px)`;
    a.el.style.opacity = a.a;
    a.el.style.visibility = a.a > 0.001 ? 'visible' : 'hidden';
    a.stand.style.transform = `rotateX(${a.rx}deg) translate3d(0, ${-a.lift}px, 0)`;
    a.figWrap.style.transform = `rotateY(${a.spin}deg) rotateZ(${a.tip}deg)`;
    const k = Math.min(1, up) * clamp(1 - a.lift / 140, 0.25, 1);
    a.blob.style.opacity = (k * 0.9).toFixed(3);
    if (a.cast) {
      a.cast.style.opacity = (0.16 * Math.min(1, up) * clamp(1 - a.lift / 60, 0, 1)).toFixed(3);
      a.cast.style.transform = `scaleY(${0.5 * Math.min(1, up)}) rotateY(${a.spin}deg)`;
    }
    if (a.banner) {
      a.banner.style.opacity = a.bannerK;
      a.banner.style.transform = `translate3d(0, ${Math.sin(t * 2.2 + a.x) * 1.2}px, 0) scale(${lerp(0.2, 1, a.bannerK)}, ${lerp(0.6, 1, a.bannerK)})`;
    }
  }

  const knights = [];
  let knightN = 0;
  function makeKnight(o) {
    const id = 'k' + knightN++;
    const fig = new Figure(Object.assign({ id, phase: knightN * 1.3 }, o));
    const W_ = FIG_W * FIG_S, H_ = FIG_H * FIG_S;
    const actor = makeActor({ name: o.name, svg: fig.svg, x: o.x, y: o.y, w: W_, h: H_, ax: W_ / 2, foot: GROUND * FIG_S, castId: id + '-rig', viewBox: `0 0 ${FIG_W} ${FIG_H}`, banner: o.banner });
    const k = { fig, s: fig.s, a: actor, o,
      // body-local point (svg units) → page offset from the actor's foot point
      point(x, y) { const mx = o.mirror ? FIG_W - (x + fig.s.bx) : x + fig.s.bx; return { dx: (mx - FIG_W / 2) * FIG_S, h: (GROUND - (y + fig.s.by)) * FIG_S }; },
    };
    knights.push(k);
    return k;
  }

  const snails = [];
  function makeSnail(o = {}) {
    const SN = o.scale || 0.64;
    const parts = buildSnailSVG(SN);
    const actor = makeActor({ name: 'snail', svg: parts.svg, x: o.x != null ? o.x : 60, y: o.y != null ? o.y : WORD.base + 300, w: 80 * SN, h: 60 * SN, ax: 40 * SN, foot: 58 * SN });
    const sn = { parts, a: actor, state: { crawl: 0, sign: 0, drawn: 0 }, signs: [] };
    snails.push(sn);
    return sn;
  }
  function renderSnail(sn, t) {
    const sp = sn.parts, st = sn.state;
    const c = st.crawl * (sn.a.a > 0 ? 1 : 0);
    const k = Math.sin(t * 5.5) * 0.045 * c;
    sp.body.setAttribute('transform', `translate(4 58) scale(${1 + k} ${1 - k * 0.6}) translate(-4 -58)`);
    sp.shell.setAttribute('transform', `translate(${Math.sin(t * 5.5 + 0.8) * 0.8 * c} ${-Math.abs(Math.sin(t * 5.5)) * 0.6 * c})`);
    sp.sign.setAttribute('opacity', st.sign);
    sp.sign.setAttribute('transform', `translate(54 50) scale(${lerp(0.4, 1, st.sign)}) rotate(${Math.sin(t * 3) * 3 * st.sign}) translate(-54 -50)`);
    let txt = '';
    for (const [tt, s] of sn.signs) if (t >= tt) txt = s;
    if (sp.num.textContent !== txt) sp.num.textContent = txt;
    sp.svg.style.setProperty('--draw', st.drawn);
    sp.svg.style.setProperty('--fill', st.drawn);
  }

  /* ------------------------------------------------------------------ */
  /* Sprites: sparks, ink stars, parchment tags, dust                    */
  /* ------------------------------------------------------------------ */
  const sprites = [];
  function makeSprite(html, flat) {
    const el = div('sprite', page);
    if (typeof html === 'string') el.innerHTML = html; else el.appendChild(html);
    const s = { el, x: 0, y: 0, h: 0, a: 0, sc: 1, rot: 0, flat: !!flat };
    sprites.push(s);
    return s;
  }
  function renderSprite(s) {
    s.el.style.visibility = s.a > 0.002 ? 'visible' : 'hidden';
    if (s.a <= 0.002) return;
    s.el.style.opacity = s.a;
    s.el.style.transform = s.flat
      ? `translate3d(${s.x}px, ${s.y}px, ${s.h}px) scale(${s.sc}) rotate(${s.rot}deg)`
      : `translate3d(${s.x}px, ${s.y}px, ${s.h}px) rotateZ(${-cam.yaw}deg) rotateX(-90deg) scale(${s.sc}) rotate(${s.rot}deg)`;
  }
  const starSVG = (c) => `<svg viewBox="-20 -20 40 40" width="26" height="26" style="position:absolute;left:-13px;top:-13px;overflow:visible"><path d="M0 -17 L3.6 -5 L15 -8 L6.4 1.4 L13 11 L1.6 6.6 L-4 17 L-4.6 5.4 L-15.6 6 L-6.8 -2 L-12 -12.6 L-1.8 -6.4 Z" fill="${c}" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
  const sparkSVG = '<svg viewBox="-20 -20 40 40" width="30" height="30" style="position:absolute;left:-15px;top:-15px;overflow:visible"><circle r="19" fill="url(#spark)"/><path d="M0 -14 L2 -2 L14 0 L2 2 L0 14 L-2 2 L-14 0 L-2 -2 Z" fill="#fffdf0"/></svg>';
  const dustHTML = '<div style="position:absolute;left:-7px;top:-7px;width:14px;height:14px;border-radius:50%;background:radial-gradient(closest-side,rgba(60,50,40,.35),rgba(60,50,40,0))"></div>';
  function makeTag(text, i = 0) {
    const t = document.createElement('div');
    t.className = 'tag'; t.textContent = text;
    t.style.transform = `translate(-50%, -100%) rotate(${(i % 2 ? 1 : -1) * (4 + (i * 3) % 6)}deg)`;
    return makeSprite(t);
  }
  const dizzy = { a: 0, x: 0, y: 0, r: 34 };
  const dizzyStars = Array.from({ length: 4 }, (_, i) => makeSprite(starSVG(i % 2 ? '#f2d27a' : '#fff1c9'), true));
  function renderDizzy(t) {
    dizzyStars.forEach((s, i) => {
      const a = t * 3.2 + (i / dizzyStars.length) * TAU;
      s.a = dizzy.a; s.x = dizzy.x + Math.cos(a) * dizzy.r; s.y = dizzy.y + Math.sin(a) * dizzy.r * 0.47; s.h = 2;
      s.sc = 0.7 + 0.15 * Math.sin(a * 2); s.rot = t * 90 + i * 40;
    });
  }

  /* ------------------------------------------------------------------ */
  /* Captions, title, chapter cards                                      */
  /* ------------------------------------------------------------------ */
  const capRoot = $('#captions');
  function makeCaption(eb, ln, nt) {
    const el = div('cap', capRoot);
    if (eb) div('eb', el).textContent = eb;
    const l = div('ln', el);
    for (const ch of ln) { const s = document.createElement('span'); s.className = 'ch'; s.textContent = ch === ' ' ? ' ' : ch; l.appendChild(s); }
    if (nt) div('nt', el).textContent = nt;
    return el;
  }
  const rcRoot = $('#roundcard');
  function makeRound(num, en, zh) {
    const el = div('rc', rcRoot);
    div('num', el).textContent = num;
    if (en) div('lbl', el).textContent = en;
    if (zh) div('zh', el).textContent = zh;
    return el;
  }

  /* ------------------------------------------------------------------ */
  /* Audio (all synthesized, no files)                                   */
  /* ------------------------------------------------------------------ */
  const Sound = (() => {
    let ctx = null, out, sfxBus, music, noiseBuf, enabled = true, sched = null, musicOn = false, drum = false, step = 0, nextT = 0, stopAt = Infinity;
    let sim = null;          // offline rendering: { t } replaces the audio clock
    const cache = {};
    function init() {
      if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      buildGraph();
    }
    function buildGraph() {
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -16; comp.ratio.value = 3.5; comp.attack.value = 0.004; comp.release.value = 0.2;
      out = ctx.createGain(); out.gain.value = enabled ? 0.9 : 0;
      out.connect(comp); comp.connect(ctx.destination);
      sfxBus = ctx.createGain(); sfxBus.connect(out);
      music = ctx.createGain(); music.gain.value = 0; music.connect(out);
      const len = ctx.sampleRate * 2;
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      const ir = ctx.createBuffer(2, ctx.sampleRate * 1.6, ctx.sampleRate);
      for (let c = 0; c < 2; c++) { const x = ir.getChannelData(c); for (let i = 0; i < x.length; i++) x[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / x.length, 3.2); }
      const conv = ctx.createConvolver(); conv.buffer = ir;
      const wet = ctx.createGain(); wet.gain.value = 0.2;
      sfxBus.connect(conv); music.connect(conv); conv.connect(wet); wet.connect(out);
    }
    const now = () => (sim ? sim.t : ctx.currentTime);
    function env(g, t, a, peak, dec) {
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + a);
      g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec);
    }
    function noise(t, dur, type, f0, f1, q, peak, a = 0.01, dest = sfxBus) {
      const src = ctx.createBufferSource(); src.buffer = noiseBuf;
      const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q;
      f.frequency.setValueAtTime(f0, t); if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
      const g = ctx.createGain(); env(g, t, a, peak, dur);
      src.connect(f); f.connect(g); g.connect(dest);
      src.start(t, Math.random()); src.stop(t + a + dur + 0.05);
    }
    function tone(t, type, f0, f1, dur, peak, a = 0.005, dest = sfxBus) {
      const o = ctx.createOscillator(); o.type = type;
      o.frequency.setValueAtTime(f0, t); if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
      const g = ctx.createGain(); env(g, t, a, peak, dur);
      o.connect(g); g.connect(dest); o.start(t); o.stop(t + a + dur + 0.05);
    }
    const fx = {
      whoosh: (d = 1) => { const t = now(); noise(t, 0.9 * d, 'bandpass', 220, 1600, 1.1, 0.22, 0.35 * d); },
      thock: () => { const t = now(); tone(t, 'sine', 150, 62, 0.22, 0.5); noise(t, 0.05, 'lowpass', 1600, 0, 0.7, 0.18); },
      pop: () => { const t = now(); tone(t, 'sine', 820, 260, 0.1, 0.22); noise(t, 0.06, 'highpass', 2500, 0, 0.7, 0.07); },
      scribble: (d = 1) => {
        const t = now();
        for (let i = 0; i < d * 14; i++) noise(t + i * 0.07 + Math.random() * 0.03, 0.05 + Math.random() * 0.05, 'bandpass', 3000 + Math.random() * 2500, 0, 2.2, 0.03 + Math.random() * 0.04, 0.008);
      },
      bell: () => {
        const t0 = now();
        [0, 0.34].forEach((dt) => {
          const t = t0 + dt;
          [[1, 0.28], [2.32, 0.16], [4.25, 0.09], [6.63, 0.05]].forEach(([m, g]) => tone(t, 'sine', 1180 * m, 0, 1.8 / Math.sqrt(m), g, 0.002));
          noise(t, 0.03, 'highpass', 4000, 0, 0.7, 0.12, 0.001);
        });
      },
      punch: (heavy) => {
        const t = now();
        tone(t, 'sine', heavy ? 110 : 150, 38, heavy ? 0.45 : 0.18, heavy ? 0.9 : 0.4);
        noise(t, heavy ? 0.22 : 0.09, 'lowpass', heavy ? 1400 : 2200, 300, 0.8, heavy ? 0.55 : 0.25, 0.003);
      },
      whiff: () => { const t = now(); noise(t, 0.3, 'bandpass', 500, 2600, 1.4, 0.2, 0.12); },
      inflate: () => { const t = now(); noise(t, 1.2, 'bandpass', 200, 900, 3, 0.1, 0.6); tone(t, 'triangle', 90, 180, 1.2, 0.08, 0.5); },
      ting: () => { const t = now(); [2600, 3910, 5230].forEach((f, i) => tone(t, 'sine', f * (0.98 + Math.random() * 0.04), 0, 0.5 - i * 0.1, 0.07 / (i + 1), 0.001)); noise(t, 0.02, 'highpass', 5000, 0, 0.7, 0.08, 0.001); },
      tick: () => { const t = now(); noise(t, 0.09, 'bandpass', 1500, 0, 9, 0.5, 0.001); tone(t, 'sine', 1050, 900, 0.06, 0.08, 0.001); },
      sparkle: () => { const t = now(); for (let i = 0; i < 9; i++) tone(t + i * 0.07, 'sine', 1800 + Math.random() * 2600, 0, 0.35, 0.05, 0.002); },
      flop: () => { const t = now(); noise(t, 0.3, 'lowpass', 900, 200, 0.7, 0.4, 0.004); tone(t, 'sine', 90, 45, 0.35, 0.55); },
      chord: () => { const t = now(); [50, 57, 62, 65, 69, 74].forEach((m, i) => pluck(m, t + i * 0.09, 0.2)); },
      boing: () => { const t = now(); tone(t, 'triangle', 180, 520, 0.35, 0.18, 0.005); },
    };
    function play(name, arg) { if (!ctx || !enabled) return; try { fx[name](arg); } catch (e) { /* ignore */ } }

    // Karplus–Strong lute
    function lute(midi) {
      if (cache[midi]) return cache[midi];
      const sr = ctx.sampleRate, f = 440 * Math.pow(2, (midi - 69) / 12);
      const N = Math.max(2, Math.round(sr / f)), len = Math.floor(sr * 2.4);
      const buf = ctx.createBuffer(1, len, sr), d = buf.getChannelData(0);
      const ring = new Float32Array(N);
      let prev = 0;
      for (let i = 0; i < N; i++) { const r = Math.random() * 2 - 1; prev = prev * 0.55 + r * 0.45; ring[i] = prev; }
      let idx = 0;
      const decay = 0.9965 - Math.max(0, midi - 62) * 0.0003;
      for (let i = 0; i < len; i++) {
        const a = ring[idx], b = ring[(idx + 1) % N];
        d[i] = a * (i < len - 2000 ? 1 : (len - i) / 2000);
        ring[idx] = (a + b) * 0.5 * decay;
        idx = (idx + 1) % N;
      }
      return (cache[midi] = buf);
    }
    function pluck(midi, t, gain) {
      const src = ctx.createBufferSource(); src.buffer = lute(midi);
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 2600;
      const g = ctx.createGain(); g.gain.value = gain;
      src.connect(f); f.connect(g); g.connect(music); src.start(t);
    }
    // an estampie-ish tune in D dorian on an eighth-note grid, 6 per bar
    const MEL = [[74, 2], [69, 1], [65, 1], [69, 2], [67, 2], [65, 1], [64, 1], [62, 2], [65, 2], [67, 1], [69, 1], [72, 2], [69, 4], [0, 2],
      [74, 2], [76, 1], [74, 1], [72, 2], [69, 2], [67, 1], [65, 1], [67, 2], [69, 2], [65, 1], [64, 1], [60, 2], [62, 6]];
    const BASS = [[50, 57], [50, 57], [53, 60], [45, 52], [48, 55], [43, 50], [45, 52], [50, 57]];
    const melAt = {}; { let p = 0; MEL.forEach(([m, l]) => { if (m) melAt[p] = m; p += l; }); }
    const EIGHTH = 0.3;
    function tick() {
      if (!ctx || !sched) return;
      if (!musicOn && now() > stopAt) { if (!sim) clearInterval(sched); sched = null; return; }
      while (nextT < now() + 0.35) {
        const s = step % 48, bar = Math.floor(s / 6), sb = s % 6;
        if (melAt[s]) pluck(melAt[s], nextT, 0.34);
        const [r, f5] = BASS[bar];
        if (sb === 0) pluck(r, nextT, 0.3);
        if (sb === 2) pluck(f5, nextT, 0.16);
        if (sb === 4) pluck(r + 12, nextT, 0.12);
        if (drum) {
          if (sb === 0 || sb === 3) { noise(nextT, 0.16, 'lowpass', 180, 80, 0.8, 0.28, 0.003, music); tone(nextT, 'sine', 95, 55, 0.18, 0.3, 0.003, music); }
          if (sb === 5) noise(nextT, 0.05, 'bandpass', 2400, 0, 2, 0.06, 0.002, music);
        }
        nextT += EIGHTH; step++;
      }
    }
    function musicStart(level = 0.55) {
      if (!ctx) return;
      stopAt = Infinity;
      if (!sched) { step = 0; nextT = now() + 0.08; sched = sim ? 'sim' : setInterval(tick, 40); }
      musicOn = true;
      music.gain.cancelScheduledValues(now());
      music.gain.setTargetAtTime(level, now(), 0.6);
    }
    function musicLevel(level, tc = 0.5) { if (ctx) { music.gain.cancelScheduledValues(now()); music.gain.setTargetAtTime(level, now(), tc); } }
    function musicStop(tc = 0.8) {
      if (!ctx) return;
      musicOn = false;
      music.gain.cancelScheduledValues(now());
      music.gain.setTargetAtTime(0, now(), tc);
      stopAt = now() + tc * 5;
    }
    // Render the whole soundtrack into an AudioBuffer. `drive(sim, tick)` moves sim.t forward and
    // fires the timeline's calls; everything they schedule lands on the offline context instead.
    async function renderOffline(total, drive, sr = 44100) {
      const saved = { ctx, out, sfxBus, music, noiseBuf, sched, musicOn, drum, step, nextT, stopAt, enabled };
      if (typeof sched === 'number') clearInterval(sched);
      for (const k in cache) delete cache[k];
      ctx = new OfflineAudioContext(2, Math.ceil(sr * total), sr);
      enabled = true; sched = null; musicOn = false; drum = false; stopAt = Infinity;
      buildGraph();
      sim = { t: 0 };
      try { drive(sim, tick); return await ctx.startRendering(); }
      finally {
        sim = null;
        for (const k in cache) delete cache[k];
        ({ ctx, out, sfxBus, music, noiseBuf, sched, musicOn, drum, step, nextT, stopAt, enabled } = saved);
        if (typeof saved.sched === 'number') sched = setInterval(tick, 40);
      }
    }
    return {
      init, play, musicStart, musicStop, musicLevel, renderOffline,
      setDrum(v) { drum = v; },
      setEnabled(v) { enabled = v; if (ctx) out.gain.setTargetAtTime(v ? 0.9 : 0, ctx.currentTime, 0.05); },
      get enabled() { return enabled; },
      suspend() { if (ctx && ctx.state === 'running') ctx.suspend(); },
      resume() { if (ctx && ctx.state === 'suspended') ctx.resume(); },
    };
  })();

  /* ------------------------------------------------------------------ */
  /* Stage-level state                                                   */
  /* ------------------------------------------------------------------ */
  const stage = { video: SRC.video ? 1 : 0, phone: 1, floor: 0, plate: 1, sky: 0, lights: 0, pscale: 1, py: 0, rc: 0,
    spot: { x: WORD.cx, y: WORD.base + 196, z: 70 } };
  const rcBack = $('#rcback'), glowEl = $('#glow5'), scrimEl = $('#scrim'), vigEl = $('#vignette'), floorEl = $('#floor'),
    skyEl = $('#sky'), spotEl = $('#spot'), beamEl = $('#spotbeam');
  const vid = $('#vid');
  const screenEl = $('.screen', phone);
  const phoneParts = $$('#phone > .rim, #phone > .bezel, #phone > .island, #phone > .btn');

  function renderStage() {
    screenEl.style.opacity = stage.video;
    screenEl.style.visibility = stage.video > 0.001 ? 'visible' : 'hidden';
    phoneParts.forEach((p) => { p.style.opacity = stage.phone; });
    phone.style.visibility = stage.phone > 0.001 || stage.video > 0.001 ? 'visible' : 'hidden';
    phone.style.transform = `translate(-50%, calc(-50% + ${(stage.py * V.h).toFixed(2)}px)) scale(${stage.pscale})`;
    floorEl.style.opacity = stage.floor;
    vigEl.style.opacity = stage.floor;
    plateEl.style.opacity = stage.plate;
    plateEl.style.visibility = stage.plate > 0.001 ? 'visible' : 'hidden';
    skyEl.style.opacity = stage.sky;
    const hz = project(cam.x, cam.y - 1e5, 0).y;
    skyEl.style.setProperty('--hy', clamp(hz, -2 * V.h, 3 * V.h) + 'px');
    spotEl.style.opacity = stage.lights;
    beamEl.style.opacity = stage.lights;
    scrimEl.style.opacity = stage.floor;
    rcBack.style.opacity = stage.rc;
    rcBack.style.visibility = stage.rc > 0.001 ? 'visible' : 'hidden';
    // a glowing glyph cuts through the darkness with a 2D light on top of the spotlight
    let gg = null;
    for (const g of glyphs) if (!gg || g.glow > gg.glow) gg = g;
    const gl = gg ? gg.glow : 0;
    glowEl.style.opacity = gl;
    if (gl > 0.001) {
      const c = project(gg.cx, gg.pivot, (gg.pivot - gg.top) * 0.5);
      glowEl.style.setProperty('--gx', c.x + 'px');
      glowEl.style.setProperty('--gy', c.y + 'px');
      glowEl.style.setProperty('--gr', Math.max(80, c.s * camZ() * (gg.pivot - gg.top) * 0.65) + 'px');
    }
    if (stage.lights > 0.001) {
      const sp = stage.spot;
      const c = project(sp.x, sp.y, sp.z);
      spotEl.style.setProperty('--sx', c.x + 'px');
      spotEl.style.setProperty('--sy', c.y + 'px');
      beamEl.style.setProperty('--sx', c.x + 'px');
      const r = project(sp.x + 180, sp.y, sp.z).x - c.x;
      spotEl.style.setProperty('--sw', Math.max(200, r * 2.0) + 'px');
      spotEl.style.setProperty('--sh', Math.max(180, r * 1.45) + 'px');
    }
    const L = clamp(stage.lights, 0, 1);
    const mix = (a, b) => `rgb(${a.map((v, i) => Math.round(lerp(v, b[i], L))).join(',')})`;
    const root = document.documentElement.style;
    root.setProperty('--capInk', mix([29, 29, 31], [246, 242, 234]));
    root.setProperty('--capMuted', mix([110, 110, 115], [190, 182, 168]));
    root.setProperty('--capGold', mix([168, 129, 47], [222, 190, 120]));
    const sk = L.toFixed(3);
    if (sk !== scrimEl._k) {
      scrimEl._k = sk;
      const c = [255, 255, 255].map((v, i) => Math.round(lerp(v, [14, 12, 11][i], L))).join(',');
      scrimEl.style.background = `linear-gradient(to top, rgba(${c},1) 0%, rgba(${c},.82) 38%, rgba(${c},.4) 70%, rgba(${c},0) 100%)`;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Timeline toolkit handed to the story                                */
  /* ------------------------------------------------------------------ */
  const tl = gsap.timeline({ paused: true });
  const to = (o, vars, t) => tl.to(o, vars, t);
  const set = (o, vars, t) => tl.set(o, vars, t);
  const sfx = (t, name, arg) => tl.call(() => Sound.play(name, arg), null, t);
  const call = (t, fn) => tl.call(fn, null, t);

  function caption(t0, t1, eb, ln, nt) {
    const el = makeCaption(eb, ln, nt);
    const chars = $$('.ch', el);
    const extra = [...el.children].filter((c) => !c.classList.contains('ln'));
    tl.fromTo(el, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.01 }, t0);
    tl.fromTo(chars, { opacity: 0, y: 12, filter: 'blur(7px)' }, { opacity: 1, y: 0, filter: 'blur(0px)', duration: 0.7, stagger: Math.min(0.045, 0.9 / chars.length), ease: 'power3.out' }, t0);
    if (extra.length) tl.fromTo(extra, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.8, ease: 'power2.out' }, t0 + 0.15);
    tl.to(el, { autoAlpha: 0, y: -8, filter: 'blur(5px)', duration: 0.5, ease: 'power2.in' }, t1 - 0.5);
    tl.set(el, { y: 0, filter: 'blur(0px)' }, t1 + 0.01);
    return t1;
  }
  function card(t, num, en, zh, bell = true) {
    const el = makeRound(num, en, zh);
    to(stage, { rc: 1, duration: 0.5, ease: 'power2.out' }, t - 0.1);
    to(stage, { rc: 0, duration: 0.6, ease: 'power2.inOut' }, t + 1.75);
    tl.fromTo(el, { autoAlpha: 0, scale: 1.12, filter: 'blur(14px)' }, { autoAlpha: 1, scale: 1, filter: 'blur(0px)', duration: 0.8, ease: 'expo.out' }, t);
    const lbl = $('.lbl', el);
    if (lbl) tl.fromTo(lbl, { letterSpacing: '1.2em', opacity: 0 }, { letterSpacing: '.5em', opacity: 1, duration: 1.1, ease: 'expo.out' }, t + 0.1);
    tl.to(el, { autoAlpha: 0, scale: 0.96, filter: 'blur(10px)', duration: 0.55, ease: 'power2.in' }, t + 1.7);
    if (bell) sfx(t + 0.05, 'bell');
    return t + 2.2;
  }
  const shot = (t, vars, dur = 2.2, ease = 'power2.inOut') => to(cam, Object.assign({ duration: dur, ease }, vars), t);
  const lights = (t, v, dur = 1.3) => to(stage, { lights: v, duration: dur, ease: 'power2.inOut' }, t);
  const shake = (t, amount = 1, dur = 0.6) => { to(cam, { shake: amount, duration: 0.05 }, t); to(cam, { shake: 0, duration: dur, ease: 'power2.out' }, t + 0.05); };
  const music = {
    start: (t, level = 0.5) => call(t, () => Sound.musicStart(level)),
    level: (t, level, tc = 0.5) => call(t, () => Sound.musicLevel(level, tc)),
    drum: (t, on) => call(t, () => Sound.setDrum(on)),
    stop: (t, tc = 1.2) => call(t, () => Sound.musicStop(tc)),
  };

  // Write a character onto the page in ink, colour it in, then pop it up.
  function writeIn(k, t, { banner = true } = {}) {
    const a = k.a;
    set(a, { a: 1 }, t);
    to(k.s, { draw: 1, duration: 1.3, ease: 'power1.inOut' }, t);
    sfx(t, 'scribble', 1.3);
    to(k.s, { fill: 1, duration: 0.6, ease: 'power1.out' }, t + 1.0);
    to(a, { rx: -90, duration: 0.85, ease: 'back.out(1.9)' }, t + 1.6);
    sfx(t + 1.6, 'pop');
    if (banner && a.banner) to(a, { bannerK: 1, duration: 0.7, ease: 'back.out(1.6)' }, t + 2.15);
    return t + 2.3;
  }
  function snailIn(sn, t) {
    set(sn.a, { a: 1 }, t);
    to(sn.state, { drawn: 1, duration: 0.8 }, t);
    to(sn.a, { rx: -90, duration: 0.7, ease: 'back.out(2)' }, t + 0.6);
    to(sn.state, { crawl: 1, duration: 0.3 }, t + 1.0);
    return t + 1.3;
  }
  function drawRing(R, t) {
    to(R, { canvas: 1, duration: 1.0, ease: 'power1.inOut' }, t);
    to(R, { border: 1, duration: 1.5, ease: 'power2.inOut' }, t + 0.1);
    sfx(t + 0.1, 'scribble', 1.4);
    R.posts.forEach((p, i) => {
      set(p, { a: 1 }, t + 1.0 + i * 0.12);
      to(p, { rx: -90, duration: 0.7, ease: 'back.out(2.2)' }, t + 1.0 + i * 0.12);
      sfx(t + 1.0 + i * 0.12, 'pop');
    });
    to(R, { ropes: 1, duration: 1.1, ease: 'power2.inOut' }, t + 1.7);
    return t + 2.8;
  }
  // a glyph rocks like a coin that was bumped
  function rock(g, t, amp = 7) {
    const w = gsap.timeline();
    [[1, 0.5], [-0.86, 0.62], [0.72, 0.62], [-0.57, 0.6], [0.43, 0.55], [-0.2, 0.5], [0, 0.45]].forEach(([v, d]) => w.to(g, { wob: v * amp, duration: d, ease: 'sine.inOut' }));
    tl.add(w, t);
    return t + 3.8;
  }

  // 0 · the recording hands over to the page, and the ink stands up
  function rise(t0 = 0) {
    to(stage, { video: 0, duration: 0.35, ease: 'none' }, t0);
    to(stage, { phone: 0, duration: 1.0, ease: 'power2.inOut' }, t0 + 0.35);
    to(stage, { floor: 1, duration: 0.9, ease: 'power1.inOut' }, t0 + 0.45);
    to(stage, { plate: 0, duration: 1.1, ease: 'power2.inOut' }, t0 + 0.6);
    to(stage, { sky: 1, duration: 1.6, ease: 'power1.inOut' }, t0 + 1.4);
    const span = Math.max(1.72 * WORD.w, 3.2 * WORD.h), pspan = Math.max(1.2 * WORD.w, 2.4 * WORD.h);
    shot(t0 + 1.2, { fit: 1, span, pspan, tilt: 60, x: WORD.cx, y: WORD.base - 0.26 * WORD.h, z: 0.36 * WORD.h, oy: 0.1 }, 3.0, 'power3.inOut');
    const gap = Math.min(0.25, 1.2 / glyphs.length);
    glyphs.forEach((g, i) => {
      const t = t0 + 1.7 + i * gap;
      to(g, { rx: -90, duration: 1.6, ease: 'back.out(1.35)' }, t);
      to(g, { face: 1, duration: 0.7, ease: 'power1.inOut' }, t + 0.1);
      to(g, { depth: 1, duration: 1.3, ease: 'power2.out' }, t + 0.15);
      if (i < 6) { sfx(t, 'whoosh', 1.1); sfx(t + 0.62, 'thock'); }
    });
    shot(t0 + 4.2, { yaw: -10, tilt: 66, span: span * 0.95, pspan: pspan * 0.97 }, 5.2, 'sine.inOut');
    const t1s = $$('#title .t1 span'), t2s = $$('#title .t2 span');
    tl.fromTo(t1s, { opacity: 0, y: 22, filter: 'blur(12px)' }, { opacity: 1, y: 0, filter: 'blur(0px)', duration: 1.1, stagger: 0.14, ease: 'expo.out' }, t0 + 4.4);
    tl.fromTo(t2s, { opacity: 0, y: 12, filter: 'blur(8px)' }, { opacity: 1, y: 0, filter: 'blur(0px)', duration: 1.0, ease: 'expo.out' }, t0 + 5.0);
    tl.to([...t1s, ...t2s], { opacity: 0, y: -10, filter: 'blur(8px)', duration: 0.6, stagger: 0.05, ease: 'power2.in' }, t0 + 8.4);
    return t0 + 9.0;
  }

  // ∞ · everything lies back down and the device returns, now with the doodles on the page
  function finale(t0, line, { lineDur = 4.8 } = {}) {
    set(stage, { pscale: 0.84, py: -0.045 }, t0 - 0.1);
    to(stage, { lights: 0, duration: 1.0 }, t0 - 0.1);
    shot(t0, { fit: 0, tilt: 0, yaw: 0, x: PAGE_W / 2, y: PAGE_H / 2, z: 0, oy: 0 }, 3.3, 'power3.inOut');
    glyphs.forEach((g, i) => {
      const t = t0 + 0.5 + i * Math.min(0.15, 0.8 / glyphs.length);
      to(g, { rx: 0, duration: 1.0, ease: 'power2.in' }, t);
      to(g, { depth: 0, duration: 0.9, ease: 'power2.in' }, t + 0.1);
      to(g, { face: 0, glow: 0, wob: 0, duration: 0.6 }, t + 0.5);
      if (i < 6) sfx(t + 0.95, 'thock');
    });
    knights.forEach((k) => { to(k.s, { idle: 0, duration: 0.4 }, t0 + 0.6); if (k.a.banner) to(k.a, { bannerK: 0, duration: 0.4 }, t0 + 0.5); });
    actors.forEach((a, i) => { if (a.fold) to(a, { rx: 0, lift: 0, spin: 0, duration: 0.8, ease: 'power2.in' }, t0 + 0.9 + i * 0.12); });
    rings.forEach((R) => {
      to(R, { ropeA: 0, duration: 0.6 }, t0 + 0.6);
      R.posts.forEach((p, i) => to(p, { a: 0, rx: -40, duration: 0.7, ease: 'power2.in' }, t0 + 0.7 + i * 0.06));
    });
    to(stage, { sky: 0, duration: 1.4, ease: 'power1.inOut' }, t0 + 2.0);
    to(stage, { plate: 1, duration: 1.2, ease: 'power2.inOut' }, t0 + 2.4);
    to(stage, { floor: 0, duration: 1.0, ease: 'power2.inOut' }, t0 + 2.9);
    to(stage, { phone: 1, duration: 1.2, ease: 'power2.inOut' }, t0 + 2.6);
    let t = t0 + 3.4;
    if (line) { caption(t, t + lineDur, '', line); sfx(t, 'chord'); t += lineDur; }
    music.stop(t0 + 4.5, 1.4);
    tl.fromTo('#endcard', { autoAlpha: 0, y: 10 }, { autoAlpha: 1, y: 0, duration: 0.9, ease: 'power2.out' }, t + 0.2);
    tl.to({}, { duration: 0.1 }, t + 1.3);
    return t + 1.3;
  }

  const S = {
    tl, cam, stage, glyphs, WORD, PAGE: { w: PAGE_W, h: PAGE_H }, GUARD, REST, FIG_S, gsap,
    to, set, sfx, call, caption, card, shot, lights, shake, music, rise, finale, rock,
    ring: makeRing, drawRing, knight: makeKnight, writeIn, snail: makeSnail, snailIn,
    sprite: makeSprite, tag: makeTag, star: (c = '#f4dc92') => makeSprite(starSVG(c)), spark: () => makeSprite(sparkSVG),
    dust: () => makeSprite(dustHTML), dizzy,
    pose: (k, vars, t) => tl.to(k.s, vars, t),
    spotAt: (t, x, y, z = 70, dur = 1.2) => to(stage.spot, { x, y, z, duration: dur, ease: 'power2.inOut' }, t),
  };
  STORY.build(S);
  const TL_DUR = tl.duration();

  /* ------------------------------------------------------------------ */
  /* Render loop                                                         */
  /* ------------------------------------------------------------------ */
  const VID_DUR = SRC.video ? SRC.video.duration : 0;
  let started = false, phase = 'intro';
  const progressEl = $('#progress');
  function render() {
    const t = tl.time();
    applyCamera(t);
    glyphs.forEach(renderGlyph);
    rings.forEach((R) => renderRing(R, t));
    knights.forEach((k) => k.fig.render(t));
    snails.forEach((sn) => renderSnail(sn, t));
    actors.forEach((a) => renderActor(a, t));
    renderDizzy(t);
    sprites.forEach(renderSprite);
    renderStage();
    const vt = phase === 'video' ? vid.currentTime : phase === 'intro' ? 0 : VID_DUR;
    progressEl.style.transform = `scaleX(${((vt + t) / (VID_DUR + TL_DUR)).toFixed(4)})`;
  }

  /* ------------------------------------------------------------------ */
  /* Flow & controls                                                     */
  /* ------------------------------------------------------------------ */
  const intro = $('#intro'), hud = $('#hud');
  let paused = false, hudTimer = null, scribTimer = null;
  const setPauseIcon = () => $('#pauseIcon').setAttribute('d', paused
    ? 'M4.5 2.8v10.4c0 .5.6.8 1 .5l8-5.2c.4-.3.4-.8 0-1.1l-8-5.2c-.4-.2-1 .1-1 .6z'
    : 'M4 2.5h2.6v11H4zM9.4 2.5H12v11H9.4z');
  const pokeHud = () => { hud.classList.add('show'); clearTimeout(hudTimer); hudTimer = setTimeout(() => { if (phase !== 'intro' && !paused) hud.classList.remove('show'); }, 2600); };

  function playVideo() {
    phase = 'video';
    vid.currentTime = 0;
    const p = vid.play();
    if (p && p.catch) p.catch(() => onVideoEnd());
    clearInterval(scribTimer);
    const [w0, w1] = (SRC.video && SRC.video.write) || [0, 0];
    scribTimer = setInterval(() => {
      if (phase !== 'video' || paused) return;
      const ct = vid.currentTime;
      if (ct > w0 && ct < w1 && Math.random() < 0.6) Sound.play('scribble', 0.25);
    }, 180);
  }
  function onVideoEnd() {
    if (phase !== 'video') return;
    phase = 'story';
    clearInterval(scribTimer);
    tl.play(0);
  }
  function start() {
    if (started) return;
    started = true;
    Sound.init();
    gsap.to(intro, { autoAlpha: 0, duration: 0.5, ease: 'power2.out' });
    $('.poster', phone).style.display = 'none';
    pokeHud();
    if (SRC.video) playVideo();
    else { phase = 'video'; setTimeout(onVideoEnd, 900); }
  }
  function replay() {
    Sound.musicStop(0.2);
    Sound.setDrum(false);
    tl.pause(0);
    paused = false; setPauseIcon();
    Sound.resume();
    if (SRC.video) playVideo();
    else { phase = 'video'; setTimeout(onVideoEnd, 600); }
  }
  function togglePause() {
    if (!started) return start();
    paused = !paused;
    setPauseIcon();
    if (phase === 'video') { if (SRC.video) paused ? vid.pause() : vid.play(); }
    else paused ? tl.pause() : tl.play();
    paused ? Sound.suspend() : Sound.resume();
  }
  if (SRC.video) {
    vid.src = vid.src || SRC.video.src;
    vid.addEventListener('ended', onVideoEnd);
    vid.addEventListener('timeupdate', () => { if (vid.duration && vid.currentTime >= vid.duration - 0.03) onVideoEnd(); });
  } else {
    vid.remove();
    $('.poster', phone).style.display = 'none';
  }
  intro.addEventListener('click', start);
  $('#bPause').addEventListener('click', (e) => { e.stopPropagation(); togglePause(); });
  $('#bReplay').addEventListener('click', (e) => { e.stopPropagation(); replay(); });
  $('#replay2').addEventListener('click', (e) => { e.stopPropagation(); replay(); });
  $('#bSound').addEventListener('click', (e) => {
    e.stopPropagation();
    Sound.setEnabled(!Sound.enabled);
    $('#soundWaves').style.opacity = Sound.enabled ? 1 : 0.15;
  });
  addEventListener('keydown', (e) => {
    if (e.code === 'Space') { e.preventDefault(); togglePause(); }
    if (e.code === 'ArrowRight' && phase === 'story') tl.seek(Math.min(TL_DUR, tl.time() + 5));
    if (e.code === 'ArrowLeft' && phase === 'story') tl.seek(Math.max(0, tl.time() - 5));
  });
  addEventListener('pointermove', () => started && pokeHud());
  addEventListener('pointerdown', () => started && pokeHud());
  addEventListener('resize', () => { layout(); render(); });
  document.addEventListener('visibilitychange', () => {
    if (!started || paused) return;
    if (document.hidden) { Sound.suspend(); if (phase === 'video' && SRC.video) vid.pause(); else tl.pause(); }
    else { Sound.resume(); if (phase === 'video' && SRC.video) vid.play(); else tl.play(); }
  });

  layout();
  tl.progress(1, true).progress(0, true);   // record every tween's start state
  gsap.ticker.add(render);
  render();

  // capture hooks for scripts/shot.js
  window.__seek = (t) => {
    started = true; phase = 'story';
    intro.style.visibility = 'hidden';
    $('.poster', phone).style.display = 'none';
    tl.pause(); tl.seek(t, true);
    render();
  };
  window.__tl = tl;
  window.__duration = TL_DUR;
  window.__vidDur = VID_DUR;
  window.__word = WORD;

  // film clock for scripts/record.js: 0 … VID_DUR is the recording, then the story timeline
  window.__frame = async (t) => {
    document.body.classList.add('recording');
    started = true;
    intro.style.visibility = 'hidden';
    $('.poster', phone).style.display = 'none';
    if (SRC.video && t < VID_DUR) {
      phase = 'video';
      tl.pause(); tl.seek(0, true);
      if (!vid.paused) vid.pause();
      const target = Math.min(t, (vid.duration || VID_DUR) - 0.001);
      if (Math.abs(vid.currentTime - target) > 0.0005) {
        await new Promise((res) => { vid.addEventListener('seeked', res, { once: true }); vid.currentTime = target; });
      }
      render();
    } else window.__seek(t - VID_DUR);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  };

  // the whole soundtrack, rendered offline → base64 16-bit stereo WAV
  window.__renderAudio = async (tail = 2) => {
    const total = VID_DUR + TL_DUR + tail;
    const was = tl.time();
    const buf = await Sound.renderOffline(total, (sim, tick) => {
      let seed = 7;
      const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      const [w0, w1] = (SRC.video && SRC.video.write) || [0, 0];
      for (let t = w0; t < w1; t += 0.18) if (rnd() < 0.6) { sim.t = t; Sound.play('scribble', 0.25); }
      tl.pause(); tl.seek(0, true);
      for (let t = 0; t <= TL_DUR + 1e-6; t += 0.01) { sim.t = VID_DUR + t; tl.seek(t, false); tick(); }
      for (let t = TL_DUR; t < TL_DUR + tail; t += 0.05) { sim.t = VID_DUR + t; tick(); }
      tl.seek(was, true);
    });
    const n = buf.length, L = buf.getChannelData(0), R = buf.getChannelData(1);
    const bytes = new Uint8Array(44 + n * 4), dv = new DataView(bytes.buffer);
    const str = (o, s) => { for (let i = 0; i < s.length; i++) bytes[o + i] = s.charCodeAt(i); };
    str(0, 'RIFF'); dv.setUint32(4, 36 + n * 4, true); str(8, 'WAVEfmt '); dv.setUint32(16, 16, true);
    dv.setUint16(20, 1, true); dv.setUint16(22, 2, true); dv.setUint32(24, buf.sampleRate, true);
    dv.setUint32(28, buf.sampleRate * 4, true); dv.setUint16(32, 4, true); dv.setUint16(34, 16, true);
    str(36, 'data'); dv.setUint32(40, n * 4, true);
    for (let i = 0; i < n; i++) {
      dv.setInt16(44 + i * 4, Math.max(-1, Math.min(1, L[i])) * 32767, true);
      dv.setInt16(46 + i * 4, Math.max(-1, Math.min(1, R[i])) * 32767, true);
    }
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  };
})();
