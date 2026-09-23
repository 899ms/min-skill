#!/usr/bin/env python3
"""Turn a handwriting screen recording (or a photo of handwriting) into a stand-up project.

    python3 prepare.py <video-or-image> --out <project-dir> [options]

What it does
  1. takes the first and the last frame of the recording (or the photo itself)
  2. finds the ink, groups it into pieces (letters / characters) that will stand up one by one,
     and decides where each piece is hinged to the paper (its "pivot")
  3. traces every piece into smooth SVG outlines, rescaled so the word is ~233 page units tall
  4. paints the ink out of the last frame (the "plate" the 3D letters stand on)
  5. writes <project>/assets/source.js + the engine files, and trace_check.png to eyeball

Everything tunable is in source pixels of the input, the same pixels you see in trace_check.png:
  --roi x,y,w,h      only look for ink inside this box (default: whole frame minus phone UI bands)
  --thresh N         ink = gray < N (default: Otsu inside the ROI)
  --no-diff          keep ink that is already in the first frame (default drops it: static UI)
  --cuts x1,x2,..    split pieces at these x positions instead of the automatic grouping
  --merge-gap PX     merge neighbouring components closer than PX horizontally (CJK: ~0.25 × char width)
  --max-pieces N     merge the closest pieces until there are at most N (default 8)
  --pivots y1,y2,..  hinge line per piece, left to right (default: automatic baseline)
  --device phone|card   frame drawn around the page (default: phone for video, card for photos)
  --engine-only      just refresh the engine files in an existing project
"""
import argparse, json, pathlib, shutil, subprocess, sys

import cv2
import numpy as np

HERE = pathlib.Path(__file__).resolve().parent
ENGINE = HERE.parent / 'engine'
TARGET_H = 233.0          # page units for the height of the written word
SUPER = 4                 # supersampling for tracing
VIDEO_EXT = {'.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi'}


def sh(*cmd):
    return subprocess.run(cmd, check=True, capture_output=True, text=True).stdout


def ffprobe_duration(path):
    return float(json.loads(sh('ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'json', str(path)))['format']['duration'])


def copy_engine(out, keep_story=True):
    a = out / 'assets'
    a.mkdir(parents=True, exist_ok=True)
    shutil.copy(ENGINE / 'index.html', out / 'index.html')
    for f in ['engine.js', 'style.css', 'gsap.min.js']:
        shutil.copy(ENGINE / f, a / f)
    story = a / 'story.js'
    if not (keep_story and story.exists()):
        shutil.copy(ENGINE / 'story.template.js', story)


# ---------------------------------------------------------------- frames
def grab_frames(src, work):
    work.mkdir(parents=True, exist_ok=True)
    first, last = work / 'first.png', work / 'last.png'
    dur = ffprobe_duration(src)
    sh('ffmpeg', '-v', 'error', '-y', '-i', str(src), '-frames:v', '1', str(first))
    sh('ffmpeg', '-v', 'error', '-y', '-sseof', f'-{min(1.5, max(0.1, dur - 0.05)):.2f}', '-i', str(src), '-update', '1', '-q:v', '1', str(last))
    return cv2.imread(str(first)), cv2.imread(str(last)), dur


def ink_timeline(src, roi, thresh, static_small, size):
    """fraction of the final ink present at each sampled time → when the writing happens"""
    w, h = size
    sw = 160
    shh = int(round(h * sw / w / 2)) * 2
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(src), '-vf', f'fps=8,scale={sw}:{shh},format=gray', '-f', 'rawvideo', '-'], check=True, capture_output=True).stdout
    fr = np.frombuffer(raw, np.uint8).reshape(-1, shh, sw)
    x, y, rw, rh = [int(round(v * sw / w)) for v in roi]
    counts = []
    for f in fr:
        m = (f < thresh)
        if static_small is not None:
            m &= ~static_small
        counts.append(int(m[y:y + rh, x:x + rw].sum()))
    counts = np.array(counts, float)
    fin = max(1.0, counts[-3:].mean())
    t = np.arange(len(counts)) / 8.0
    started = np.where(counts > 0.04 * fin)[0]
    done = np.where(counts >= 0.96 * fin)[0]
    t0 = float(t[started[0]]) if len(started) else 0.0
    t1 = float(t[done[0]]) if len(done) else float(t[-1])
    return round(max(0.0, t0 - 0.2), 2), round(t1 + 0.1, 2)


# ---------------------------------------------------------------- ink
def default_roi(w, h, is_video):
    if is_video and h > w * 1.3:          # phone portrait: skip status bar / toolbars
        return (0, int(h * 0.11), w, int(h * 0.78))
    return (0, 0, w, h)


def ink_mask(gray, roi, thresh, static=None):
    x, y, w, h = roi
    m = np.zeros_like(gray, np.uint8)
    m[y:y + h, x:x + w] = (gray[y:y + h, x:x + w] < thresh)
    if static is not None:
        m &= ~static
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))
    return m


