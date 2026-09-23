---
name: handwriting-stand-up
description: Turn a screen recording of handwriting (or a photo of handwritten text) into a single-file HTML "continuation" — the recording plays, the ink lifts off the page as solid 3D letters, a short animated story plays out in front of them (medieval-marginalia characters on a pop-up paper stage, captions, synthesized sound), and everything lies back down on the page at the end. Use when the user sends a video or photo of handwriting and asks to make it 立起来 / 站起来讲故事 / 做成 HTML 延续 / 让手写字变 3D / animate handwritten words into a story, or asks for a new story on an existing stand-up project.
version: 0.1.0
---

# Handwriting Stand-Up

Input: a phone screen recording of someone writing a word (the Notes-app kind), or a photo of
handwriting. Output: one self-contained `.html` (video, fonts, images inlined; ~0.5 MB) that

1. plays the recording inside an iPhone mock (photos: a paper card),
2. hands over to a pixel-aligned vector copy of the last frame, dissolves the UI, and stands the
   written pieces up one by one as thick black ink on an endless paper stage,
3. tells a ~90 s story in front of them, written in `story.js`,
4. folds everything back onto the page and returns to the phone — the note now has the story's
   doodles in its margin.

Everything runs on one paused GSAP timeline, so any moment can be screenshotted by seeking. That
is what makes iterating cheap: change a number, re-shoot three frames, look.

```
input.mp4 / .jpg ──prepare.py──▶ project/                     ──shot.js───▶ shots/*.png (check)
                                  index.html                   ──build.py──▶ dist/<name>.html
                                                               ──record.js─▶ dist/<name>.mp4 (optional)
                                  assets/source.js   ← traced glyphs, pivots, page size, video
                                  assets/story.js    ← you write this
                                  assets/engine.js   ← stage, camera, characters, audio
                                  trace_check.png    ← look at this before anything else
```

## Step 1 — Prepare and check the trace

```bash
H=~/.claude/skills/minli-skill/skills/handwriting-stand-up     # wherever this skill lives
python3 $H/scripts/prepare.py <recording.mp4|photo.jpg> --out <project-dir>
```

Then **open `<project-dir>/trace_check.png`**. It shows each piece in its own colour with its
index, and a dashed line where that piece is hinged to the paper. Get this right before writing
any story — every later step depends on it.

- **Pieces** are what stand up one at a time. Latin: roughly one per letter or per connected
  cursive run (`Opus5` → `O` / `pus` / `5`). CJK: one per character (radicals like 亻 are merged
  automatically). Wrong split → `--cuts x1,x2,…` (source px, split lines between pieces).
  Too many tiny pieces → `--max-pieces 5` or `--merge-gap <px>`. Keep it ≤ 8: each piece is 18 SVG layers.
- **Pivots** (dashed lines) are the hinge. They should sit on the baseline of each piece; a
  descender (the stem of p/g/y) below the line is intended — it gets planted into the paper.
  Wrong → `--pivots y1,y2,…` (one per piece, source px).
- **UI picked up as ink** (buttons, status bar) → `--roi x,y,w,h`. The default already skips the
  top/bottom 11 % of portrait recordings and drops anything already dark in the first frame.
- **Nothing / too much found** → `--thresh N` (ink = gray < N). Assumes dark ink on light paper.

Re-running `prepare.py` keeps an existing `assets/story.js` (`--fresh-story` to reset it).
`--engine-only --out <dir>` refreshes just the engine files in a project.

## Step 2 — Write the story

`assets/story.js` starts as the template: a complete ~90 s boxing tale ("两位骑士为这页纸打一架")
that already works on any traced word, because every position is relative to the handwriting
(`S.WORD`) and to the ring placed in front of it.

Ask what story they want if they didn't say. Then, cheapest first:

1. **Recast** — edit `CAST` (names, colours, hair, props) and `LINES` (every caption) and `meta`
   (intro title, hero line). This alone makes it a different story. The worked example
   `examples/opus5/story.js` is exactly this: Dario vs Altman, "$1T" glove, a book titled 宪法.
2. **Re-plot** — keep the machinery, rewrite beats in `build(S)`. Read
   `references/story-api.md` first; it lists every tool (`S.knight`, `S.writeIn`, `S.shot`,
   `S.caption`, `S.card`, `S.lights`, `S.rock`, `S.tag`, `S.finale`, …) and the poses that read well.

Story craft that held up:

- One idea per caption, ≤ 18 CJK chars, on screen 2.2–3.5 s. Say what the picture can't
  (motive, irony); don't narrate what is visible.
