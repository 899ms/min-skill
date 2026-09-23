#!/usr/bin/env python3
"""Bundle a stand-up project into ONE self-contained HTML file (video, images, fonts, scripts inlined).

    python3 build.py <project-dir> [--out file.html] [--no-fonts]

Fonts: the Chinese serif (Noto Serif SC), the Roman numerals (Cormorant Garamond) and the banner
blackletter (UnifrakturMaguntia) are fetched from Google Fonts, subset to exactly the characters the
story uses, cached in assets/fonts/, and inlined. Offline or --no-fonts → system fonts are used.
"""
import argparse, base64, pathlib, re, sys, urllib.parse, urllib.request

UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
ASCII = ''.join(chr(c) for c in range(32, 127))


def fetch(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': UA}), timeout=60).read()


def ensure_fonts(A, text):
    """download subset woff2 files for the characters in `text`; returns fonts.css or '' on failure"""
    fd = A / 'fonts'
    fd.mkdir(exist_ok=True)
    stamp = fd / 'chars.txt'
    css_file = A / 'fonts.css'
    if css_file.exists() and stamp.exists() and set(text) <= set(stamp.read_text()):
        return css_file.read_text()
    reqs = [
        ('Noto Serif SC', 'Noto+Serif+SC:wght@500;600;700', text + ASCII),
        ('Cormorant Garamond', 'Cormorant+Garamond:ital,wght@0,300;1,400', ASCII),
        ('UnifrakturMaguntia', 'UnifrakturMaguntia', ASCII),
    ]
    faces, seen = [], {}
    try:
        for fam, q, t in reqs:
            css = fetch(f'https://fonts.googleapis.com/css2?family={q}&text={urllib.parse.quote(t)}&display=swap').decode()
            for block in re.findall(r'@font-face\s*{[^}]*}', css):
                url = re.search(r'url\((https://[^)]+)\)', block).group(1)
                w = re.search(r'font-weight:\s*(\d+)', block).group(1)
                st = re.search(r'font-style:\s*(\w+)', block).group(1)
                data = fetch(url)
                key = (fam, st, hash(data))
                if key in seen:                       # variable fonts come back once per weight: keep one, widen its range
                    seen[key]['w'].append(int(w))
                    continue
                fn = f"{fam.replace(' ', '')}-{w}{'i' if st == 'italic' else ''}.woff2"
                (fd / fn).write_bytes(data)
                seen[key] = {'fam': fam, 'st': st, 'w': [int(w)], 'fn': fn}
        for f in seen.values():
            wr = f"{min(f['w'])} {max(f['w'])}" if len(f['w']) > 1 else str(f['w'][0])
            faces.append(f"@font-face {{ font-family: '{f['fam']}'; font-style: {f['st']}; font-weight: {wr}; font-display: swap; src: url('fonts/{f['fn']}') format('woff2'); }}")
    except Exception as e:  # offline, blocked, …
        print(f'[fonts] skipped ({e.__class__.__name__}: {e}); system fonts will be used', file=sys.stderr)
        return ''
    css = '\n'.join(faces) + '\n'
    css_file.write_text(css)
    stamp.write_text(''.join(sorted(set(text))))
    return css


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('project')
    ap.add_argument('--out')
    ap.add_argument('--no-fonts', action='store_true')
    a = ap.parse_args()
    P = pathlib.Path(a.project).expanduser().resolve()
    A = P / 'assets'
    html = (P / 'index.html').read_text()
    b64 = lambda p: base64.b64encode(p.read_bytes()).decode()

    story = (A / 'story.js').read_text()
    chars = ''.join(sorted({c for c in story + html + (A / 'engine.js').read_text() if ord(c) > 0x2000}))
    fonts_css = '' if a.no_fonts else ensure_fonts(A, chars)
    fonts_css = re.sub(r"url\('fonts/([^']+)'\)", lambda m: f"url(data:font/woff2;base64,{b64(A / 'fonts' / m.group(1))})", fonts_css)
    html = html.replace('<link rel="stylesheet" href="assets/fonts.css">', f'<style>\n{fonts_css}</style>' if fonts_css else '')
    html = html.replace('<link rel="stylesheet" href="assets/style.css">', f'<style>\n{(A / "style.css").read_text()}</style>')
    html = html.replace('src="assets/plate.jpg"', f'src="data:image/jpeg;base64,{b64(A / "plate.jpg")}"')
    html = html.replace('src="assets/poster.jpg"', f'src="data:image/jpeg;base64,{b64(A / "poster.jpg")}"')

    video_loader = ''
    if (A / 'writing.mp4').exists() and '"video":null' not in (A / 'source.js').read_text().replace(' ', ''):
        # a Blob URL plays everywhere a data: URL might not (Safari / WeChat)
        video_loader = ("<script>(function(){var s=atob('" + b64(A / 'writing.mp4') + "'),n=s.length,u=new Uint8Array(n);"
                        "for(var i=0;i<n;i++)u[i]=s.charCodeAt(i);"
                        "document.getElementById('vid').src=URL.createObjectURL(new Blob([u],{type:'video/mp4'}));})();</script>")
    for js in ['gsap.min.js', 'source.js', 'story.js', 'engine.js']:
        tag = f'<script src="assets/{js}"></script>'
        assert tag in html, tag
        code = (A / js).read_text().replace('</script', '<\\/script')
        html = html.replace(tag, (video_loader if js == 'gsap.min.js' else '') + f'<script>\n{code}\n</script>')
    left = re.findall(r'assets/[\w./-]+', html)
    left = [x for x in left if x != 'assets/writing.mp4']
    assert not left, left

    out = pathlib.Path(a.out).expanduser().resolve() if a.out else P / 'dist' / f'{P.name}.html'
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(html)
    print(out, f'{out.stat().st_size / 1024:.0f} KB')


if __name__ == '__main__':
    main()
