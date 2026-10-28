# Generates build/icon.png (1024) and build/icon.ico.
# Same look as Aurora's icon: a rounded square with a violet -> pink -> sky diagonal
# gradient and a solid white glyph (here: a sun over two soft mountain peaks).
import os
from PIL import Image, ImageDraw, ImageFilter

S = 1024
SS = 4                      # supersampling factor
N = S * SS
OUT = os.path.join(os.path.dirname(__file__), "..", "build")

STOPS = [(0.00, (148, 96, 240)), (0.50, (243, 112, 181)), (1.00, (94, 173, 234))]

def grad(t):
    for (t0, c0), (t1, c1) in zip(STOPS, STOPS[1:]):
        if t0 <= t <= t1:
            f = (t - t0) / (t1 - t0)
            return tuple(round(c0[i] + (c1[i] - c0[i]) * f) for i in range(3))
    return STOPS[-1][1]

# gradient, drawn small then scaled up (it is smooth anyway)
g = Image.new("RGB", (256, 256))
p = g.load()
for y in range(256):
    for x in range(256):
        p[x, y] = grad((x + y) / 510)
g = g.resize((N, N), Image.BICUBIC)

# rounded-square mask
inset, radius = 0.039 * N, 0.205 * N
sq = Image.new("L", (N, N), 0)
ImageDraw.Draw(sq).rounded_rectangle((inset, inset, N - inset, N - inset), radius=radius, fill=255)

# glyph mask: mountains are polygons whose corners get rounded by blur + threshold
def U(v):
    return v * SS

glyph = Image.new("L", (N, N), 0)
d = ImageDraw.Draw(glyph)
base = U(735)
d.polygon([(U(232), base), (U(452), U(408)), (U(672), base)], fill=255)    # big peak
d.polygon([(U(540), base), (U(668), U(545)), (U(800), base)], fill=255)    # small peak
d.rectangle((U(232), base - U(60), U(800), base), fill=255)                # ground
r = 46 * SS
round_r = 34 * SS
glyph = glyph.filter(ImageFilter.GaussianBlur(round_r)).point(lambda v: 255 if v > 128 else 0)
# soften the bottom edge the same way the peaks are, then add the sun
d = ImageDraw.Draw(glyph)
cx, cy, sr = U(668), U(360), U(62)
d.ellipse((cx - sr, cy - sr, cx + sr, cy + sr), fill=255)

icon = Image.new("RGBA", (N, N), (0, 0, 0, 0))
icon.paste(g, (0, 0), sq)
white = Image.new("RGBA", (N, N), (255, 255, 255, 255))
icon.paste(white, (0, 0), glyph)
icon.putalpha(sq)
icon = icon.resize((S, S), Image.LANCZOS)

os.makedirs(OUT, exist_ok=True)
icon.save(os.path.join(OUT, "icon.png"))
icon.resize((512, 512), Image.LANCZOS).save(os.path.join(OUT, "icon-512.png"))
icon.save(os.path.join(OUT, "icon.ico"), sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print("ok")
