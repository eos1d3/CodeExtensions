#!/usr/bin/env python3
# Generates icon.png (256x256, full-bleed) for the Build Tasks extension.
# Drawn at 4x and downscaled for clean anti-aliasing. No SVG renderer needed.
from PIL import Image, ImageDraw

S = 4
W = 256 * S
DARK = (27, 31, 39)        # #1B1F27 background
CHIP = (35, 41, 54)        # #232936 chip body fill
BLUE = (79, 193, 255)      # #4FC1FF rounded square outline / chevron
WHITE = (255, 255, 255)

img = Image.new("RGB", (W, W), DARK)
d = ImageDraw.Draw(img)

# blue rounded square (bbox padded so the stroke lands on 64..192)
d.rounded_rectangle([59 * S, 59 * S, 197 * S, 197 * S], radius=28 * S,
                    fill=CHIP, outline=BLUE, width=10 * S)

# play triangle
d.polygon([(96 * S, 104 * S), (128 * S, 128 * S), (96 * S, 152 * S)], fill=WHITE)

# chevron with round caps
pts = [(142 * S, 110 * S), (160 * S, 128 * S), (142 * S, 146 * S)]
d.line(pts, fill=BLUE, width=13 * S, joint="curve")
r = 6.5 * S
for p in (pts[0], pts[2]):
    d.ellipse([p[0] - r, p[1] - r, p[0] + r, p[1] + r], fill=BLUE)

img = img.resize((256, 256), Image.LANCZOS)
img.save("icon.png")
print("icon.png written")
