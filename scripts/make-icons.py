#!/usr/bin/env python3
"""Builds the app icons from icons/source/app-icon.png (a full-bleed square picture).

    python3 scripts/make-icons.py        # needs Pillow: pip3 install pillow

  apple-touch-icon.png    180 px, full-bleed (iOS adds its own rounded corners)
  icon-192.png / -512.png rounded corners, transparent outside (Android "any", favicon, install dialog)
  icon-maskable-512.png   the picture shrunk onto a soft backdrop, so Android's circle / squircle
                          masks never cut into the artwork (it keeps to the central ~70%)
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "icons"
SRC = Image.open(OUT / "source" / "app-icon.png").convert("RGB")
CORNER = 0.2237  # iOS-style corner radius as a fraction of the icon's width


def fit(img, size):
    return img.resize((size, size), Image.LANCZOS)


def rounded_mask(size, radius=CORNER):
    scale = 4  # draw big, shrink: smooth, anti-aliased edges
    big = Image.new("L", (size * scale, size * scale), 0)
    ImageDraw.Draw(big).rounded_rectangle([0, 0, size * scale - 1, size * scale - 1], radius=radius * size * scale, fill=255)
    return big.resize((size, size), Image.LANCZOS)


def rounded(size):
    icon = fit(SRC, size).convert("RGBA")
    icon.putalpha(rounded_mask(size))
    return icon


def maskable(size, scale=0.72):
    backdrop = fit(SRC, size).filter(ImageFilter.GaussianBlur(size * 0.05))
    inner = round(size * scale)
    offset = (size - inner) // 2
    mask = rounded_mask(inner)
    shadow = Image.new("L", (size, size), 0)
    shadow.paste(mask.point(lambda v: int(v * 0.38)), (offset, offset + round(size * 0.012)))
    shadow = shadow.filter(ImageFilter.GaussianBlur(size * 0.022))
    canvas = backdrop.convert("RGBA")
    canvas.paste(Image.new("RGBA", (size, size), (70, 48, 12, 255)), (0, 0), shadow)
    canvas.paste(fit(SRC, inner), (offset, offset), mask)
    return canvas.convert("RGB")


OUTPUTS = {
    "apple-touch-icon.png": fit(SRC, 180),
    "icon-192.png": rounded(192),
    "icon-512.png": rounded(512),
    "icon-maskable-512.png": maskable(512),
}
for name, image in OUTPUTS.items():
    image.save(OUT / name, optimize=True)
    print(f"icons/{name} ({image.size[0]}x{image.size[1]})")
