# Story API — the `S` toolkit

`story.js` defines `window.STORY = { meta, build(S) }`. The engine builds the stage, calls
`build(S)` once, and then plays `S.tl`. Everything below schedules onto that one timeline, at an
absolute time `t` in seconds (0 = the moment the recording ends).

```js
window.STORY = {
  meta: { title: 'Opus 5', tagline: '一行字，站起来之后的故事', hero: ['Opus', '5'], heroSub: '站起来了。',
          docTitle: 'Opus 5 · 站起来了', fin: 'Finis.', replay: '再看一遍', hint: '轻点开始 · 建议开声音' },
  build(S) {
    S.rise(0);                 // 0–9 s: hand-over + letters stand up + hero title
    // … your story …
    S.finale(81, '答案，一直写在纸上。');
  },
};
```

## Coordinates

Page units. The page is the source frame rescaled so the written word is ~233 units tall.
`x` → right, `y` → down the page (towards the viewer once the camera tilts), `h`/`z` → up off the
paper. Useful anchors:

| | |
|---|---|
| `S.WORD` | `{x0, x1, cx, w, top, base, h}` — the handwriting's box; `base` = lowest hinge line |
| `S.glyphs[i]` | each standing piece, left → right: `{cx, top, pivot, rx, depth, face, wob, glow, spin}` |
| `S.PAGE` | `{w, h}` |
| ring from `S.ring()` | `{x0, x1, y0, y1, cx, cy}`; the template puts the fighters' line at `R.y0 + 120` |

A knight is ~130 units tall (`S.FIG_S` = 0.72 × a 180-unit rig). Two fighters trade punches at
~90 units apart; a straight punch reaches ~37 units in front of the body.

## Timeline primitives

