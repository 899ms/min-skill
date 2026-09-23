/* examples/opus5 — the original: handwritten "Opus5" stands up, Dario vs Altman, refereed by a snail.
 * Same choreography as engine/story.template.js; only CAST / LINES / meta differ.
 *
 * story.js — the only file you normally rewrite.
 *
 * engine.js calls STORY.build(S) once; everything you schedule goes on ONE paused GSAP
 * timeline (S.tl), so any moment can be previewed with window.__seek(t).
 * Full toolkit reference: references/story-api.md.
 *
 * This template is a complete story ("两位骑士为这页纸打一架", ~90 s). To make a new one,
 * change CAST / LINES first; only touch the choreography if the plot itself changes.
 * Every position is relative to the ring, which is placed relative to the handwriting,
 * so the same code works for any word.
 */
window.STORY = (() => {
  const CAST = {
    left: {
      banner: 'Dario', face: 'calm',
      tunic: '#c8694a', tunicDk: '#8e3f2a', hoseA: '#efe6d2', hoseB: '#2f2b33', glove: '#2d4f9a',
      hair: 'curly', hairC: '#3a2a22', glasses: true, emblem: 'star', book: '宪法',
      brows: 'M66.5 38.2 Q70 36.4 74 37.6 M78.8 37.2 Q81.4 36 83.6 37.4', eyeR: 1.7,
    },
    right: {
      banner: 'Altman', face: 'grin',
      tunic: '#2f6b63', tunicDk: '#1c4640', hoseA: '#efe6d2', hoseB: '#b8402c', glove: '#c4402c',
      hair: 'short', hairC: '#8b6a4b', eyeR: 2.05, emblem: 'cross', gloveLabel: '$1T',
      brows: 'M66.5 36.6 Q70 33.8 74 35.2 M78.6 34.8 Q81.4 33.2 84 35',
    },
  };

  const LINES = {
    prologue: ['序章 · Prologus', '公元二〇二六年，纸上王国。'],
    arrive: '字刚站稳，就来了两位骑士。',
    left: ['左边这位，达里奥。', 'Anthropic 领主 · 随身带着一本《宪法》'],
    right: ['右边这位，奥特曼。', 'OpenAI 伯爵 · 走到哪儿都要开发布会'],
    claim: '两人异口同声：「这一页，归我。」',
    referee: ['裁判，是一只蜗牛。', '中世纪手抄本的老规矩：页边总少不了一只蜗牛。'],
    r1: ['奥特曼先出手——', '一记「万亿美元算力」重拳。', '达里奥只是低了一下头。', '拳风太大，把 O 吹得晃了三晃。'],
    r2: ['奥特曼换了打法：连环发布。', '达里奥翻开随身的小书——《宪法》。', '每一拳，都被原则挡了回去。'],
    tags: ['新模型！', '新硬件！', '新浏览器！', '新功能！', '又一场发布会！', '敬请期待！', '新模型！！', 'Coming soon', '再来一个！', '下周见！'],
    r3: [['达里奥终于出手。', '他向身后的「5」，借了一点光。'], '只出了一拳。', '一拳，把奥特曼打回了纸上。'],
    count: ['蜗牛开始读秒——', '它数得……非常……慢。'],
    countSigns: ['一', '二', '三'],
    help: '还没数到三，达里奥先把对手扶了起来。',
    ask: '所以，谁赢了？',
    end: '答案，一直写在纸上。',
  };

  return {
    meta: { title: 'Opus 5', tagline: '一行字，站起来之后的故事', hero: ['Opus', '5'], heroSub: '站起来了。', docTitle: 'Opus 5 · 站起来了' },

    build(S) {
      const { WORD, glyphs, GUARD } = S;
      const first = glyphs[0], last = glyphs[glyphs.length - 1];
      const R = S.ring({ cx: WORD.cx });
      const cx = R.cx, FY = R.y0 + 120;                 // the fighters' line
      Object.assign(S.stage.spot, { x: cx, y: FY, z: 70 });

      const L = S.knight(Object.assign({ x: cx - 106, y: FY, mirror: false }, CAST.left));
      const Rv = S.knight(Object.assign({ x: cx + 106, y: FY, mirror: true }, CAST.right));
      const snail = S.snail({ x: R.x0 - 46, y: FY + 96 });
      const pose = S.pose, to = S.to, set = S.set, sfx = S.sfx, cap = S.caption;
      // long lines of writing: pull the camera back a little so the backdrop isn't just two giant strokes
      const k = Math.min(1.45, Math.sqrt(Math.max(1, WORD.w / 520)));
      const shot = (t, v, dur, ease) => S.shot(t, Object.assign({}, v, v.span ? { span: v.span * k, pspan: v.pspan * Math.min(1.3, k) } : {}), dur, ease);

      /* 0 · the ink stands up */
      S.rise(0);

      /* 1 · prologue */
      S.music.start(8.8, 0.5);
      shot(9.0, { tilt: 53, x: cx, y: R.y0 + 48, z: 50, span: 860, pspan: 610, yaw: 4, oy: -0.02 }, 2.6);
      cap(9.7, 13.1, LINES.prologue[0], LINES.prologue[1]);
      S.drawRing(R, 10.0);
      cap(13.3, 16.3, '', LINES.arrive);
      S.writeIn(L, 14.2);
      cap(16.5, 19.6, CAST.left.banner, LINES.left[0], LINES.left[1]);
      to(L.s, { idle: 0.6, duration: 1 }, 16.4);
      S.writeIn(Rv, 17.2);
      cap(19.8, 22.9, CAST.right.banner, LINES.right[0], LINES.right[1]);
      to(Rv.s, { idle: 0.6, duration: 1 }, 19.4);

      shot(22.4, { tilt: 73, span: 700, pspan: 430, y: FY - 22, z: 100, yaw: 0, x: cx + 4, oy: -0.035 }, 2.4);
      cap(23.1, 26.4, '', LINES.claim);
      to(L.a, { x: cx - 70, duration: 1.1, ease: 'power2.inOut' }, 23.3);
      to(Rv.a, { x: cx + 70, duration: 1.1, ease: 'power2.inOut' }, 23.5);
      to(L.s, { idle: 1, duration: 0.6 }, 23.3);
      to(Rv.s, { idle: 1, duration: 0.6 }, 23.5);
      S.snailIn(snail, 24.4);
      to(snail.a, { x: cx - 66, duration: 9.5, ease: 'none' }, 25.4);
      cap(26.6, 30.2, '', LINES.referee[0], LINES.referee[1]);

      /* 2 · round one: the big swing */
      S.lights(30.4, 1);
      S.music.drum(30.4, true);
      S.card(31.0, 'I', 'ROUND ONE', '第一回合');
      to(L.a, { x: cx - 46, duration: 0.9, ease: 'power2.inOut' }, 33.0);
      to(Rv.a, { x: cx + 46, duration: 0.9, ease: 'power2.inOut' }, 33.1);
      cap(33.5, 35.6, 'Round I', LINES.r1[0]);
      pose(Rv, { fx: 62, fy: 78, lean: -10, head: -4, duration: 0.8, ease: 'power2.inOut' }, 34.1);
      pose(Rv, { gF: 3.3, label: 1, duration: 1.3, ease: 'elastic.out(1, 0.55)' }, 34.5);
      sfx(34.5, 'inflate');
      set(L.s, { face: 'firm' }, 34.6);
      cap(35.7, 38.0, 'Round I', LINES.r1[1]);
      to(Rv.a, { x: cx + 4, duration: 0.28, ease: 'power3.in' }, 37.2);
      pose(Rv, { fx: 116, fy: 64, lean: 12, head: 6, duration: 0.26, ease: 'power3.in' }, 37.2);
      pose(L, { by: 17, lean: -12, head: -14, idle: 0, duration: 0.2, ease: 'power3.out' }, 37.2);
      sfx(37.25, 'whiff');
      to(Rv.a, { spin: 360, duration: 0.75, ease: 'power2.out' }, 37.45);
      to(Rv.a, { x: cx - 10, duration: 0.7, ease: 'power2.out' }, 37.45);
      set(Rv.s, { face: 'ouch' }, 37.5);
      pose(Rv, { gF: 1, label: 0, fx: GUARD.fx, fy: GUARD.fy, lean: 0, head: 0, duration: 0.7, ease: 'power2.inOut' }, 38.1);
      set(Rv.a, { spin: 0 }, 38.21);
      pose(L, { by: 0, lean: 0, head: 0, idle: 1, duration: 0.6, ease: 'power2.inOut' }, 38.5);
      set(L.s, { face: 'smile' }, 38.6);
      cap(38.1, 40.3, 'Round I', LINES.r1[2]);
      S.rock(first, 37.5);
      sfx(37.55, 'whoosh', 0.6);
      cap(40.4, 43.4, 'Round I', LINES.r1[3]);
      to(Rv.a, { x: cx + 46, duration: 0.9, ease: 'power2.inOut' }, 40.2);
      set(Rv.s, { face: 'grin' }, 40.6);

      /* 3 · round two: a flurry, blocked by a little book */
      S.card(43.8, 'II', 'ROUND TWO', '第二回合');
      cap(45.8, 48.6, 'Round II', LINES.r2[0]);
      pose(L, { book: 1, fx: 91, fy: 58, face: 'calm', duration: 0.5, ease: 'back.out(1.6)' }, 46.1);
      sfx(46.1, 'pop');
      LINES.tags.forEach((txt, i) => {
        const t = 46.5 + i * 0.46;
        const tg = S.tag(txt, i), hs = S.star();
        pose(Rv, { fx: 112, fy: 62 + (i % 3) * 3, lean: 7, duration: 0.11, ease: 'power3.in' }, t);
        pose(Rv, { fx: GUARD.fx, fy: GUARD.fy, lean: 0, duration: 0.22, ease: 'power2.out' }, t + 0.13);
        pose(L, { bx: -3, duration: 0.08, ease: 'power2.out' }, t + 0.1);
        pose(L, { bx: 0, duration: 0.25, ease: 'power2.inOut' }, t + 0.18);
        sfx(t + 0.1, 'ting');
        set(hs, { a: 1, sc: 0.2, rot: i * 40, x: cx - 10, y: FY + 9, h: 84 }, t + 0.1);
        to(hs, { sc: 1.1, rot: i * 40 + 30, duration: 0.25, ease: 'power2.out' }, t + 0.1);
        to(hs, { a: 0, duration: 0.2 }, t + 0.3);
        const side = i % 2 ? 1 : -1;
        set(tg, { a: 0, x: cx + 4, y: FY + 9, h: 116, sc: 0.5, rot: 0 }, t + 0.12);
        to(tg, { a: 1, sc: 1, duration: 0.25, ease: 'back.out(2)' }, t + 0.12);
        to(tg, { x: cx + 4 + side * (34 + (i * 17) % 40), h: 146 + (i * 23) % 40, rot: side * 8, duration: 1.5, ease: 'power1.out' }, t + 0.12);
        to(tg, { a: 0, duration: 0.5, ease: 'power1.in' }, t + 1.1);
      });
      cap(48.8, 51.8, 'Round II', LINES.r2[1]);
      cap(52.0, 55.0, 'Round II', LINES.r2[2]);
      pose(Rv, { lean: 16, by: 7, face: 'tired', sweat: 1, idleRate: 0.55, fx: 96, fy: 94, gbx: 84, gby: 100, duration: 0.9, ease: 'power2.inOut' }, 51.4);
      pose(L, { book: 0, fx: GUARD.fx, fy: GUARD.fy, duration: 0.6, ease: 'power2.inOut' }, 53.2);

      /* 4 · round three: light borrowed from the last glyph, one punch */
      S.card(55.4, 'III', 'ROUND THREE', '第三回合');
      pose(Rv, { lean: 0, by: 0, sweat: 0.4, idleRate: 1, fx: GUARD.fx, fy: GUARD.fy, gbx: GUARD.gbx, gby: GUARD.gby, face: 'grin', duration: 0.8, ease: 'power2.inOut' }, 56.2);
      cap(57.4, 60.6, 'Round III', LINES.r3[0][0], LINES.r3[0][1]);
      shot(57.3, { x: cx + (last.cx - cx) * 0.3, yaw: -10, tilt: 68, span: 640, pspan: 500, y: FY - 52, z: 90 }, 1.8);
      to(last, { glow: 1, duration: 1.0, ease: 'power2.inOut' }, 57.9);
      sfx(57.9, 'sparkle');
      const sp0 = { x: last.cx, y: last.pivot + 10, h: (last.pivot - last.top) * 0.55 }, sp1 = { x: cx - 16, y: FY + 9, h: 78 };
      [S.spark(), ...Array.from({ length: 7 }, () => S.spark())].forEach((s, i) => {
        const d = i ? 0.07 * i : 0;
        set(s, { a: i ? 0.7 - (i - 1) * 0.08 : 1, x: sp0.x, y: sp0.y, h: sp0.h, sc: i ? 1.6 - (i - 1) * 0.16 : 0.4 }, 58.9 + d);
        if (!i) to(s, { sc: 2.4, duration: 0.3 }, 58.9);
        to(s, { x: sp1.x, y: sp1.y, duration: 1.1, ease: 'power2.inOut' }, 59.0 + d);
        to(s, { h: sp0.h + 60, duration: 0.55, ease: 'power2.out' }, 59.0 + d);
        to(s, { h: sp1.h, duration: 0.55, ease: 'power2.in' }, 59.55 + d);
        to(s, i ? { a: 0, duration: 0.2 } : { a: 0, sc: 3.2, duration: 0.3 }, 60.05 + d);
      });
      sfx(59.0, 'whoosh', 1.2);
      pose(L, { glowF: 1, face: 'firm', duration: 0.4 }, 60.0);
      sfx(60.05, 'ting');
      to(last, { glow: 0.25, duration: 1.2 }, 60.4);
      cap(60.8, 62.9, 'Round III', LINES.r3[1]);
      shot(60.4, { x: cx + 8, span: 430, pspan: 300, tilt: 74, yaw: -12, y: FY, z: 70, oy: 0.02 }, 1.7);
      pose(L, { by: 11, lean: -7, fx: 86, fy: 106, idle: 0, duration: 0.4, ease: 'power2.inOut' }, 61.8);
      to(L.a, { x: cx - 6, duration: 0.25, ease: 'power3.in' }, 62.2);
      pose(L, { by: -5, lean: 13, fx: 106, fy: 34, duration: 0.17, ease: 'power4.out' }, 62.25);
      sfx(62.36, 'punch', true);
      S.music.level(62.36, 0, 0.08);
      S.shake(62.36, 1, 0.6);
      Array.from({ length: 7 }, (_, i) => S.star(i % 2 ? '#f2d27a' : '#fff4d6')).forEach((s, i) => {
        const ang = (i / 7) * Math.PI * 2 + 0.3;
        set(s, { a: 1, x: cx + 26, y: FY + 9, h: 92, sc: 0.3, rot: i * 50 }, 62.36);
        to(s, { x: cx + 26 + Math.cos(ang) * 44, h: 92 + Math.sin(ang) * 36, sc: 1, rot: i * 50 + 90, duration: 0.6, ease: 'power3.out' }, 62.36);
        to(s, { a: 0, sc: 0.6, duration: 0.35 }, 62.8);
      });
      set(Rv.s, { eyes: 'x', face: 'ouch' }, 62.37);
      pose(Rv, { idle: 0, head: 22, lean: -18, duration: 0.12 }, 62.37);
      to(Rv.a, { lift: 82, duration: 0.95, ease: 'power2.out' }, 62.38);
      to(Rv.a, { lift: 0, duration: 0.55, ease: 'power2.in' }, 63.33);
      to(Rv.a, { spin: -720, duration: 1.45, ease: 'power1.inOut' }, 62.38);
      to(Rv.a, { x: cx + 40, duration: 1.5, ease: 'power1.out' }, 62.38);
      to(Rv.a, { rx: 0, duration: 0.42, ease: 'power2.in' }, 63.46);       // folds flat onto the page…
      to(Rv.a, { tip: 68, duration: 0.5, ease: 'power2.inOut' }, 63.4);    // …sprawled sideways so it reads as "down"
      to(Rv.a, { rx: -13, duration: 0.14, ease: 'power2.out' }, 63.88);
      to(Rv.a, { rx: 0, duration: 0.3, ease: 'bounce.out' }, 64.02);
      set(Rv.a, { spin: 0 }, 63.84);
      sfx(63.88, 'flop');
      S.shake(63.88, 0.7, 0.5);
      Array.from({ length: 6 }, () => S.dust()).forEach((d, i) => {
        set(d, { a: 0.9, x: cx + 64 + i * 14, y: FY - 10 - (i % 3) * 18, h: 4, sc: 0.4 }, 63.88);
        to(d, { x: cx + 54 + i * 22, h: 16 + (i % 2) * 10, sc: 2.2, a: 0, duration: 0.9, ease: 'power2.out' }, 63.88);
      });
      pose(L, { by: 0, lean: 0, fx: GUARD.fx, fy: GUARD.fy, idle: 0.7, glowF: 0, duration: 0.8, ease: 'power2.inOut' }, 62.8);
      to(last, { glow: 0, duration: 1.0 }, 63.0);
      // look down on the page: the flattened knight is a drawing again
      shot(64.1, { tilt: 34, span: 560, pspan: 380, x: cx + 64, y: FY - 22, z: 0, yaw: 0, oy: -0.02 }, 2.2, 'power3.inOut');
      Object.assign(S.dizzy, { x: cx + 124, y: FY - 34 });
      to(S.dizzy, { a: 1, duration: 0.5 }, 64.3);
      to(S.dizzy, { a: 0, duration: 0.4 }, 75.2);
      cap(64.4, 67.8, '', LINES.r3[2]);

      /* 5 · the (very slow) count */
      to(snail.a, { x: cx + 142, y: FY + 40, duration: 3.6, ease: 'power1.inOut' }, 64.8);
      to(snail.state, { sign: 1, duration: 0.4, ease: 'back.out(2)' }, 67.9);
      snail.signs.push([0, LINES.countSigns[0]], [72.85, LINES.countSigns[1]], [77.7, LINES.countSigns[2]]);
      sfx(68.0, 'tick'); sfx(72.9, 'tick'); sfx(77.75, 'tick');
      cap(68.0, 70.5, '', LINES.count[0]);
      cap(70.7, 73.9, '', LINES.count[1]);
      S.music.start(71.0, 0.28);
      S.music.drum(71.0, false);

      /* 6 · a hand up */
      shot(73.2, { tilt: 68, span: 540, pspan: 390, x: cx + 54, y: FY, z: 60, yaw: 3, oy: -0.03 }, 2.4);
      to(L.a, { x: cx + 2, duration: 1.4, ease: 'power2.inOut' }, 73.2);
      cap(74.2, 78.0, '', LINES.help);
      set(L.s, { face: 'smile' }, 74.7);
      pose(L, { lean: 18, fx: 104, fy: 116, idle: 0, duration: 0.55, ease: 'power2.inOut' }, 74.7);
      to(Rv.a, { rx: -90, duration: 0.95, ease: 'back.out(1.7)' }, 75.3);
      to(Rv.a, { tip: 0, duration: 0.7, ease: 'power2.out' }, 75.3);
      sfx(75.3, 'pop');
      set(Rv.s, { eyes: 'open', face: 'tired' }, 75.6);
      pose(Rv, { head: 0, lean: 0, sweat: 0.6, duration: 0.6 }, 75.6);
      pose(L, { lean: 0, fx: GUARD.fx, fy: GUARD.fy, duration: 0.6, ease: 'power2.inOut' }, 75.6);
      to(Rv.a, { x: cx + 76, duration: 0.6, ease: 'power2.out' }, 75.6);
      pose(L, { fx: 110, fy: 70, duration: 0.3, ease: 'power2.out' }, 76.7);
      set(Rv.s, { face: 'smile' }, 76.7);
      pose(Rv, { fx: 110, fy: 70, sweat: 0, duration: 0.3, ease: 'power2.out' }, 76.7);
      sfx(76.95, 'sparkle');
      const bump = S.star();
      set(bump, { a: 1, x: cx + 39, y: FY + 9, h: 78, sc: 0.3, rot: 0 }, 76.98);
      to(bump, { sc: 1.4, rot: 60, duration: 0.4, ease: 'power2.out' }, 76.98);
      to(bump, { a: 0, duration: 0.3 }, 77.4);
      pose(L, { fx: GUARD.fx, fy: GUARD.fy, idle: 0.5, duration: 0.5 }, 77.5);
      pose(Rv, { fx: GUARD.fx, fy: GUARD.fy, idle: 0.5, duration: 0.5 }, 77.5);

      /* 7 · back onto the page */
      S.lights(78.2, 0, 1.4);
      S.music.level(78.2, 0.45, 0.8);
      cap(78.5, 81.2, '', LINES.ask);
      // walk to the front of the ring first, so the folded doodles don't land on the lettering
      to(L.a, { x: cx - 70, y: FY + 80, duration: 1.2, ease: 'power2.inOut' }, 78.6);
      to(Rv.a, { x: cx + 70, y: FY + 80, duration: 1.2, ease: 'power2.inOut' }, 78.7);
      to(snail.a, { x: cx - 14, y: FY + 104, duration: 2.2, ease: 'power1.inOut' }, 78.6);
      pose(L, { lean: 22, head: 10, idle: 0, duration: 0.5, ease: 'power2.inOut' }, 79.8);
      pose(L, { lean: 0, head: 0, duration: 0.5, ease: 'power2.inOut' }, 80.4);
      pose(Rv, { lean: 22, head: 10, idle: 0, duration: 0.5, ease: 'power2.inOut' }, 79.95);
      pose(Rv, { lean: 0, head: 0, duration: 0.5, ease: 'power2.inOut' }, 80.55);
      to(snail.state, { sign: 0, duration: 0.4 }, 80.4);
      S.finale(81.0, LINES.end);
    },
  };
})();
