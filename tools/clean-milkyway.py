# Takes the deep-sky objects out of the Milky Way map, so they aren't drawn twice.
# NASA's map has no stars, but it does have the unresolved glow of star clusters and
# galaxies, as blurry blobs a few pixels across: the deep-sky layer draws those now,
# true to size, so each blob is filled in smoothly from the sky round its edge.
# Objects the map shows better than an oval could (the Magellanic Clouds and the like)
# have no glow of their own in data/deepsky.json, and stay.
#
# Usage (sips is macOS's image converter; any tool that writes a 24-bit BMP will do):
#   sips -s format bmp textures/milkyway.jpg --out /tmp/mw.bmp
#   python3 tools/clean-milkyway.py /tmp/mw.bmp data/deepsky.json /tmp/mw-clean.bmp
#   sips -s format jpeg -s formatOptions 90 /tmp/mw-clean.bmp --out textures/milkyway.jpg

import json, math, struct, sys

src, catalogue, out = sys.argv[1:4]
f = bytearray(open(src, "rb").read())
off = struct.unpack("<I", f[10:14])[0]
W, H = struct.unpack("<ii", f[18:26])
assert struct.unpack("<H", f[28:30])[0] == 24, "needs a 24-bit BMP"
top_down = H < 0
H = abs(H)
row = (W * 3 + 3) & ~3


def index(x, y):
    yy = y if top_down else H - 1 - y
    return off + yy * row + x * 3


# The map: RA 0h in the middle, increasing to the left; Dec +90° at the top.
def radec(x, y):
    return (0.5 - (x + 0.5) / W) * 360 % 360, (0.5 - (y + 0.5) / H) * 180


def pixel(ra, dec):
    return int(((0.5 - ra / 360) % 1) * W), min(H - 1, max(0, int((0.5 - dec / 180) * H)))


def unit(ra, dec):
    r, d = math.radians(ra), math.radians(dec)
    return (math.cos(d) * math.cos(r), math.cos(d) * math.sin(r), math.sin(d))


def lum(x, y):
    i = index(x % W, min(H - 1, max(0, y)))
    return 0.0722 * f[i] + 0.7152 * f[i + 1] + 0.2126 * f[i + 2]


def ring(ra, dec, r):
    s = 0
    for k in range(24):
        a = k * math.pi / 12
        x, y = pixel(ra + r * math.cos(a) / max(0.05, math.cos(math.radians(dec))), dec + r * math.sin(a))
        s += lum(x, y)
    return s / 24


PX = 180 / H  # degrees per pixel, north–south
mask = set()
for oid, _, ra, dec, kind, mag, glow, major, minor in json.load(open(catalogue)):
    if glow is None:
        continue
    r = major / 120  # its radius, degrees
    centre, around = lum(*pixel(ra, dec)), ring(ra, dec, max(2.5 * r, 4 * PX))
    if centre - around < 8 or centre < 1.2 * around:
        continue  # not in the map, or no brighter than the Milky Way round it
    reach = max(2.2 * r, 2.5 * PX)  # the blob, blurred by the map's pixels
    c = unit(ra, dec)
    cos_reach = math.cos(math.radians(reach))
    x0, y0 = pixel(ra, dec)
    ny = int(reach / PX) + 2
    nx = int(ny / max(0.02, math.cos(math.radians(dec)))) + 2
    n = 0
    for y in range(max(0, y0 - ny), min(H, y0 + ny + 1)):
        for dx in range(-min(nx, W // 2), min(nx, W // 2) + 1):
            x = (x0 + dx) % W
            u = unit(*radec(x, y))
            if u[0] * c[0] + u[1] * c[1] + u[2] * c[2] >= cos_reach:
                mask.add((x, y))
                n += 1
    print(f"{oid:9s} centre {centre:5.1f} around {around:5.1f}: {n} pixels")

# Fill the holes smoothly from their edges (Laplace's equation, by relaxation).
pts = sorted(mask)
vals = {p: [0.0, 0.0, 0.0] for p in pts}
for it in range(600):
    for x, y in pts:
        acc = [0.0, 0.0, 0.0]
        for q in (((x - 1) % W, y), ((x + 1) % W, y), (x, max(0, y - 1)), (x, min(H - 1, y + 1))):
            v = vals.get(q)
            if v is None:
                i = index(*q)
                v = (f[i], f[i + 1], f[i + 2])
            for c in range(3):
                acc[c] += v[c]
        vals[(x, y)] = [a / 4 for a in acc]
for (x, y), v in vals.items():
    i = index(x, y)
    for c in range(3):
        f[i + c] = max(0, min(255, int(v[c] + 0.5)))
open(out, "wb").write(f)
print(len(pts), "pixels filled in")