- Structure: rise (engine, 0–9 s) → setup (who, what's at stake) → 3 escalating beats → a turn
  that uses the handwriting itself (a letter wobbles, the last glyph lends its light) → a quiet
  resolution → `S.finale()` with a last line that points back at the page.
- Tie the plot to "standing up": knocked out = folded flat back onto the paper; helped up =
  stands again; the end = everything lies down and becomes doodles.
- Real people are fine as affectionate parody; keep it good-natured, nobody humiliated, and
  let the loser be helped up.

## Step 3 — Preview by seeking, not by watching

```bash
cd $H/scripts && npm i playwright-core          # once
node $H/scripts/shot.js <project-dir> --times 6,17,24,34,37.4,48,59,62.5,66,77,90
node $H/scripts/shot.js <project-dir> --times 6,24,62.5,90 --size 390x844 --dpr 2   # phone
node $H/scripts/shot.js <project-dir> --live 15                                    # real-time: errors + frame pacing
```

It writes `shots/t<time>_<size>.png` plus a contact sheet `shots/sheet_<size>.png` — look at the
sheet. It exits non-zero and prints any page error. Check both a landscape and a portrait size:
portrait uses each shot's `pspan` and needs its own framing.

What to look for: captions sitting on the ring's front rope; faces too small to read (tighten
`span`); letters cut off at the top in wide shots (raise `span` or `oy`); a pose that reads wrong
from the camera angle (see the "flat reads as upright" note below).

## Step 4 — Build

```bash
python3 $H/scripts/build.py <project-dir>          # → <project-dir>/dist/<project-name>.html
```

Fetches Noto Serif SC / Cormorant Garamond / UnifrakturMaguntia from Google Fonts **subset to the
characters the story uses** and inlines everything. Offline → `--no-fonts` (system fonts).
The file opens from disk, in WeChat, or on any static host.

## Step 5 (optional) — Export an MP4

```bash
node $H/scripts/record.js <project-dir> --out film_16x9.mp4                            # 1920×1080
node $H/scripts/record.js <project-dir> --size 540x960 --dpr 2 --out film_9x16.mp4      # 1080×1920, for phones
```

Renders frame by frame by seeking (recording first, then the story; no dropped frames), renders the
synthesized soundtrack offline with the same timeline calls, and muxes both. `--from/--to` for a
slice. ~0.1 s per 1080p frame (~5 min for the 100 s film) on Apple silicon with Chrome for Testing
and GPU flags; run sizes one after another — two at once starve each other. Layout follows the
viewport, so pick the CSS size the audience will see (`540x960 --dpr 2` looks like a phone).

## Things that will bite you

**Every animation must live on `S.tl`.** A bare `gsap.to()` or `setTimeout` breaks seeking,
replay and the screenshot tool. Randomness too: derive it from `t` (the engine's idle bob, flag
flutter and blinks are all functions of timeline time).

**`fromTo` values that only appear in the "from" object don't survive seeking.** Position a
sprite with `S.set(obj, {x, y, h, a: 0}, t)` then `S.to(obj, {a: 1}, t)`. Same for DOM you
tween more than once — tween a plain state object and apply it in render, like `stage.rc`.

**Switch expressions with `S.set`, not in a long tween.** `S.set(k.s, {face: 'ouch'}, t)`.
Faces: calm smile grin firm ouch tired sad; eyes: open x shut.

**A card lying flat still reads as a standing figure from a low camera.** Folding a knight onto
the paper (`rx: 0`) seen from tilt 70° just looks shorter. For "knocked flat", also rotate it in
the paper plane (`tip: 68`) and crane the camera up (`tilt ≈ 34`); for anything in between, add
dizzy stars.

**Walk the actors to the front of the ring before `S.finale()`.** Folded doodles extend *behind*
their feet, toward the lettering; if they stand near the back they land on the letters.

**Wide words dwarf the cast.** The template scales shot spans with `WORD.w`; for very long lines
pick a camera `x` near the action and let the letters crop, or cut the line into fewer pieces.

**The spotlight darkens everything in 2D.** A glyph with `glow > 0` automatically gets a 2D light
on top so it still shines; anything else you want visible in the dark must sit inside the pool
(`S.spotAt`).

**Don't trim or re-time the recording.** The hand-over is seamless only because the plate and the
traced glyphs come from the recording's last frame. Change the input → re-run `prepare.py`.

**Performance** is fine on phones for ≤ 8 pieces, 3 actors and ~20 sprites at once. Blur/`filter`
on big DOM and backdrop-filter are the expensive parts; the engine only uses them briefly.

## Requirements

- Python 3.9+ with `opencv-python` and `numpy`; `ffmpeg` + `ffprobe`.
- Node 18+ with `playwright-core` and any Chrome/Chromium — only for `shot.js`.
- Network only for fonts at build time (optional).

Developed on macOS (Apple Silicon); nothing is macOS-specific.

## Files

- `engine/` — `index.html`, `style.css`, `engine.js`, `gsap.min.js`, `story.template.js`.
  `prepare.py` copies these into each project.
- `scripts/prepare.py` · `scripts/shot.js` · `scripts/build.py` · `scripts/record.js`
- `references/story-api.md` — the `S` toolkit, coordinates, figure options, sound list.
- `examples/opus5/` — the original: `input.mp4`, `story.js`, built `opus5.html`, `preview.jpg`.
  Rebuild: `prepare.py examples/opus5/input.mp4 --out /tmp/opus5 && cp examples/opus5/story.js /tmp/opus5/assets/ && build.py /tmp/opus5`.
