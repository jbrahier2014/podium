"""Generate the Podium app icon, favicon and iPhone launch screens.

Run:  python tools/make_icons.py      (needs Pillow: pip install pillow)
Outputs go to assets/icons and assets/splash.

The mark geometry matches js/ui/brand.js (drawn from the logo guidelines).
Replace both with the official logo geometry when the logo files arrive.
"""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
ICONS = ROOT / "assets" / "icons"
SPLASH = ROOT / "assets" / "splash"
ICONS.mkdir(parents=True, exist_ok=True)
SPLASH.mkdir(parents=True, exist_ok=True)

BRAND_VIOLET = (0x7C, 0x5C, 0xFF)
WHITE = (255, 255, 255)
INK_DARK_GROUND = (0xF5, 0xF5, 0xF2)   # blocks on Arena
INK_LIGHT_GROUND = (0x11, 0x12, 0x14)  # blocks on Daylight
GROUND_DARK = (0x11, 0x12, 0x14)
GROUND_LIGHT = (0xF5, 0xF5, 0xF2)

# viewBox 0..100 — second, first, third; dot over the tallest
BLOCKS = [(0, 48, 28, 52), (36, 28, 28, 72), (72, 64, 28, 36)]
DOT = (50, 10, 10)  # cx, cy, r
SS = 4  # supersampling for smooth edges


def draw_mark(d, x0, y0, size, ink, dot):
    s = size / 100
    for (x, y, w, h) in BLOCKS:
        d.rectangle([x0 + x * s, y0 + y * s, x0 + (x + w) * s - 1, y0 + (y + h) * s - 1], fill=ink)
    cx, cy, r = DOT
    d.ellipse([x0 + (cx - r) * s, y0 + (cy - r) * s, x0 + (cx + r) * s, y0 + (cy + r) * s], fill=dot)


def app_icon(px, mark_ratio=0.5):
    """White mark on a full brand-violet field (all white on violet)."""
    big = px * SS
    img = Image.new("RGB", (big, big), BRAND_VIOLET)
    d = ImageDraw.Draw(img)
    m = big * mark_ratio
    draw_mark(d, (big - m) / 2, (big - m) / 2, m, WHITE, WHITE)
    return img.resize((px, px), Image.LANCZOS)


app_icon(180).save(ICONS / "apple-touch-icon.png")
app_icon(192).save(ICONS / "icon-192.png")
app_icon(512).save(ICONS / "icon-512.png")
app_icon(512, mark_ratio=0.4).save(ICONS / "icon-maskable-512.png")  # inside the maskable safe zone
app_icon(32, mark_ratio=0.62).save(ICONS / "favicon-32.png")

# SVG favicon (same design)
rects = "".join(f'<rect x="{25 + x * 0.5}" y="{25 + y * 0.5}" width="{w * 0.5}" height="{h * 0.5}" fill="#fff"/>' for x, y, w, h in BLOCKS)
(ICONS / "icon.svg").write_text(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
    '<rect width="100" height="100" fill="#7C5CFF"/>'
    f'{rects}<circle cx="{25 + DOT[0] * 0.5}" cy="{25 + DOT[1] * 0.5}" r="{DOT[2] * 0.5}" fill="#fff"/></svg>\n')

# Launch screens: (width, height) in device pixels. The mark alone, centered, on
# each theme's ground. (The stacked logo needs the official wordmark file.)
SIZES = [(1320, 2868), (1206, 2622), (1290, 2796), (1179, 2556), (1284, 2778),
         (1170, 2532), (1125, 2436), (828, 1792), (750, 1334)]
for w, h in SIZES:
    for mode, ground, ink in (("dark", GROUND_DARK, INK_DARK_GROUND), ("light", GROUND_LIGHT, INK_LIGHT_GROUND)):
        img = Image.new("RGB", (w * 2, h * 2), ground)
        d = ImageDraw.Draw(img)
        m = w * 2 * 0.2
        draw_mark(d, (w * 2 - m) / 2, (h * 2 - m) / 2 - h * 2 * 0.02, m, ink, BRAND_VIOLET)
        img.resize((w, h), Image.LANCZOS).save(SPLASH / f"splash-{w}x{h}-{mode}.png", optimize=True)

print("Icons and launch screens written.")
