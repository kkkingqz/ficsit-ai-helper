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
        if tag == "tr" and self.in_table_body and dict(attributes).get("class") != "generator-group":
            self.rows += 1

    def handle_endtag(self, tag):
        if tag == "tbody":
            self.in_table_body = False


def check_generator_groups(html, total_generation):
    groups = re.findall(r"<tbody[^>]*>(.*?)</tbody>", html, re.S)
    names = []
    total_output = 0
    for group in groups:
        summary = re.search(
            r'<th scope="rowgroup">([^<]+)</th><td>(\d+) / (\d+) running</td><td>(\d+)</td>', group,
        )
        assert summary, "У группы генераторов отсутствует заголовок с итогами"
        name, running, total, output = summary.groups()
        rows = re.findall(r'<td class="(running|standby)">[^<]+</td><td>(\d+)</td>', group)
        assert int(total) == len(rows) == 4
        assert int(running) == sum(state == "running" for state, _ in rows) == 3
        assert int(output) == sum(int(value) for _, value in rows)
        names.append(name)
        total_output += int(output)
    assert names == ["Coal", "Fuel", "Geothermal"], names
    assert total_output == total_generation


def browser_dom(chrome, profile, size, url):
    result = subprocess.run(
        [chrome, "--headless", "--no-first-run", "--disable-background-networking",
         "--enable-logging=stderr", f"--user-data-dir={profile}", f"--window-size={size}",
         "--virtual-time-budget=2400", "--dump-dom", url],
        capture_output=True, text=True, check=True, timeout=30,
    )
    assert not re.search(r'CONSOLE.*(?:Uncaught|violates.*Content Security Policy)', result.stderr), result.stderr
    return result.stdout


def check_page(chrome, bundle, profile, size, points, query):
    html = browser_dom(chrome, profile, size, (bundle / "load.html").as_uri() + query)
    page = Workload(html)
    assert (page.charts, page.tiles, page.rows) == (2, 8, 12)
    assert re.findall(r'class="chart-meta">(\d+) samples per series</span>', html) == [str(points)] * 2
    tick = re.search(r'id="elapsed"[^>]*>\+(\d+) s</output>', html)
    assert tick and int(tick[1]) >= 2, "Обновление телеметрии с частотой 1 Гц не наблюдалось"
    generation = re.search(r'Generation</h2><p class="metric-value"><span class="metric-number">(\d+)</span>', html)
    assert generation and int(generation[1]) != 555, "Значение генерации осталось начальным"
    check_generator_groups(html, int(generation[1]))
    print(f"{size}, {points} точек: два графика, восемь плиток, 12 генераторов в трёх группах, обновление 1 Гц")


def check_scroll(chrome, bundle, profile):
    # Запускаем ту же страницу, но удлиняем список после рендера штатной нагрузки.
    html = (bundle / "load.html").read_text(encoding="utf-8")
    probe = bundle / "scroll-test.html"
    probe.write_text(html.replace("</head>", '<script defer src="scroll-test.js"></script>\n</head>'), encoding="utf-8")
    (bundle / "scroll-test.js").write_text('''
const table = document.querySelector("#generator-table");
const viewport = table.closest(".scroll-panel__body");
if (viewport) {
  const group = table.tBodies[0];
  for (let index = 0; index < 12; index += 1) table.append(group.cloneNode(true));
  const header = table.tHead;
  const title = document.querySelector("#equipment-title");
  const titleTop = title.getBoundingClientRect().top;
  const pageTop = window.scrollY;
  viewport.focus({ preventScroll: true });
  viewport.scrollTop = viewport.scrollHeight;
  const bounds = viewport.getBoundingClientRect();
  const style = getComputedStyle(viewport);
  document.body.dataset.scrollTest = String(
    viewport.tabIndex === 0 && document.activeElement === viewport && viewport.scrollTop > 0 &&
    bounds.bottom <= innerHeight && Math.abs(header.getBoundingClientRect().top - bounds.top) < 2 &&
    title.getBoundingClientRect().top === titleTop && window.scrollY === pageTop);
  document.body.dataset.scrollbarTheme = String(style.scrollbarWidth === "thin" &&
    style.scrollbarColor === "rgb(100, 130, 156) rgb(10, 23, 36)");
}
''', encoding="utf-8")
    for size in ("1280,720", "1010,540"):
        actual = browser_dom(chrome, profile, size, probe.as_uri())
        assert 'data-scroll-test="true"' in actual, f"{size}: длинный список не прокручивается внутри панели"
        assert 'data-scrollbar-theme="true"' in actual, f"{size}: полоса прокрутки не использует палитру D-2"
        print(f"{size}: панель получает фокус и прокручивается, заголовки остаются на месте")


def main():
    chrome = sys.argv[1] if len(sys.argv) > 1 else "google-chrome"
    with tempfile.TemporaryDirectory(prefix=".s8-smoke-", dir=SOURCE) as temp:
        temp = Path(temp)
        bundle = temp / "bundle"
        packer = SOURCE / "pack.py"
        assert packer.is_file(), "Отсутствует сборщик локальной поставки S8"
        subprocess.run([sys.executable, str(packer), str(bundle)], check=True, timeout=30)
        check_scroll(chrome, bundle, temp / "chrome")
        for size, points, query in (
            ("1280,720", 60, ""),
            ("1280,720", 300, "?points=300"),
            ("1920,1080", 600, "?points=600"),
            ("1280,720", 60, "?points=999"),
        ):
            check_page(chrome, bundle, temp / "chrome", size, points, query)


if __name__ == "__main__":
    main()