| call | does |
|---|---|
| `S.to(obj, vars, t)` / `S.set(obj, vars, t)` | GSAP tween / instant set on the story timeline |
| `S.pose(knight, vars, t)` | tween a knight's pose state (see below) |
| `S.sfx(t, name, arg?)` | play a synthesized sound |
| `S.call(t, fn)` | run a function when the playhead passes `t` (skipped when seeking) |
| `S.caption(t0, t1, eyebrow, line, note?)` | bottom caption; line reveals per character |
| `S.card(t, 'II', 'ROUND TWO', '第二回合')` | full-screen chapter card with a bell (~2.2 s) |
| `S.shot(t, camVars, dur=2.2, ease)` | camera move (below) |
| `S.lights(t, 0..1, dur)` | spotlight on the stage; captions switch to light-on-dark |
| `S.spotAt(t, x, y, z)` | move the spotlight pool (default: the fighters' line) |
| `S.shake(t, amount, dur)` | camera shake |
| `S.music.start(t, level)` `.level(t, v)` `.drum(t, on)` `.stop(t)` | lute tune (D dorian), optional frame drum |
| `S.rise(t0)` → `t0 + 9` | the opening: video → page → letters stand up → hero title |
| `S.finale(t0, line?)` → end | lights up, fold everything, device back, last line, "Finis." card |

## Camera

`S.cam` fields: `x, y, z` (focus point; `z` = height above the paper), `tilt` (0 = straight down,
90 = eye level on the paper; 50–74 for stage shots), `yaw` (orbit), `span` (page units across a
landscape frame — smaller is closer), `pspan` (the same for portrait phones, usually ~0.6–0.7 ×
span), `oy` (shift the frame, fraction of viewport height), `fit` (0 = phone scale, 1 = scene).

Shots that worked: wide stage `tilt 73, span 700, pspan 430, z 100`; close-up on an exchange
`tilt 74, span 430, pspan 300, z 70`; looking down on something lying on the paper
`tilt 34, span 560`; drawing on the paper `tilt 53`. Keep the action above the bottom quarter —
captions live there.

## Props & actors

```js
const R = S.ring({ cx: S.WORD.cx, y0: S.WORD.base + 76, w: 360, d: 240, left: '#c4633f', right: '#2f6b63' });
S.drawRing(R, t);                      // canvas, inked border, posts pop up, ropes draw  (≈2.8 s)

const k = S.knight({ x, y, mirror: false, banner: 'Dario', ...look });
S.writeIn(k, t);                       // drawn in ink → coloured → pops up → banner  (≈2.3 s)
k.a                                    // actor: x, y, rx (0 flat … -90 standing), lift, spin, tip, a (opacity), bannerK
k.s                                    // pose state (tween with S.pose)
k.point(x, y)                          // rig point → {dx, h} offset from the actor's feet (for sparks on a glove)

const sn = S.snail({ x, y }); S.snailIn(sn, t);
sn.a (actor) · sn.state {crawl, sign} · sn.signs.push([t, '一'], [t2, '二'])   // placard text over time
```

**Knight look** (all optional): `tunic tunicDk sleeve sleeveDk hoseA hoseB shoe skin` colours ·
`hair: curly|short|long|bald` + `hairC` · `hat: crown|helmet|beret` (+ `hatC`) · `beard` ·
`glasses` · `hands: 'hands'` (bare hands, arms hang at rest) or boxing gloves (default) + `glove` colour ·
`gloveLabel: '$1T'` (appears with `label: 1`) · `book: '宪法'` (1–3 chars, shown with `book: 1`,
`bookC`) · `emblem: star|cross|heart|moon` or an SVG path · `face` · `eyeR` · `brows` (path).

**Pose state** `k.s` (svg units of a 120×180 rig facing right; mirrored figures are handled):
`fx, fy` front hand target · `gbx, gby` back hand · `bx, by` body offset (by > 0 crouches) ·
`lean` (deg, + forward) · `head` (deg) · `idle` 0–1 boxing bob, `idleRate` · `gF` front glove
scale (inflate) · `glowF` · `book` · `sweat` · `label` · `face` · `eyes` · `draw`/`fill` (write-in).
Presets: `S.GUARD = {fx:93, fy:66, gbx:81, gby:73}`, `S.REST` (arms down).

Moves that read well: jab `fx 112` for 0.11 s and back · uppercut crouch `by 11, fx 86, fy 106`
then `by -5, lean 13, fx 106, fy 34` in 0.17 s · duck `by 17, lean -12` · wind-up `fx 62, lean -10`
· bow `lean 22, head 10` · reach down `lean 18, fx 104, fy 116` · glove bump both `fx 110, fy 70`.
Actor-level: spin `spin: 360`, fly `lift`, fold flat `rx: 0` (+ `tip: 68` to sprawl), stand `rx: -90`.

**Glyphs**: `wob` (in-plane rock, use `S.rock(g, t)`), `glow` 0–1 (gold face + light through the
dark), `spin`, `rx` (0 lies down).

## Sprites

`S.star(color?)`, `S.spark()`, `S.dust()`, `S.tag('新模型！', i)` (parchment ticket),
`S.sprite(html | element, flat?)`. Each has `x, y, h, a, sc, rot`; standing sprites face the
camera, `flat` ones lie on the paper. They start hidden (`a: 0`): `S.set(s, {x, y, h, a: 1}, t)`,
then tween. `S.dizzy` = `{a, x, y, r}` — four stars circling on the paper.

## Sounds (`S.sfx(t, name)`)

`whoosh(scale)` `thock` `pop` `scribble(seconds)` `bell` `punch(heavy)` `whiff` `inflate` `ting`
`tick` `sparkle` `flop` `chord` `boing`. All synthesized in WebAudio; nothing to load.

## State you can tween directly

`S.stage`: `lights` (0–1), `spot {x,y,z}`, `floor`, `sky`, `plate`, `phone`, `video`,
`pscale`/`py` (device size/offset when the camera is back at phone scale). `S.rise` and
`S.finale` drive these; you rarely need to.
