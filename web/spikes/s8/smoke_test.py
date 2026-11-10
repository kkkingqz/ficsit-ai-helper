#!/usr/bin/env python3
"""Проверяет поставку S8 в локальном Chromium без сервера и сайдкара."""

from html.parser import HTMLParser
from pathlib import Path
import re
import subprocess
import sys
import tempfile


SOURCE = Path(__file__).resolve().parent


class Workload(HTMLParser):
    def __init__(self, html):
        super().__init__()
        self.charts = 0
        self.tiles = 0
        self.rows = 0
        self.in_table_body = False
        self.feed(html)

    def handle_starttag(self, tag, attributes):
        if tag == "canvas":
            self.charts += 1
        if "metric" in dict(attributes).get("class", "").split():
            self.tiles += 1
        if tag == "tbody":
            self.in_table_body = True
        if tag == "tr" and self.in_table_body:
            self.rows += 1

    def handle_endtag(self, tag):
        if tag == "tbody":
            self.in_table_body = False


def check_page(chrome, bundle, profile, size, points, query):
    url = (bundle / "load.html").as_uri() + query
    result = subprocess.run(
        [chrome, "--headless", "--no-first-run", "--disable-background-networking",
         "--enable-logging=stderr", f"--user-data-dir={profile}", f"--window-size={size}",
         "--virtual-time-budget=2400", "--dump-dom", url],
        capture_output=True, text=True, check=True, timeout=30,
    )
    assert not re.search(r'CONSOLE.*(?:Uncaught|violates.*Content Security Policy)', result.stderr), result.stderr
    page = Workload(result.stdout)
    assert (page.charts, page.tiles, page.rows) == (2, 8, 12)
    assert re.findall(r'class="chart-meta">(\d+) samples per series</span>', result.stdout) == [str(points)] * 2
    tick = re.search(r'id="elapsed"[^>]*>\+(\d+) s</output>', result.stdout)
    assert tick and int(tick[1]) >= 2, "Обновление телеметрии с частотой 1 Гц не наблюдалось"
    generation = re.search(r'Generation</h2><p class="metric-value"><span class="metric-number">(\d+)</span>', result.stdout)
    assert generation and int(generation[1]) != 555, "Значение генерации осталось начальным"
    print(f"{size}, {points} точек: два графика, восемь плиток, 12 строк, обновление 1 Гц")


def main():
    chrome = sys.argv[1] if len(sys.argv) > 1 else "google-chrome"
    with tempfile.TemporaryDirectory(prefix=".s8-smoke-", dir=SOURCE) as temp:
        temp = Path(temp)
        bundle = temp / "bundle"
        packer = SOURCE / "pack.py"
        assert packer.is_file(), "Отсутствует сборщик локальной поставки S8"
        subprocess.run([sys.executable, str(packer), str(bundle)], check=True, timeout=30)
        for size, points, query in (
            ("1280,720", 60, ""),
            ("1280,720", 300, "?points=300"),
            ("1920,1080", 600, "?points=600"),
            ("1280,720", 60, "?points=999"),
        ):
            check_page(chrome, bundle, temp / "chrome", size, points, query)


if __name__ == "__main__":
    main()
