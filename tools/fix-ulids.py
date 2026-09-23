"""Memperbaiki literal ULID yang tidak sah menurut `UlidSchema`.

Mengapa ini ada
---------------

`UlidSchema` di `lib/schemas.ts` menuntut dua hal sekaligus:

    .length(26)
    .regex(/^[0-9A-HJKMNP-TV-Z]{26}$/)

Literal ULID yang ditulis tangan mudah melanggar keduanya, dan tetap
terlihat benar bagi mata manusia. Penolakannya pun terjadi jauh dari tempat
literal itu ditulis.

Akibatnya pernah nyata dan mahal. Id pengrajin pada data semai berbunyi
`01J8ZQFX9K7YWVTN3MABCDU01` — 25 karakter dan memuat `U`, padahal alfabet
Crockford sengaja membuang `I`, `L`, `O`, dan `U` supaya tidak tertukar
dengan `1`, `1`, `0`, dan `V`. Akibatnya `verifyJwt` menolak setiap access
token yang diterbitkan untuk pengrajin itu, dan seluruh rute `session`
menjawab `401 UNAUTHENTICATED`. Gejalanya tidak menunjuk sama sekali ke id
tersebut: yang terlihat hanya "sesi berakhir" pada setiap permintaan,
sementara `POST /auth/refresh` tetap berhasil karena jalurnya tidak melewati
pemeriksaan yang sama.

Dua karakter kurang tepat, satu alur demo mati total — dan tidak ada pesan
galat yang mengarahkan ke sana.

Cara kerjanya
-------------

Dua perbaikan, dalam urutan ini:

1. Setiap karakter di luar alfabet Crockford diganti menurut tabel di
   `SUBSTITUTES`. Penggantinya dipilih agar tetap menyerupai aslinya
   (`I` -> `1`, `L` -> `1`, `O` -> `0`, `U` -> `V`), sehingga literalnya
   masih dapat dikenali oleh orang yang sudah terbiasa melihatnya.
2. Panjang dilengkapi menjadi tepat 26 karakter. Karakter tambahan
   dihitung dari karakter terakhir dan selalu berada di dalam alfabet.

Kedua langkah bersifat deterministik: menjalankan skrip dua kali pada
berkas yang sama tidak mengubah apa pun lagi.

    python tools/fix-ulids.py            # periksa saja, tidak menulis
    python tools/fix-ulids.py --apply    # tulis perbaikan

Tanpa argumen, skrip ini hanya melaporkan dan keluar dengan kode 1 bila ada
yang perlu diperbaiki — sehingga dapat dipakai sebagai gerbang di CI.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

# Alfabet Crockford base32 yang diterima `UlidSchema`. Perhatikan: I, L, O,
# dan U tidak ada di sini — itulah inti masalahnya.
CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

# Karakter yang dilarang dan penggantinya.
#
# Crockford membuang keempat huruf ini justru karena bentuknya menyerupai
# angka. Menggantinya dengan angka yang mirip membuat id tetap terbaca
# seperti aslinya, alih-alih menjadi urutan acak yang sulit dicocokkan
# dengan catatan lama.
SUBSTITUTES = {"I": "1", "L": "1", "O": "0", "U": "V"}

# Kandidat literal ULID.
#
# Polanya sengaja PERMISIF — `[A-Z0-9]`, bukan alfabet Crockford. Versi
# pertama skrip ini memakai alfabet yang ketat, sehingga justru tidak pernah
# menemukan literal yang memuat karakter terlarang: satu-satunya kelas
# kesalahan yang paling perlu ditemukan. Pemindai yang hanya mencari apa
# yang sudah benar tidak akan menemukan apa pun.
CANDIDATE = re.compile(r"\b01[A-Z0-9]{20,27}\b")

SCAN_SUFFIXES = {".ts", ".tsx", ".sql", ".md", ".sh", ".json", ".jsonc", ".js"}

SKIP_DIRS = {
    "node_modules",
    ".git",
    ".next",
    ".wrangler",
    "coverage",
    "test-output",
    "dist",
    "build",
    # Profil Chrome milik Studio Agent memuat ekstensi pihak ketiga yang
    # diabaikan git. Isinya bukan milik proyek ini dan tidak boleh disentuh.
    "chrome-profile",
    "Extensions",
}

# Literal yang sengaja tidak sah.
#
# `lib/schemas.test.ts` menguji bahwa ULID 25 karakter, 27 karakter, dan
# yang memuat `I` semuanya DITOLAK. Memperbaikinya akan membuat uji itu
# lulus tanpa membuktikan apa pun lagi — persis jenis pelemahan uji yang
# dilarang AGENTS.md. Yang salah di situ bukan literalnya, melainkan
# anggapan skrip ini bahwa setiap ULID yang cacat adalah kekeliruan.
INTENTIONAL = {
    "01J8ZQFX9K7YWVTN3MABCDEFG",   # kasus negatif: 25 karakter
    "01J8ZQFX9K7YWVTN3MABCDEFGHI",  # kasus negatif: 27 karakter
    "01J8ZQFX9K7YWVTN3MABCDEFGI",  # kasus negatif: memuat I
}


def repair(value: str) -> str:
    """Mengembalikan nilai yang sah menurut `UlidSchema`.

    Karakter terlarang diganti lebih dulu, lalu panjangnya dilengkapi.
    Urutan ini penting: melengkapi lebih dulu akan menyisipkan karakter
    tambahan di sebelah karakter terlarang, dan penggantian berikutnya
    menghasilkan id yang lebih sulit dibaca.
    """
    cleaned = "".join(SUBSTITUTES.get(ch, ch) for ch in value)
    while len(cleaned) < 26:
        index = CROCKFORD.index(cleaned[-1])
        cleaned += CROCKFORD[(index + 1) % len(CROCKFORD)]
    return cleaned[:26]


def is_valid(value: str) -> bool:
    return len(value) == 26 and all(ch in CROCKFORD for ch in value)


def candidate_files(root: Path) -> list[Path]:
    found: list[Path] = []
    for path in root.rglob("*"):
        if path.is_dir():
            continue
        if any(part in SKIP_DIRS for part in path.parts):
            continue
        if path.suffix in SCAN_SUFFIXES:
            found.append(path)
    return sorted(found)


def describe(value: str) -> str:
    """Alasan penolakan, supaya laporannya dapat langsung dibaca."""
    reasons = []
    if len(value) != 26:
        reasons.append(f"panjang {len(value)}")
    illegal = "".join(sorted({ch for ch in value if ch not in CROCKFORD}))
    if illegal:
        reasons.append(f"karakter terlarang {illegal}")
    return ", ".join(reasons)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="tulis perbaikan")
    parser.add_argument("--root", default=".", help="akar pencarian")
    args = parser.parse_args()

    root = Path(args.root).resolve()
    findings: dict[Path, list[tuple[str, str]]] = {}

    for path in candidate_files(root):
        try:
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue

        for match in CANDIDATE.finditer(text):
            value = match.group(0)

            # Potongan, bukan literal utuh.
            #
            # `01J8ZQFX9K7YWVTN3MABCDP${...}` adalah awalan yang panjangnya
            # memang belum 26 — sisa id-nya dibuat saat program berjalan.
            # Memperpanjangnya menghasilkan `...ABCDPQRS002`, dan uji yang
            # membandingkan dengan `...ABCDP002` gagal. Nilai seperti itu
            # tidak dapat diperbaiki dari sini; yang perlu diperiksa adalah
            # tempat rangkaiannya disusun.
            tail = text[match.end() : match.end() + 2]
            if tail.startswith("${"):
                continue

            if is_valid(value) or value in INTENTIONAL:
                continue
            findings.setdefault(path, []).append((value, repair(value)))

    if not findings:
        print("Semua literal ULID sudah sah menurut UlidSchema.")
        return 0

    total = sum(len(pairs) for pairs in findings.values())
    print(f"Ditemukan {total} literal ULID yang tidak sah:\n")
    for path in sorted(findings):
        print(f"  {path.relative_to(root)}")
        for old, new in findings[path]:
            print(f"      {old}  ({describe(old)})")
            print(f"        -> {new}")
    print()

    if not args.apply:
        print("Jalankan dengan --apply untuk menulis perbaikan.")
        return 1

    for path, pairs in findings.items():
        text = path.read_text(encoding="utf-8")
        for old, new in pairs:
            text = re.sub(rf"\b{re.escape(old)}\b", new, text)
        path.write_text(text, encoding="utf-8", newline="")
        print(f"  diperbaiki: {path.relative_to(root)}")

    print(f"\n{len(findings)} berkas diperbaiki.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
