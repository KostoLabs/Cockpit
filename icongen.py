#!/usr/bin/env python3
"""Rastérise l'icône d'application KostoLabs AI en PNG, sans dépendance.
Source : kl-app-icon.svg — tuile 96x96 #0A0A0B coins arrondis à 28 % du côté,
symbole blanc #FFFFFF (64x64, les deux courbes de distribution en even-odd)
translaté de (16, 14). Rendu par balayage avec suréchantillonnage 4x."""
import zlib, struct, math, os, sys

# ---------------------------------------------------------------- géométrie

def bezier(p0, p1, p2, p3, steps):
    pts = []
    for i in range(1, steps + 1):
        t = i / steps
        mt = 1 - t
        x = mt**3*p0[0] + 3*(mt**2)*t*p1[0] + 3*mt*(t**2)*p2[0] + t**3*p3[0]
        y = mt**3*p0[1] + 3*(mt**2)*t*p1[1] + 3*mt*(t**2)*p2[1] + t**3*p3[1]
        pts.append((x, y))
    return pts

def flatten_mark():
    """Deux sous-chemins du symbole, viewBox 64x64, y vers le bas."""
    s1 = ([(2, 48)]
          + bezier((2, 48), (14, 48), (16, 8), (24, 8), 28)
          + bezier((24, 8), (32, 8), (34, 48), (46, 48), 28))
    s2 = ([(18, 48)]
          + bezier((18, 48), (30, 48), (32, 22), (40, 22), 28)
          + bezier((40, 22), (48, 22), (50, 48), (62, 48), 28))
    return [s1, s2]

def rounded_rect(w, h, r, seg=14):
    pts = [(r, 0)]
    def arc(cx, cy, a0, a1):
        for i in range(1, seg + 1):
            a = a0 + (a1 - a0) * i / seg
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    pts.append((w - r, 0))
    arc(w - r, r, -math.pi / 2, 0.0)
    pts.append((w, h - r))
    arc(w - r, h - r, 0.0, math.pi / 2)
    pts.append((r, h))
    arc(r, h - r, math.pi / 2, math.pi)
    pts.append((0, r))
    arc(r, r, math.pi, 1.5 * math.pi)
    return pts

# ---------------------------------------------------------------- rastérisation

def coverage(polygons, w, h, ss=4):
    """Masque de couverture (0..1 par pixel), règle even-odd sur tous les
    sous-chemins. Balayage ligne par ligne, intersections triées."""
    W, H = w * ss, h * ss
    edges = []
    for poly in polygons:
        n = len(poly)
        for i in range(n):
            x0, y0 = poly[i]
            x1, y1 = poly[(i + 1) % n]
            if y0 != y1:
                edges.append((x0 * ss, y0 * ss, x1 * ss, y1 * ss))
    cov = [[0.0] * w for _ in range(h)]
    for sy in range(H):
        y = sy + 0.5
        xs = []
        for (x0, y0, x1, y1) in edges:
            if (y0 <= y < y1) or (y1 <= y < y0):
                t = (y - y0) / (y1 - y0)
                xs.append(x0 + t * (x1 - x0))
        if not xs:
            continue
        xs.sort()
        row = cov[sy // ss]
        base = (sy // ss) * ss
        for k in range(0, len(xs) - 1, 2):
            lo = int(math.ceil(xs[k] - 0.5))
            hi = int(math.floor(xs[k + 1] - 0.5))
            for x in range(max(lo, 0), min(hi, W - 1) + 1):
                row[x // ss] += 1.0 / (ss * ss)
    return cov

def blend(existing, fg, c):
    """existing : (r,g,b,a) avec a en 0..1 ; fg en 0..255. Retour float."""
    if c <= 0:
        return existing
    if c > 1:
        c = 1.0
    er, eg, eb, ea = existing
    out_a = c + (1 - c) * ea
    if out_a == 0:
        return (0.0, 0.0, 0.0, 0.0)
    r = (c * fg[0] + (1 - c) * ea * er) / out_a
    g = (c * fg[1] + (1 - c) * ea * eg) / out_a
    b = (c * fg[2] + (1 - c) * ea * eb) / out_a
    return (r, g, b, out_a)

def render_icon(size, ss=4):
    # Gabarit macOS (Big Sur+) : la tuile occupe 824 unités d'un canvas 1024,
    # soit des marges transparentes de 100 unités de chaque côté. Sans ces
    # marges, l'icône paraît beaucoup plus grande que les autres dans le Dock.
    off = 96.0 * 100.0 / 824.0          # marge en unités design (11.65)
    total = 96.0 + 2.0 * off            # canvas design (119.30)
    dx = dy = off
    tile = [[(x + dx, y + dy) for (x, y) in p] for p in [rounded_rect(96.0, 96.0, 22.0)]]
    mark = flatten_mark()
    translated = [[(x + dx + 16.0, y + dy + 14.0) for (x, y) in poly] for poly in mark]
    scale = size / total
    def sc(polys):
        return [[(x * scale, y * scale) for (x, y) in p] for p in polys]
    px = [[(0, 0, 0, 0)] * size for _ in range(size)]
    for polys, color in ((sc(tile), (10, 10, 11)), (sc(translated), (255, 255, 255))):
        cov = coverage(polys, size, size, ss)
        for y in range(size):
            row = px[y]
            for x in range(size):
                row[x] = blend(row[x], color, cov[y][x])
    return px

# ---------------------------------------------------------------- PNG / ICNS

def write_png(path, px, size):
    raw = bytearray()
    for y in range(size):
        raw.append(0)  # filtre 0
        for x in range(size):
            r, g, b, a = px[y][x]
            raw += bytes((max(0, min(255, round(r))),
                          max(0, min(255, round(g))),
                          max(0, min(255, round(b))),
                          max(0, min(255, round(a * 255)))))
    def chunk(tag, data):
        c = tag + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)
    png = (b'\x89PNG\r\n\x1a\n'
           + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0))
           + chunk(b'IDAT', zlib.compress(bytes(raw), 9))
           + chunk(b'IEND', b''))
    with open(path, 'wb') as f:
        f.write(png)

def write_icns(path, pngs):
    """pngs : dict taille -> chemin PNG. Types ic07..ic14, PNG autorisés dedans."""
    types = {16: b'icp4', 32: b'ic11', 64: b'ic12', 128: b'ic07', 256: b'ic08',
             512: b'ic09', 1024: b'ic10'}
    # ic13 = 256 (128@2x), ic14 = 512 (256@2x) : réutilise les PNG existants.
    body = bytearray()
    def add(t, data):
        body.extend(struct.pack('>4sI', t, 8 + len(data)))
        body.extend(data)
    for size in sorted(pngs):
        data = open(pngs[size], 'rb').read()
        add(types[size], data)
        if size == 128:
            add(b'ic07', data)
        if size == 256:
            add(b'ic13', data)
        if size == 512:
            add(b'ic14', data)
    out = struct.pack('>4sI', b'icns', 8 + len(body)) + bytes(body)
    with open(path, 'wb') as f:
        f.write(out)

if __name__ == '__main__':
    outdir = sys.argv[1]
    os.makedirs(outdir, exist_ok=True)
    pngs = {}
    for size in (16, 32, 64, 128, 256, 512, 1024):
        p = os.path.join(outdir, 'icon_%d.png' % size)
        write_png(p, render_icon(size), size)
        pngs[size] = p
        print('png', size)
    write_icns(os.path.join(outdir, 'AppIcon.icns'), pngs)
    print('icns', os.path.getsize(os.path.join(outdir, 'AppIcon.icns')), 'octets')
