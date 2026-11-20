"""Generate Trainer PWA icons (flat Nordic barbell mark) with no dependencies."""

import struct
import zlib
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "public" / "icons"
OUT.mkdir(parents=True, exist_ok=True)

PRIMARY = (0x26, 0x3B, 0xAA)
SURFACE = (0xF7, 0xF8, 0xF9)
DARK = (0x10, 0x14, 0x18)
ACCENT = (0x8F, 0xA8, 0xBE)
SS = 4  # supersampling factor


def write_png(path: Path, width: int, height: int, pixels: bytes) -> None:
    raw = b"".join(
        b"\x00" + pixels[y * width * 4 : (y + 1) * width * 4] for y in range(height)
    )

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9))
    png += chunk(b"IEND", b"")
    path.write_bytes(png)


def rounded_rect_coverage(x: float, y: float, radius: float) -> float:
    """Coverage for a unit square [0,1]^2 with rounded corners."""
    cx = min(max(x, radius), 1 - radius)
    cy = min(max(y, radius), 1 - radius)
    dx = x - cx
    dy = y - cy
    if dx * dx + dy * dy <= radius * radius:
        return 1.0
    return 0.0


def box_hit(x: float, y: float, x0: float, y0: float, x1: float, y1: float) -> bool:
    return x0 <= x <= x1 and y0 <= y <= y1


def mark_hit(x: float, y: float) -> bool:
    """A centred barbell: bar, two tall plates and two short outer plates."""
    if box_hit(x, y, 0.00, 0.470, 1.00, 0.530):
        return True
    if box_hit(x, y, 0.145, 0.170, 0.245, 0.830):
        return True
    if box_hit(x, y, 0.755, 0.170, 0.855, 0.830):
        return True
    if box_hit(x, y, 0.025, 0.310, 0.100, 0.690):
        return True
    if box_hit(x, y, 0.900, 0.310, 0.975, 0.690):
        return True
    return False


def render(size: int, rounded: bool, maskable: bool) -> bytes:
    out = bytearray()
    radius = 0.22
    # Normal icons use most of the square. Maskable icons keep a 20% safe margin.
    content_scale = 0.60 if maskable else 0.78
    offset = (1 - content_scale) / 2
    background = DARK if maskable else SURFACE
    foreground = ACCENT if maskable else PRIMARY

    for y in range(size):
        for x in range(size):
            r = g = b = a = 0.0
            for sy in range(SS):
                for sx in range(SS):
                    ux = (x + (sx + 0.5) / SS) / size
                    uy = (y + (sy + 0.5) / SS) / size

                    inside = 1.0 if (maskable or not rounded) else rounded_rect_coverage(ux, uy, radius)
                    if inside == 0.0:
                        continue

                    mx = (ux - offset) / content_scale
                    my = (uy - offset) / content_scale
                    colour = foreground if (0.0 <= mx <= 1.0 and 0.0 <= my <= 1.0 and mark_hit(mx, my)) else background

                    r += colour[0] / 255
                    g += colour[1] / 255
                    b += colour[2] / 255
                    a += inside

            samples = SS * SS
            out += bytes(
                (
                    int(round(255 * r / samples)),
                    int(round(255 * g / samples)),
                    int(round(255 * b / samples)),
                    int(round(255 * a / samples)),
                )
            )

    return bytes(out)


def main() -> None:
    targets = [
        ("trainer-192.png", 192, True, False),
        ("trainer-512.png", 512, True, False),
        ("trainer-maskable-512.png", 512, False, True),
    ]
    for name, size, rounded, maskable in targets:
        pixels = render(size, rounded, maskable)
        write_png(OUT / name, size, size, pixels)
        print(f"wrote {OUT / name}")


if __name__ == "__main__":
    main()