def components(mask, min_area):
    n, lab, st, _ = cv2.connectedComponentsWithStats(mask, 8)
    comps = []
    for i in range(1, n):
        x, y, w, h, a = st[i]
        if a >= min_area:
            comps.append({'ids': [i], 'x0': x, 'x1': x + w, 'y0': y, 'y1': y + h, 'area': int(a)})
    return lab, comps


def merge(a, b):
    return {'ids': a['ids'] + b['ids'], 'x0': min(a['x0'], b['x0']), 'x1': max(a['x1'], b['x1']),
            'y0': min(a['y0'], b['y0']), 'y1': max(a['y1'], b['y1']), 'area': a['area'] + b['area']}


def group_pieces(comps, cuts=None, merge_gap=0, max_pieces=8):
    if not comps:
        sys.exit('no ink found — try --roi / --thresh')
    if cuts:
        edges = [-1e9] + sorted(cuts) + [1e9]
        pieces = []
        for a, b in zip(edges, edges[1:]):
            inside = [c for c in comps if a <= (c['x0'] + c['x1']) / 2 < b]
            if inside:
                p = inside[0]
                for c in inside[1:]:
                    p = merge(p, c)
                pieces.append(p)
        return pieces

    # lines first (for multi-line writing), by vertical overlap
    lines = []
    for c in sorted(comps, key=lambda c: -c['area']):
        for L in lines:
            ov = min(L['y1'], c['y1']) - max(L['y0'], c['y0'])
            if ov > 0.3 * min(L['y1'] - L['y0'], c['y1'] - c['y0']):
                L['c'].append(c); L['y0'] = min(L['y0'], c['y0']); L['y1'] = max(L['y1'], c['y1'])
                break
        else:
            lines.append({'c': [c], 'y0': c['y0'], 'y1': c['y1']})
    lines.sort(key=lambda L: L['y0'])

    pieces = []
    for L in lines:
        big = sorted([c for c in L['c']], key=lambda c: c['x0'])
        med = np.median([c['area'] for c in big])
        small = [c for c in big if c['area'] < 0.12 * med]
        big = [c for c in big if c['area'] >= 0.12 * med]
        row = []
        for c in big:
            if row:
                p = row[-1]
                ov = min(p['x1'], c['x1']) - max(p['x0'], c['x0'])
                gap = c['x0'] - p['x1']
                if ov > 0.5 * min(p['x1'] - p['x0'], c['x1'] - c['x0']) or (merge_gap and gap < merge_gap):
                    row[-1] = merge(p, c)
                    continue
            row.append(dict(c))
        for s in small:      # dots, accents → nearest piece
            cxs = (s['x0'] + s['x1']) / 2
            k = min(range(len(row)), key=lambda i: abs((row[i]['x0'] + row[i]['x1']) / 2 - cxs))
            row[k] = merge(row[k], s)
        # a sliver much narrower than the line is tall is usually half of a character (亻 of 你, 女 of 好):
        # join it to its nearer neighbour as long as the result stays roughly square
        lh = float(np.median([p['y1'] - p['y0'] for p in row]))
        changed = True
        while changed and len(row) > 1:
            changed = False
            for i in sorted(range(len(row)), key=lambda i: row[i]['x1'] - row[i]['x0']):
                if row[i]['x1'] - row[i]['x0'] >= 0.62 * lh:
                    break
                opts = [j for j in (i - 1, i + 1) if 0 <= j < len(row)]
                j = min(opts, key=lambda j: max(row[j]['x0'], row[i]['x0']) - min(row[j]['x1'], row[i]['x1']))
                a_, b_ = sorted((i, j))
                m = merge(row[a_], row[b_])
                if m['x1'] - m['x0'] <= 1.25 * lh:
                    row[a_:b_ + 1] = [m]
                    changed = True
                    break
        pieces += row
    while len(pieces) > max_pieces:
        k = min(range(len(pieces) - 1), key=lambda i: pieces[i + 1]['x0'] - pieces[i]['x1'])
        pieces[k:k + 2] = [merge(pieces[k], pieces[k + 1])]
    return pieces


