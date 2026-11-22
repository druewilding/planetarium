import struct, sys, array
src, out = sys.argv[1], sys.argv[2]
f = open(src, 'rb').read()
bo = '<' if f[:2] == b'II' else '>'
off = struct.unpack(bo + 'I', f[4:8])[0]
n = struct.unpack(bo + 'H', f[off:off + 2])[0]
tags = {}
for i in range(n):
    e = f[off + 2 + i * 12: off + 14 + i * 12]
    tag, typ, cnt = struct.unpack(bo + 'HHI', e[:8])
    tags[tag] = (typ, cnt, e[8:12])
def arr(tag):
    typ, cnt, raw = tags[tag]
    size = {3: 2, 4: 4}[typ]
    fmt = {3: 'H', 4: 'I'}[typ]
    if cnt * size <= 4:
        return list(struct.unpack(bo + fmt * cnt, raw[:cnt * size]))
    p = struct.unpack(bo + 'I', raw)[0]
    return list(struct.unpack(bo + fmt * cnt, f[p:p + cnt * size]))
W, H = arr(256)[0], arr(257)[0]
print('sampleformat', arr(339), 'bits', arr(258))
offs, counts = arr(273), arr(279)
data = b''.join(f[o:o + c] for o, c in zip(offs, counts))
vals = [max(0.0, v - 0.008) for v in struct.unpack(bo + 'e' * (W * H * 3), data)]  # drop the faint all-sky floor
lum = [0.2126 * vals[i] + 0.7152 * vals[i + 1] + 0.0722 * vals[i + 2] for i in range(0, len(vals), 3)]
s = sorted(lum)
pct = lambda q: s[min(len(s) - 1, int(q * len(s)))]
print('min', s[0], 'p50', pct(0.5), 'p90', pct(0.9), 'p99', pct(0.99), 'p999', pct(0.999), 'max', s[-1])
ref = pct(0.998)
# Find the brightest region roughly (column/row of max smoothed) for orientation
best = max(range(len(lum)), key=lambda i: lum[i] if lum[i] < pct(0.9999) else 0)
print('bright pixel at x', best % W, 'y', best // W)
# Gamma-encode to 8-bit BMP (bottom-up rows), keeping colour.
row = (W * 3 + 3) & ~3
img = bytearray(row * H)
for y in range(H):
    for x in range(W):
        i = (y * W + x) * 3
        o = (H - 1 - y) * row + x * 3
        for c in range(3):
            v = max(0.0, vals[i + c]) / ref
            v = min(1.0, v) ** (1 / 2.2)
            img[o + 2 - c] = int(v * 255 + 0.5)
hdr = b'BM' + struct.pack('<IHHI', 54 + len(img), 0, 0, 54) + struct.pack('<IiiHHIIiiII', 40, W, H, 1, 24, 0, len(img), 2835, 2835, 0, 0)
open(out, 'wb').write(hdr + img)
print('ref (p99.8 luminance) =', ref)
