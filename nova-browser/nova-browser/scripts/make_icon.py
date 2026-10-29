#!/usr/bin/env python3
"""توليد أيقونة NOVA Browser (build/icon.png) — نجمة متوهجة فوق تدرّج بنفسجي/أزرق.
الاستخدام: python3 scripts/make_icon.py
"""
import math
import os
from PIL import Image, ImageDraw, ImageFilter

SIZE = 1024
OUT = os.path.join(os.path.dirname(__file__), "..", "build", "icon.png")


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def main():
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # خلفية: مربع دائري بتدرّج قطري
    grad = Image.new("RGBA", (SIZE, SIZE))
    gd = ImageDraw.Draw(grad)
    c1, c2, c3 = (124, 92, 255), (40, 60, 200), (56, 182, 255)
    for y in range(SIZE):
        for x_step in range(0, SIZE, 8):
            t = (x_step + y) / (2 * SIZE)
            col = lerp(c1, c2, t * 2) if t < 0.5 else lerp(c2, c3, (t - 0.5) * 2)
            gd.rectangle([x_step, y, x_step + 8, y], fill=col + (255,))
    mask = Image.new("L", (SIZE, SIZE), 0)
    ImageDraw.Draw(mask).rounded_rectangle([24, 24, SIZE - 24, SIZE - 24], radius=230, fill=255)
    img.paste(grad, (0, 0), mask)
    draw = ImageDraw.Draw(img)
    draw.rounded_rectangle([24, 24, SIZE - 24, SIZE - 24], radius=230,
                           outline=(255, 255, 255, 70), width=6)

    # حلقة مدارية
    draw.ellipse([SIZE * 0.16, SIZE * 0.16, SIZE * 0.84, SIZE * 0.84],
                 outline=(255, 255, 255, 55), width=10)

    # نجمة رباعية (شعار NOVA)
    cx = cy = SIZE / 2
    R, r = SIZE * 0.30, SIZE * 0.075
    pts = []
    for i in range(8):
        ang = math.pi / 2 + i * math.pi / 4
        rad = R if i % 2 == 0 else r
        pts.append((cx + rad * math.cos(ang), cy - rad * math.sin(ang)))

    glow = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    ImageDraw.Draw(glow).polygon(pts, fill=(190, 200, 255, 200))
    glow = glow.filter(ImageFilter.GaussianBlur(28))
    img.alpha_composite(glow)

    draw = ImageDraw.Draw(img)
    draw.polygon(pts, fill=(255, 255, 255, 255))

    # نقطة مدارية صغيرة
    ox, oy, orad = SIZE * 0.76, SIZE * 0.24, SIZE * 0.045
    draw.ellipse([ox - orad, oy - orad, ox + orad, oy + orad], fill=(120, 220, 255, 255))

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    img.save(OUT)
    print("saved", os.path.abspath(OUT), img.size)


if __name__ == "__main__":
    main()
