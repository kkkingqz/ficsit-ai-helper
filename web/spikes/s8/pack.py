#!/usr/bin/env python3
"""Собирает автономный каталог страницы нагрузки S8."""

import argparse
import hashlib
import io
from pathlib import Path
import shutil
import tarfile
from urllib.request import urlopen


SOURCE = Path(__file__).resolve().parent
UPLOT_URL = "https://registry.npmjs.org/uplot/-/uplot-1.6.32.tgz"
UPLOT_SHA256 = "4b8a8191e425658e3ea8c8c1314b0fc679c861ee3a1af2b20c7b16ba50b5133d"
UPLOT_FILES = ("LICENSE", "dist/uPlot.min.css", "dist/uPlot.iife.min.js")
PAGE_FILES = ("load.html", "load.css", "load.js")


def pack(destination, archive):
    if destination.exists():
        raise FileExistsError(destination)

    if archive is None:
        with urlopen(UPLOT_URL, timeout=20) as response:
            contents = response.read(1024 * 1024)
    else:
        contents = archive.read_bytes()

    if hashlib.sha256(contents).hexdigest() != UPLOT_SHA256:
        raise ValueError("SHA-256 архива uPlot не совпадает с закреплённым значением")

    destination.mkdir()
    try:
        for name in PAGE_FILES:
            shutil.copyfile(SOURCE / name, destination / name)

        vendor = destination / "third_party" / "uplot"
        vendor.mkdir(parents=True)
        with tarfile.open(fileobj=io.BytesIO(contents), mode="r:gz") as package:
            for name in UPLOT_FILES:
                with package.extractfile(f"package/{name}") as file:
                    (vendor / Path(name).name).write_bytes(file.read())

        (vendor / "CHANGES.md").write_text(
            f"# uPlot 1.6.32\n\nИсходный архив: {UPLOT_URL}\n\n"
            "Лицензия: MIT, см. LICENSE. Изменений в файлах нет.\n",
            encoding="utf-8",
        )
    except BaseException:
        shutil.rmtree(destination)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path, help="Новый каталог поставки")
    parser.add_argument("--archive", type=Path, help="Локальный архив uPlot 1.6.32 для сборки без сети")
    args = parser.parse_args()
    try:
        pack(args.output, args.archive)
    except (OSError, ValueError) as error:
        parser.exit(1, f"S8: {error}\n")
    print(args.output / "load.html")


if __name__ == "__main__":
    main()
