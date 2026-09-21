"""Verifikasi rujukan silang antar dokumen perencanaan KATAVIS.

Memeriksa:
  1. Setiap ID kasus uji (TC-*) yang dirujuk terdefinisi di TEST-PLAN.md
  2. Setiap ADR yang dirujuk memiliki berkasnya
  3. Setiap tautan berkas relatif menunjuk berkas yang ada

Keluar dengan kode 1 bila ada rujukan menggantung.
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TEST_PLAN = ROOT / "docs" / "testing" / "TEST-PLAN.md"

TC_PATTERN = re.compile(r"\bTC-[A-Z0-9]+(?:-[A-Z0-9]+)*-\d+\b")
ADR_PATTERN = re.compile(r"\bADR-(\d{3})\b")
LINK_PATTERN = re.compile(r"\[[^\]]*\]\((?!https?://)([^)#]+)\)")


def markdown_files():
    skip = {".agents", ".git", "node_modules", ".serena"}
    for path in ROOT.rglob("*.md"):
        if not any(part in skip for part in path.parts):
            yield path


def defined_test_ids():
    """ID dianggap terdefinisi bila muncul sebagai sel pertama baris tabel."""
    text = TEST_PLAN.read_text(encoding="utf-8")
    defined = set()
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped.startswith("|"):
            continue
        first_cell = stripped.split("|")[1].strip()
        match = TC_PATTERN.fullmatch(first_cell)
        if match:
            defined.add(first_cell)
    return defined


def check_test_ids(defined):
    problems = []
    for path in markdown_files():
        rel = path.relative_to(ROOT)
        for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            for tc_id in TC_PATTERN.findall(line):
                if tc_id not in defined:
                    problems.append(f"{rel}:{number} merujuk {tc_id} yang tidak terdefinisi")
    return problems


def check_adr_refs():
    available = {
        ADR_PATTERN.search(p.name).group(1)
        for p in (ROOT / "docs" / "adr").glob("ADR-*.md")
        if ADR_PATTERN.search(p.name)
    }
    problems = []
    for path in markdown_files():
        rel = path.relative_to(ROOT)
        for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            for adr_number in ADR_PATTERN.findall(line):
                if adr_number not in available:
                    problems.append(f"{rel}:{number} merujuk ADR-{adr_number} yang tidak ada")
    return problems


def check_links():
    problems = []
    for path in markdown_files():
        rel = path.relative_to(ROOT)
        for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            for target in LINK_PATTERN.findall(line):
                resolved = (path.parent / target.strip()).resolve()
                if not resolved.exists():
                    problems.append(f"{rel}:{number} menautkan {target} yang tidak ada")
    return problems


def main():
    defined = defined_test_ids()
    print(f"ID kasus uji terdefinisi di TEST-PLAN.md: {len(defined)}")

    problems = check_test_ids(defined) + check_adr_refs() + check_links()

    print()
    if problems:
        print(f"GAGAL — {len(problems)} rujukan menggantung:")
        for problem in problems:
            print(f"  - {problem}")
        return 1

    print("LOLOS — seluruh rujukan silang menunjuk sasaran yang ada")
    return 0


if __name__ == "__main__":
    sys.exit(main())
