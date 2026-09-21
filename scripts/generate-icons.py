#!/usr/bin/env python3
"""
Generates every icon and splash asset in assets/ from one definition.

The Press mark is a flagstick standing in the cup. Its geometry is declared
once, in mark units, and each asset is that same shape under a different
canvas, scale and fill — so the iOS icon, the splash and the three Android
adaptive layers cannot drift apart. The colours are read out of
src/theme/tokens.ts at run time rather than copied here, for the same reason.

Run by hand after changing the mark or the palette; it is not part of the
build, and its only dependency is Pillow:

    pip install Pillow && python3 scripts/generate-icons.py
"""
import math
import pathlib
import re

from PIL import Image, ImageDraw

ROOT = pathlib.Path(__file__).resolve().parent.parent


def token(name: str) -> tuple:
    """Pull one hex colour out of the app's token file, as RGB."""
    source = (ROOT / "src/theme/tokens.ts").read_text()
    match = re.search(rf"^\s*{name}:\s*'#([0-9A-Fa-f]{{6}})'", source, re.M)
    if not match:
        raise SystemExit(f"token {name!r} not found in src/theme/tokens.ts")
    h = match.group(1)
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


INK = token("ink")                  # #F2EFE6  paper white
ACCENT = token("accent")            # #8BE0AE  the green
CARD_ACTIVE = token("cardActive")   # #16211A
BASE = token("base")                # #0A0E0B

SS = 4  # supersample, then LANCZOS down — Pillow has no analytic AA

# --- the mark, in mark units --------------------------------------------
HW = 27.0                    # stem half-width
STEM_TOP, STEM_BOT = 180.0, 832.0
FLAG_LEFT = -20.0            # tucked behind the stem so no corner peeks out
FLAG_TOP, FLAG_BOT = 210.0, 500.0
TIP_X, TIP_Y, TIP_R = 404.0, 350.0, 13.0
FLY_CTRL = (196.0, 432.0)    # pulls the fly edge concave, as cloth hangs
CUP_RX, CUP_RY, CUP_Y = 104.0, 26.0, 858.0
CUP_ALPHA = 215

# Android adaptive icons guarantee only a centred circle of 66dp on a 108dp
# canvas. Key content outside it can be masked away on some launchers.
SAFE_R = 33.0 / 108.0


def _bezier(p0, p1, p2, n=64):
    return [((1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0],
             (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1])
            for t in (i / n for i in range(n + 1))]


def _pennant():
    """Straight leading edge to the tip, concave fly edge back to the stem."""
    tip_x = TIP_X - TIP_R
    pts = [(FLAG_LEFT, FLAG_TOP), (tip_x, TIP_Y - TIP_R)]
    pts += _bezier((tip_x, TIP_Y + TIP_R), FLY_CTRL, (FLAG_LEFT, FLAG_BOT))
    return pts


PENNANT = _pennant()
_xs = [p[0] for p in PENNANT] + [-HW, HW, TIP_X, -CUP_RX, CUP_RX]
_ys = [p[1] for p in PENNANT] + [STEM_TOP, STEM_BOT, CUP_Y - CUP_RY, CUP_Y + CUP_RY]
L, R, T, B = min(_xs), max(_xs), min(_ys), max(_ys)
BW, BH = R - L, B - T


def safe_height_frac(margin=0.95):
    """Tallest the mark can be while its bbox still fits the safe circle."""
    return margin * SAFE_R * 2 * BH / math.hypot(BW, BH)


def _field(s):
    """The dark field: cardActive into base, corner to corner."""
    ramp = Image.new("L", (256, 256))
    ramp.putdata([min(255, (x + y) * 255 // 510)
                  for y in range(256) for x in range(256)])
    return Image.composite(Image.new("RGB", (s, s), BASE),
                           Image.new("RGB", (s, s), CARD_ACTIVE),
                           ramp.resize((s, s), Image.BICUBIC))


def render(path, size, height_frac, *, field, stem, flag, cup, opaque):
    s = size * SS
    im = (_field(s).convert("RGBA") if field
          else Image.new("RGBA", (s, s), (0, 0, 0, 0)))

    if height_frac > 0:
        sc = (height_frac * s) / BH
        cx = cy = s / 2
        X = lambda x: cx + (x - (L + BW / 2)) * sc
        Y = lambda y: cy + (y - (T + BH / 2)) * sc

        layer = Image.new("RGBA", (s, s), (0, 0, 0, 0))
        d = ImageDraw.Draw(layer)
        d.ellipse([X(-CUP_RX), Y(CUP_Y - CUP_RY), X(CUP_RX), Y(CUP_Y + CUP_RY)],
                  fill=cup)
        d.polygon([(X(x), Y(y)) for x, y in PENNANT], fill=flag)
        d.ellipse([X(TIP_X - 2 * TIP_R), Y(TIP_Y - TIP_R),
                   X(TIP_X), Y(TIP_Y + TIP_R)], fill=flag)
        d.rounded_rectangle([X(-HW), Y(STEM_TOP), X(HW), Y(STEM_BOT)],
                            radius=HW * sc, fill=stem)
        im.alpha_composite(layer)

    im = im.resize((size, size), Image.LANCZOS)
    im.convert("RGB" if opaque else "RGBA").save(path)
    print(f"  {pathlib.Path(path).name:30} {size}x{size}  {'opaque' if opaque else 'alpha'}")


COLOUR = dict(stem=INK + (255,), flag=ACCENT + (255,), cup=ACCENT + (CUP_ALPHA,))
WHITE = dict(stem=(255,) * 4, flag=(255,) * 4, cup=(255,) * 4)
A = str(ROOT / "assets") + "/"
safe = safe_height_frac()
print(f"mark bbox {BW:.0f}x{BH:.0f}  android safe-zone height fraction {safe:.3f}")

# iOS will reject an icon that carries an alpha channel.
render(A + "icon.png", 1024, 0.66, field=True, opaque=True, **COLOUR)
# Splash art sits on the plugin's #0C120E, so it ships transparent.
render(A + "splash-icon.png", 1024, 0.58, field=False, opaque=False, **COLOUR)
render(A + "android-icon-foreground.png", 512, safe, field=False, opaque=False, **COLOUR)
render(A + "android-icon-background.png", 512, 0.0, field=True, opaque=True, **COLOUR)
# Themed icons tint the alpha channel, so this layer is a flat silhouette.
render(A + "android-icon-monochrome.png", 432, safe, field=False, opaque=False, **WHITE)
render(A + "favicon.png", 48, 0.66, field=True, opaque=True, **COLOUR)
