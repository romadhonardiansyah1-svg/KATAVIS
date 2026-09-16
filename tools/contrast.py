"""Verifikasi rasio kontras token warna KATAVIS terhadap tabel di DESIGN.md.

Keluar dengan kode 1 bila ada pasangan yang menyimpang dari nilai harapan atau
turun di bawah tingkat WCAG yang dijanjikan. Dipakai sebagai gerbang CI (TC-A11Y-02).
"""

import sys

PALETTE = {
    "clay-900": "#2E1F17",
    "clay-700": "#5A3E2B",
    "clay-200": "#E8DCCF",
    "clay-50": "#FAF6F0",
    "indigo-800": "#1F3A5F",
    "indigo-600": "#2E5A8A",
    "rattan-500": "#B8834A",
    "moss-700": "#3D5A3D",
    "rust-700": "#8B3A2F",
}

# (teks, latar): (rasio harapan, tingkat minimum yang dijanjikan DESIGN.md)
# "AAA"     -> >= 7.0   teks normal
# "AAA-big" -> >= 4.5   teks besar >=24px
# "NONTEXT" -> >= 3.0   border, ikon, fill
EXPECTED = {
    ("clay-900", "clay-50"): (14.73, "AAA"),
    ("clay-900", "clay-200"): (11.75, "AAA"),
    ("clay-200", "clay-900"): (11.75, "AAA"),
    ("clay-50", "clay-900"): (14.73, "AAA"),
    ("indigo-800", "clay-50"): (10.67, "AAA"),
    ("clay-50", "indigo-800"): (10.67, "AAA"),
    ("indigo-800", "clay-200"): (8.51, "AAA"),
    ("clay-700", "clay-50"): (9.04, "AAA"),
    ("clay-700", "clay-200"): (7.21, "AAA"),
    ("moss-700", "clay-50"): (7.15, "AAA"),
    ("rust-700", "clay-50"): (7.11, "AAA"),
    ("indigo-600", "clay-50"): (6.62, "NONTEXT"),
    ("moss-700", "clay-200"): (5.71, "AAA-big"),
    ("rust-700", "clay-200"): (5.67, "AAA-big"),
    ("rattan-500", "clay-900"): (4.82, "AAA-big"),
    ("rattan-500", "clay-50"): (3.06, "NONTEXT"),
}

FLOOR = {"AAA": 7.0, "AAA-big": 4.5, "NONTEXT": 3.0}

TOLERANCE = 0.02
MAX_SATURATION = 0.70  # DESIGN.md bagian 3 melarang saturasi di atas ini


def srgb_to_linear(channel):
    c = channel / 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def parse_hex(hex_color):
    h = hex_color.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def luminance(hex_color):
    r, g, b = parse_hex(hex_color)
    return (
        0.2126 * srgb_to_linear(r)
        + 0.7152 * srgb_to_linear(g)
        + 0.0722 * srgb_to_linear(b)
    )


def contrast_ratio(hex_a, hex_b):
    lo, hi = sorted((luminance(hex_a), luminance(hex_b)))
    return (hi + 0.05) / (lo + 0.05)


def saturation(hex_color):
    r, g, b = (c / 255.0 for c in parse_hex(hex_color))
    hi, lo = max(r, g, b), min(r, g, b)
    if hi == 0:
        return 0.0
    return (hi - lo) / hi


def check_contrast():
    failures = []
    print(f"{'teks':<12} {'latar':<12} {'terukur':>8} {'harapan':>8} {'tingkat':<9} hasil")
    print("-" * 66)
    for (fg, bg), (expected, level) in EXPECTED.items():
        actual = contrast_ratio(PALETTE[fg], PALETTE[bg])
        drifted = abs(actual - expected) > TOLERANCE
        below_floor = actual < FLOOR[level]
        ok = not drifted and not below_floor
        print(
            f"{fg:<12} {bg:<12} {actual:>7.2f}:1 {expected:>7.2f}:1 {level:<9} "
            f"{'OK' if ok else 'GAGAL'}"
        )
        if drifted:
            failures.append(
                f"{fg} di atas {bg}: terukur {actual:.2f}:1, "
                f"tabel DESIGN.md menyebut {expected:.2f}:1"
            )
        if below_floor:
            failures.append(
                f"{fg} di atas {bg}: {actual:.2f}:1 di bawah ambang {level} "
                f"({FLOOR[level]}:1)"
            )
    return failures


def check_saturation():
    failures = []
    for name, hex_color in PALETTE.items():
        s = saturation(hex_color)
        if s > MAX_SATURATION:
            failures.append(
                f"{name} saturasi {s:.0%}, melebihi batas {MAX_SATURATION:.0%} "
                f"di DESIGN.md bagian 3"
            )
    return failures


def check_pairs_covered():
    """Setiap token wajib muncul minimal sekali di EXPECTED, agar token baru
    tidak bisa ditambahkan tanpa diukur."""
    used = {token for pair in EXPECTED for token in pair}
    missing = sorted(set(PALETTE) - used)
    return [f"token {name} tidak punya pasangan terukur di EXPECTED" for name in missing]


def main():
    failures = check_contrast() + check_saturation() + check_pairs_covered()

    print()
    if failures:
        print(f"GAGAL — {len(failures)} masalah:")
        for f in failures:
            print(f"  - {f}")
        return 1

    print(f"LOLOS — {len(EXPECTED)} pasangan sesuai tabel DESIGN.md")
    return 0


if __name__ == "__main__":
    sys.exit(main())