def auto_pivot(mask_piece, line_h):
    """hinge line = bottom of the piece's body. A thin tail hanging below it (the stem of p/g/y)
    is left below the hinge, so once the piece stands up the tail is planted into the paper."""
    ys, xs = np.where(mask_piece)
    y0, bottom = ys.min(), ys.max()
    counts = np.bincount(ys - y0, minlength=bottom - y0 + 1).astype(float)
    thr = 0.5 * np.median(counts[counts > 0])
    dense = counts >= thr
    win = max(3, int(0.15 * (bottom - y0)))
    for y in range(len(counts) - 1, -1, -1):
        if dense[y] and dense[max(0, y - win):y + 1].mean() >= 0.6:
            pv = y0 + y
            break
    else:
        pv = bottom
    return float(bottom if bottom - pv < 0.06 * line_h else pv)


def extend_edges(mask, pad, band=120):
    """strokes cut off by the frame edge get a rounded end instead of a flat cut (mask is supersampled)"""
    h, w = mask.shape
    for x_edge, bx0, bx1 in [(pad, pad, pad + band), (w - pad - 1, w - pad - 1 - band, w - pad - 1)]:
        ys = np.where(mask[:, x_edge] > 0)[0]
        if not len(ys):
            continue
        for r in np.split(ys, np.where(np.diff(ys) > 1)[0] + 1):
            yc, t = float(r.mean()), len(r)
            y0, y1 = max(0, int(yc - 3 * t)), min(h, int(yc + 3 * t))
            by, bx = np.where(mask[y0:y1, bx0:bx1] > 0)
            if len(bx) < 5:
                continue
            dx, dy = x_edge - (bx0 + bx.mean()), yc - (y0 + by.mean())
            n = np.hypot(dx, dy) or 1.0
            dx, dy = dx / n, dy / n
            p0 = (int(x_edge - dx * 4), int(yc - dy * 4))
            p1 = (int(x_edge + dx * t * 0.9), int(yc + dy * t * 0.9))
            cv2.line(mask, p0, p1, 255, max(1, t), lineType=cv2.LINE_AA)
            cv2.circle(mask, p1, max(1, t // 2), 255, -1, lineType=cv2.LINE_AA)


# ---------------------------------------------------------------- tracing
def smooth_closed(pts, sigma):
    k = int(sigma * 3) | 1
    ker = cv2.getGaussianKernel(2 * k + 1, sigma).ravel()
    out = np.empty_like(pts)
    for d in range(2):
        v = np.concatenate([pts[-k:, d], pts[:, d], pts[:k, d]])
        out[:, d] = np.convolve(v, ker, mode='same')[k:-k]
    return out


def resample(pts, step):
    closed = np.vstack([pts, pts[:1]])
    seg = np.linalg.norm(np.diff(closed, axis=0), axis=1)
    cum = np.concatenate([[0], np.cumsum(seg)])
    t = np.arange(0, cum[-1], step)
    return np.stack([np.interp(t, cum, closed[:, 0]), np.interp(t, cum, closed[:, 1])], 1)


def to_path(p):
    n = len(p)
    f = lambda v: f'{v[0]:.1f} {v[1]:.1f}'
    d = [f'M{f(p[0])}']
    for i in range(n):
        p0, p1, p2, p3 = p[i - 1], p[i], p[(i + 1) % n], p[(i + 2) % n]
        d.append(f'C{f(p1 + (p2 - p0) / 6)} {f(p2 - (p3 - p1) / 6)} {f(p2)}')
    return ''.join(d) + 'Z'


def trace(mask_big, scale_out, offset):
    """mask_big: supersampled binary mask of one piece → SVG path in page units"""
    cs, _ = cv2.findContours(mask_big, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
    parts = []
    for c in cs:
        if cv2.contourArea(c) < 30 * SUPER * SUPER / 16:
            continue
        pts = c[:, 0, :].astype(np.float64)
        if len(pts) < 8:
            continue
        pts = smooth_closed(pts, 5.0)
        pts = resample(pts, 7.0)
        if len(pts) < 4:
            continue
        pts = cv2.approxPolyDP(pts.astype(np.float32).reshape(-1, 1, 2), 1.2, True)[:, 0, :].astype(np.float64)
        if len(pts) < 3:
            continue
        parts.append(to_path((pts / SUPER + offset) * scale_out))
    return ''.join(parts)


def hexcolor(bgr):
    b, g, r = [int(v) for v in bgr]
    return f'#{r:02x}{g:02x}{b:02x}'


# ---------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('input', nargs='?')
    ap.add_argument('--out', required=True)
    ap.add_argument('--roi')
    ap.add_argument('--thresh', type=float)
    ap.add_argument('--no-diff', action='store_true')
    ap.add_argument('--cuts')
    ap.add_argument('--merge-gap', type=float, default=0)
    ap.add_argument('--max-pieces', type=int, default=8)
    ap.add_argument('--pivots')
    ap.add_argument('--device', choices=['phone', 'card'])
    ap.add_argument('--engine-only', action='store_true')
    ap.add_argument('--fresh-story', action='store_true', help='overwrite assets/story.js with the template')
    a = ap.parse_args()

    out = pathlib.Path(a.out).expanduser().resolve()
    copy_engine(out, keep_story=not a.fresh_story)
    if a.engine_only:
        print('engine refreshed in', out)
        return
    if not a.input:
        sys.exit('input video/image required')
    src = pathlib.Path(a.input).expanduser().resolve()
    is_video = src.suffix.lower() in VIDEO_EXT
    work = out / 'frames'
    work.mkdir(parents=True, exist_ok=True)

    if is_video:
        first, last, dur = grab_frames(src, work)
    else:
        last = cv2.imread(str(src))
        if last is None:
            sys.exit(f'cannot read {src}')
        first, dur = None, 0
        cv2.imwrite(str(work / 'last.png'), last)
    H, W = last.shape[:2]
    gray = cv2.cvtColor(last, cv2.COLOR_BGR2GRAY)

    roi = tuple(int(v) for v in a.roi.split(',')) if a.roi else default_roi(W, H, is_video)
    rx, ry, rw, rh = roi
    region = gray[ry:ry + rh, rx:rx + rw]
    bg = float(np.median(region))
    if a.thresh:
        thr = a.thresh
    else:
        otsu, _ = cv2.threshold(region, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        thr = float(np.clip(otsu, 60, bg - 35))
    static = None
    if first is not None and not a.no_diff:
        static = cv2.dilate((cv2.cvtColor(first, cv2.COLOR_BGR2GRAY) < thr).astype(np.uint8), np.ones((5, 5), np.uint8))
    mask = ink_mask(gray, roi, thr, static)
    total = int(mask.sum())
    lab, comps = components(mask, max(12, 0.003 * total))
    cuts = [float(v) for v in a.cuts.split(',')] if a.cuts else None
    pieces = group_pieces(comps, cuts, a.merge_gap, a.max_pieces)

    # pivots (source px)
    line_h = np.median([p['y1'] - p['y0'] for p in pieces])
    piece_masks = [np.isin(lab, p['ids']) for p in pieces]
    if a.pivots:
        pivots = [float(v) for v in a.pivots.split(',')]
        if len(pivots) != len(pieces):
            sys.exit(f'--pivots needs {len(pieces)} values (one per piece)')
    else:
        pivots = [auto_pivot(m, line_h) for m in piece_masks]
    word_top = min(p['y0'] for p in pieces)
    word_h = max(pivots) - word_top
    scale = float(np.clip(TARGET_H / max(word_h, 1), 0.2, 5.0))

    # trace each piece on a supersampled, padded canvas
    PAD = 40
    big = cv2.resize(gray.astype(np.float32), (W * SUPER, H * SUPER), interpolation=cv2.INTER_CUBIC)
    big = cv2.GaussianBlur(big, (0, 0), 2.2 * SUPER / 4)
    big = cv2.copyMakeBorder((big < thr).astype(np.uint8) * 255, 0, 0, PAD * SUPER, PAD * SUPER, cv2.BORDER_CONSTANT, value=0)
    glyphs = []
    for i, (p, pm) in enumerate(zip(pieces, piece_masks)):
        reach = cv2.dilate(pm.astype(np.uint8), np.ones((5, 5), np.uint8))
        reach_big = cv2.resize(reach, (W * SUPER, H * SUPER), interpolation=cv2.INTER_NEAREST)
        reach_big = cv2.copyMakeBorder(reach_big, 0, 0, PAD * SUPER, PAD * SUPER, cv2.BORDER_CONSTANT, value=0)
        mb = (big & (reach_big * 255)).astype(np.uint8)
        if p['x0'] <= 1 or p['x1'] >= W - 1:
            extend_edges(mb, PAD * SUPER)
        d = trace(mb, scale, np.array([-PAD, 0.0]))
        ys, xs = np.where(mb > 0)
        x0, x1 = (xs.min() / SUPER - PAD) * scale, (xs.max() / SUPER - PAD) * scale
        y0, y1 = ys.min() / SUPER * scale, ys.max() / SUPER * scale
        glyphs.append({'label': str(i), 'd': d, 'bbox': [round(x0, 1), round(y0, 1), round(x1 - x0, 1), round(y1 - y0, 1)], 'pivot': round(pivots[i] * scale, 1)})

    # plate: the last frame with the ink painted out
    inpaint_mask = cv2.dilate(np.isin(lab, [i for p in pieces for i in p['ids']]).astype(np.uint8) * 255, np.ones((7, 7), np.uint8))
    plate = cv2.inpaint(last, inpaint_mask, 5, cv2.INPAINT_TELEA)
    assets = out / 'assets'
    cv2.imwrite(str(assets / 'plate.jpg'), plate, [cv2.IMWRITE_JPEG_QUALITY, 90])
    core = cv2.erode(inpaint_mask, np.ones((3, 3), np.uint8)) > 0
    ink_col = hexcolor(np.median(last[core & (mask > 0)], axis=0)) if (core & (mask > 0)).any() else '#262424'
    bg_col = hexcolor(np.median(plate[ry:ry + rh, rx:rx + rw].reshape(-1, 3), axis=0))

    video = None
    if is_video:
        cv2.imwrite(str(assets / 'poster.jpg'), first, [cv2.IMWRITE_JPEG_QUALITY, 88])
        sh('ffmpeg', '-v', 'error', '-y', '-i', str(src), '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', '26', '-pix_fmt', 'yuv420p',
           '-vf', "scale='min(720,iw)':-2", '-movflags', '+faststart', str(assets / 'writing.mp4'))
        small_static = None
        if static is not None:
            sw = 160
            shh = int(round(H * sw / W / 2)) * 2
            small_static = cv2.resize(static, (sw, shh), interpolation=cv2.INTER_NEAREST) > 0
        write = ink_timeline(src, roi, thr, small_static, (W, H))
        video = {'src': 'assets/writing.mp4', 'duration': round(ffprobe_duration(assets / 'writing.mp4'), 3), 'write': list(write)}
    else:
        cv2.imwrite(str(assets / 'poster.jpg'), last, [cv2.IMWRITE_JPEG_QUALITY, 88])

    source = {
        'page': [round(W * scale, 1), round(H * scale, 1)], 'scale': round(scale, 4),
        'device': a.device or ('phone' if is_video else 'card'),
        'ink': ink_col, 'bg': bg_col, 'video': video, 'glyphs': glyphs,
    }
    (assets / 'source.js').write_text('window.SOURCE = ' + json.dumps(source, ensure_ascii=False, separators=(',', ':')) + ';\n')

    # trace_check.png — outlines, piece numbers and hinge lines over the frame (source px)
    chk = cv2.cvtColor(cv2.cvtColor(last, cv2.COLOR_BGR2GRAY), cv2.COLOR_GRAY2BGR)
    chk = cv2.addWeighted(chk, 0.45, np.full_like(chk, 255), 0.55, 0)
    palette = [(66, 99, 235), (40, 160, 90), (200, 80, 40), (160, 60, 200), (30, 150, 200), (200, 150, 30), (90, 90, 90), (220, 60, 140)]
    over = chk.copy()
    for i, pm in enumerate(piece_masks):
        over[pm] = palette[i % len(palette)]
    chk = cv2.addWeighted(over, 0.7, chk, 0.3, 0)
    for i, (p, pv) in enumerate(zip(pieces, pivots)):
        col = palette[i % len(palette)]
        for x in range(int(p['x0']) - 6, int(p['x1']) + 6, 8):
            cv2.line(chk, (x, int(pv)), (x + 4, int(pv)), col, 2)
        cv2.putText(chk, str(i), (int(p['x0']), int(p['y0']) - 8), cv2.FONT_HERSHEY_SIMPLEX, 0.9, col, 2, cv2.LINE_AA)
    cv2.rectangle(chk, (rx, ry), (rx + rw - 1, ry + rh - 1), (0, 170, 255), 1)
    cv2.imwrite(str(out / 'trace_check.png'), chk)

    print(json.dumps({
        'project': str(out), 'frame': [W, H], 'roi': roi, 'thresh': round(thr, 1), 'scale': round(scale, 3),
        'pieces': [{'i': i, 'x': [int(p['x0']), int(p['x1'])], 'y': [int(p['y0']), int(p['y1'])], 'pivot': round(pv, 1)} for i, (p, pv) in enumerate(zip(pieces, pivots))],
        'video': video, 'ink': ink_col, 'bg': bg_col,
        'next': f'look at {out / "trace_check.png"}, then write {assets / "story.js"}',
    }, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    main()
