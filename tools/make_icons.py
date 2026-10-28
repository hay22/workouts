"""Draws the app icon: a bone-white dumbbell on the Headquarters near-black.

    python tools/make_icons.py

The outputs are committed alongside the app, so this only needs running again
if the design changes.
"""

from pathlib import Path

from PIL import Image, ImageDraw

INK = (8, 9, 10, 255)
BONE = (237, 234, 227, 255)
OUT = Path(__file__).resolve().parent.parent / "icons"
S = 1024  # drawn large, then scaled down for clean edges


def draw(fill: float) -> Image.Image:
    """fill is how much of the tile's width the dumbbell spans."""
    img = Image.new("RGBA", (S, S), INK)
    d = ImageDraw.Draw(img)
    w = S * fill
    x0 = (S - w) / 2
    cy = S / 2
    u = w / 20  # one unit; the dumbbell is 20 units wide

    def bar(x, width, height, r):
        d.rounded_rectangle((x0 + x * u, cy - height * u / 2, x0 + (x + width) * u, cy + height * u / 2), radius=r * u, fill=BONE)

    bar(5, 10, 1.6, 0.6)  # the handle
    for x in (2.6, 15.0):  # inner plates
        bar(x, 2.4, 10, 0.9)
    for x in (0.4, 17.4):  # outer plates
        bar(x, 2.2, 6.6, 0.9)
    return img


def save(img: Image.Image, name: str, size: int) -> None:
    img.resize((size, size), Image.LANCZOS).convert("RGB").save(OUT / name, optimize=True)


OUT.mkdir(exist_ok=True)
regular = draw(0.62)
save(regular, "apple-touch-icon.png", 180)
save(regular, "favicon-64.png", 64)
save(regular, "icon-192.png", 192)
save(regular, "icon-512.png", 512)
# Android crops maskable icons to a circle, so the mark sits inside the safe zone.
save(draw(0.5), "icon-maskable-512.png", 512)
print("icons written to", OUT)
