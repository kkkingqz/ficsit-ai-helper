import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDemoSource } from "../src/dev/demo-source.js";
import { startDevServer, type DevServer } from "../src/dev/server.js";
import { createApi } from "../src/facade.js";
import { createHttpTransport } from "../src/http.js";
import { API_VERSION, ApiError } from "../src/types.js";

/**
 * Dev-сервер и фасад поверх HTTP: тот же экран, что в игре, но в браузере.
 *
 * Проверки идут через настоящий слушатель и настоящий `fetch`: предмет
 * проверки — конверт, коды контракта и раздача файлов, а не вызовы функций.
 */

const servers: DevServer[] = [];
afterEach(async () => {
  while (servers.length > 0) await servers.pop()?.close();
});

async function serve(files: Record<string, string> = {}): Promise<DevServer> {
  const root = mkdtempSync(join(tmpdir(), "ficsitai-screens-"));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(root, name), content);
  const server = await startDevServer({
    root,
    source: createDemoSource(),
    port: 0,
    watch: false,
    log: () => {},
  });
  servers.push(server);
  return server;
}

const apiFor = (server: DevServer) =>
  createApi({ transport: createHttpTransport({ baseUrl: server.url, events: false }) });

describe("фасад поверх dev-сервера", () => {
  it("статус, каталог и значение приходят формами контракта", async () => {
    const api = apiFor(await serve());
    expect(api.transport).toBe("http");

    const status = await api.getStatus();
    expect(status).toMatchObject({ apiVersion: API_VERSION, source: "fixture", inert: false });

    const catalog = await api.listMetrics();
    expect(catalog.metrics.map((metric) => metric.id)).toContain("power.production");
    expect(catalog.nextCursor).toBe("");

    const value = await api.queryMetric({ metricId: "power.production" });
    expect(value).toMatchObject({ kind: "value", state: "value", unit: "megawatt" });
    expect(typeof value.value).toBe("number");
  });

  it("неприменимое значение доходит прочерком, а не нулём", async () => {
    const api = apiFor(await serve());
    const value = await api.queryMetric({
      metricId: "power.network.battery_time_to_empty",
      scopeId: "2",
    });
    // Правило контракта: value равен null тогда и только тогда, когда
    // состояние notApplicable (Gs-13). Фасад ничего не подставляет.
    expect(value.state).toBe("notApplicable");
    expect(value.value).toBeNull();
  });

  it("ряд несёт времена точек, и по ним виден пропуск", async () => {
    const api = apiFor(await serve());
    const series = await api.querySeries({ metricId: "power.production", window: "last5Min" });
    expect(series.kind).toBe("series");
    expect(series.values).toHaveLength(series.timestamps.length);
    const gaps = series.timestamps.filter(
      (time, index) => index > 0 && time - (series.timestamps[index - 1] as number) > series.intervalSec,
    );
    expect(gaps.length).toBeGreaterThan(0);
  });

  it("области отдаются страницами, и курсор не взаимозаменяем", async () => {
    const api = apiFor(await serve());
    const first = await api.listScopes({ metricId: "items.produced", pageSize: 25 });
    expect(first.scopes).toHaveLength(25);
    expect(first.nextCursor).not.toBe("");

    const second = await api.listScopes({ metricId: "items.produced", cursor: first.nextCursor });
    expect(second.scopes[0]?.scopeId).not.toBe(first.scopes[0]?.scopeId);

    await expect(
      api.listMetrics({ metricId: "items.produced", scopeCursor: "m:0" }),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
  });

  it("коды ошибок контракта доходят как есть", async () => {
    const api = apiFor(await serve());
    await expect(api.queryMetric({ metricId: "нет.такой" })).rejects.toMatchObject({
      code: "UNKNOWN_METRIC",
    });
    await expect(api.queryMetric({ metricId: "items.produced" })).rejects.toMatchObject({
      code: "SCOPE_REQUIRED",
    });
    await expect(
      api.queryMetric({ metricId: "items.produced", scopeId: "нет" }),
    ).rejects.toMatchObject({ code: "SCOPE_NOT_FOUND" });
    await expect(
      api.querySeries({ metricId: "power.network.battery_time_to_empty", window: "last5Min" }),
    ).rejects.toMatchObject({ code: "SERIES_NOT_AVAILABLE" });
    await expect(api.listMetrics({ scopeFilter: "x" })).rejects.toMatchObject({
      code: "INVALID_ARGUMENT",
    });
  });

  it("незнакомый запрос — UNKNOWN_OP, а не молчание", async () => {
    const server = await serve();
    const response = await fetch(`${server.url}/api/v0`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "m-1", op: "deleteEverything", args: {} }),
    });
    expect(await response.json()).toMatchObject({ re: "m-1", error: { code: "UNKNOWN_OP" } });
  });

  it("ошибка приходит как ApiError", async () => {
    const api = apiFor(await serve());
    const error = await api.queryMetric({ metricId: "нет" }).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(ApiError);
  });
});

describe("раздача страниц", () => {
  it("отдаёт файл и клиент перезагрузки", async () => {
    const server = await serve({ "index.html": "<!doctype html><title>экран</title>" });
    const page = await fetch(`${server.url}/index.html`);
    expect(page.headers.get("content-type")).toContain("text/html");
    expect(await page.text()).toContain("экран");
    // Кэш браузера сделал бы горячую перезагрузку бессмысленной.
    expect(page.headers.get("cache-control")).toBe("no-store");

    const client = await fetch(`${server.url}/api/v0/reload.js`);
    expect(await client.text()).toContain("location.reload");
  });

  it("каталог отдаётся как index.html", async () => {
    const server = await serve({ "index.html": "<!doctype html>корень" });
    expect(await (await fetch(`${server.url}/`)).text()).toContain("корень");
  });

  it("выход за корень закрыт", async () => {
    const server = await serve();
    const response = await fetch(`${server.url}/../../etc/passwd`, { redirect: "manual" });
    expect([403, 404]).toContain(response.status);
  });
});

describe("поток событий", () => {
  it("перезагрузка приходит событием при правке файла", async () => {
    const root = mkdtempSync(join(tmpdir(), "ficsitai-screens-watch-"));
    writeFileSync(join(root, "index.html"), "первый");
    const server = await startDevServer({
      root,
      source: createDemoSource(),
      port: 0,
      log: () => {},
    });
    servers.push(server);

    const stream = await fetch(`${server.url}/api/v0/events`);
    const reader = (stream.body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    let text = "";

    const until = async (needle: string): Promise<void> => {
      const stop = Date.now() + 3000;
      while (!text.includes(needle)) {
        if (Date.now() > stop) throw new Error(`не дождался «${needle}»: ${text}`);
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
      }
    };

    await until("event: ready");
    writeFileSync(join(root, "index.html"), "второй");
    await until("event: reload");
    void reader.cancel();
  });
});

describe("события источника доходят до страницы", () => {
  /** Минимальный `EventSource` поверх fetch: в Node своего нет. */
  class NodeEventSource {
    private readonly handlers = new Map<string, (event: { data?: string }) => void>();
    private stopped = false;

    public constructor(url: string) {
      void this.pump(url);
    }

    private async pump(url: string): Promise<void> {
      const response = await fetch(url);
      const reader = (response.body as ReadableStream<Uint8Array>).getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (!this.stopped) {
        const { done, value } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        let split = buffer.indexOf("\n\n");
        while (split >= 0) {
          const block = buffer.slice(0, split);
          buffer = buffer.slice(split + 2);
          split = buffer.indexOf("\n\n");
          const name = /^event: (.+)$/m.exec(block)?.[1];
          const data = /^data: (.+)$/m.exec(block)?.[1];
          if (name !== undefined) {
            this.handlers.get(name)?.(data === undefined ? {} : { data });
          }
        }
      }
      void reader.cancel();
    }

    public addEventListener(type: string, handler: (event: { data?: string }) => void): void {
      this.handlers.set(type, handler);
    }

    public close(): void {
      this.stopped = true;
    }
  }

  it("снимок приходит подписчику фасада", async () => {
    const server = await serve();
    const api = createApi({
      transport: createHttpTransport({
        baseUrl: server.url,
        eventSourceImpl: NodeEventSource,
      }),
    });

    const seen = await new Promise<{ sessionTimeSec: number }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("снимок не пришёл за 8 с")), 8000);
      api.on("metrics.snapshot", (data) => {
        clearTimeout(timer);
        resolve(data);
      });
    });

    expect(seen.sessionTimeSec).toBeGreaterThan(0);
    api.close();
  }, 10000);
});

describe("замечания ревью Gs на #53: dev-сервер", () => {
  it("чужой re в ответе не принимается за свой", async () => {
    const server = await serve();
    const api = createApi({
      transport: createHttpTransport({
        baseUrl: server.url,
        events: false,
        // Подменяем ответ: сервер отвечает правильно, но посередине что-то
        // перепутало корреляцию. На мосту это правило есть, и здесь должно быть.
        fetchImpl: async () =>
          new Response(JSON.stringify({ re: "чужой", body: { kind: "value", value: 99 } }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      }),
    });
    await expect(api.queryMetric({ metricId: "power.production" })).rejects.toMatchObject({
      code: "TRANSPORT_UNAVAILABLE",
    });
  });

  it("тело null и чужое окно ряда получают код контракта", async () => {
    const server = await serve();
    const bad = await fetch(`${server.url}/api/v0`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "null",
    });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: { code: "INVALID_ARGUMENT" } });

    const window = await fetch(`${server.url}/api/v0`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "m-1",
        op: "querySeries",
        args: { metricId: "power.production", window: "за всё время" },
      }),
    });
    // Браузерная отладка не должна пропускать то, что игровой API отклонит.
    expect(await window.json()).toMatchObject({ error: { code: "INVALID_ARGUMENT" } });
  });

  it("символическая ссылка из корня наружу не отдаётся", async () => {
    const outside = mkdtempSync(join(tmpdir(), "ficsitai-outside-"));
    writeFileSync(join(outside, "secret.txt"), "чужое содержимое");
    const root = mkdtempSync(join(tmpdir(), "ficsitai-screens-link-"));
    symlinkSync(join(outside, "secret.txt"), join(root, "link.txt"));
    const server = await startDevServer({
      root,
      source: createDemoSource(),
      port: 0,
      watch: false,
      log: () => {},
    });
    servers.push(server);

    const response = await fetch(`${server.url}/link.txt`);
    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain("чужое содержимое");
  });
});

describe("врезки каталогов", () => {
  /**
   * Экран может ссылаться за пределы корня страниц: «Статистика» просит
   * uPlot из `third_party/` рядом с `web/`. С одним корнем либо он, либо
   * `ui-kit/` отдавал 404 — на это ушёл мой прогон на ревью #59.
   */
  it("файл из врезки отдаётся, а корень страниц остаётся корнем", async () => {
    const root = mkdtempSync(join(tmpdir(), "ficsitai-screens-mount-"));
    const vendor = mkdtempSync(join(tmpdir(), "ficsitai-vendor-"));
    writeFileSync(join(root, "index.html"), "<!doctype html><title>страница</title>");
    writeFileSync(join(vendor, "uPlot.min.css"), ".uplot{}");
    const server = await startDevServer({
      root,
      mounts: { "/third_party/uplot": vendor },
      source: createDemoSource(),
      port: 0,
      watch: false,
      log: () => {},
    });
    servers.push(server);

    const vendored = await fetch(`${server.url}/third_party/uplot/uPlot.min.css`);
    expect(vendored.status).toBe(200);
    expect(await vendored.text()).toContain(".uplot");

    const page = await fetch(`${server.url}/index.html`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("страница");

    // Мимо врезки — обычный 404 из корня страниц, а не файл вендора.
    expect((await fetch(`${server.url}/third_party/other/uPlot.min.css`)).status).toBe(404);
  });

  it("врезка выбирается по адресному пути, а не по пути файловой системы", async () => {
    // На Windows `path.normalize` меняет прямые слеши на обратные, и
    // `/third_party/uplot/…` перестал бы совпадать с префиксом: запрос
    // uPlot уходил бы в корень страниц и получал 404 (ревью Gs на #66).
    // Проверяем это свойство напрямую: выбор идёт по пути URL, и лишние
    // сегменты адреса его не ломают.
    const root = mkdtempSync(join(tmpdir(), "ficsitai-screens-url-"));
    const vendor = mkdtempSync(join(tmpdir(), "ficsitai-vendor-url-"));
    writeFileSync(join(vendor, "uPlot.min.css"), ".uplot{}");
    const server = await startDevServer({
      root,
      mounts: { "/third_party/uplot": vendor },
      source: createDemoSource(),
      port: 0,
      watch: false,
      log: () => {},
    });
    servers.push(server);

    for (const url of [
      "/third_party/uplot/uPlot.min.css",
      "/third_party/uplot/./uPlot.min.css",
      "/third_party/uplot//uPlot.min.css",
      "/third_party/uplot/%75Plot.min.css",
    ]) {
      const response = await fetch(`${server.url}${url}`);
      expect(response.status, url).toBe(200);
      expect(await response.text()).toContain(".uplot");
    }
  });

  it("врезка без каталога не поднимается: `resolve(\"\")` открыл бы каталог запуска", async () => {
    const root = mkdtempSync(join(tmpdir(), "ficsitai-screens-empty-"));
    await expect(
      startDevServer({
        root,
        mounts: { "/third_party": "" },
        source: createDemoSource(),
        port: 0,
        watch: false,
        log: () => {},
      }),
    ).rejects.toThrow(/без каталога/);
  });

  it("выход за каталог врезки закрыт так же, как выход за корень", async () => {
    const root = mkdtempSync(join(tmpdir(), "ficsitai-screens-mount-esc-"));
    const outside = mkdtempSync(join(tmpdir(), "ficsitai-outside-mount-"));
    const vendor = join(outside, "vendor");
    mkdirSync(vendor);
    writeFileSync(join(outside, "secret.txt"), "чужое содержимое");
    symlinkSync(join(outside, "secret.txt"), join(vendor, "link.txt"));
    const server = await startDevServer({
      root,
      mounts: { "/vendor": vendor },
      source: createDemoSource(),
      port: 0,
      watch: false,
      log: () => {},
    });
    servers.push(server);

    // Путь строкой: `..` из врезки.
    const climbed = await fetch(`${server.url}/vendor/../secret.txt`);
    expect(await climbed.text()).not.toContain("чужое содержимое");
    // И ссылкой — защита, которую Gs нашёл на #53, работает и во врезке.
    const linked = await fetch(`${server.url}/vendor/link.txt`);
    expect(linked.status).toBe(403);
    expect(await linked.text()).not.toContain("чужое содержимое");
  });
});

describe("повторное ревью Gs на #53", () => {
  const post = (server: DevServer, body: string) =>
    fetch(`${server.url}/api/v0`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });

  it("конверт без id и с args: null до источника не доходит", async () => {
    const server = await serve();

    const noId = await post(server, JSON.stringify({ op: "getStatus", args: {} }));
    expect(noId.status).toBe(400);
    expect(await noId.json()).toMatchObject({ error: { code: "INVALID_ARGUMENT" } });

    // `args: null` — не «аргументов нет», а битый конверт.
    const nullArgs = await post(server, JSON.stringify({ id: "m-1", op: "getStatus", args: null }));
    expect(nullArgs.status).toBe(400);
    expect(await nullArgs.json()).toMatchObject({ error: { code: "INVALID_ARGUMENT" } });
  });

  it("ответ без body и без error — ошибка транспорта, а не сырой TypeError", async () => {
    const server = await serve();
    const api = createApi({
      transport: createHttpTransport({
        baseUrl: server.url,
        events: false,
        fetchImpl: async (_url, init) => {
          const { id } = JSON.parse(String((init as RequestInit).body)) as { id: string };
          return new Response(JSON.stringify({ re: id }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        },
      }),
    });
    await expect(api.getStatus()).rejects.toBeInstanceOf(ApiError);
    await expect(api.getStatus()).rejects.toMatchObject({ code: "TRANSPORT_UNAVAILABLE" });
  });

  it("битый адрес запроса не уносит процесс", async () => {
    const server = await serve({ "index.html": "<!doctype html><title>экран</title>" });
    const { port } = server;

    const answer = await new Promise<string>((resolve, reject) => {
      const socket = connect(port, "127.0.0.1", () => {
        // Сырой запрос, который `new URL` разобрать не может.
        socket.write("GET //[ HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n");
      });
      let text = "";
      socket.on("data", (chunk: Buffer) => (text += chunk.toString("utf8")));
      socket.on("end", () => resolve(text));
      socket.on("error", reject);
    });
    expect(answer).toContain("400");

    // Главное: сервер жив и отвечает дальше.
    const status = await apiFor(server).getStatus();
    expect(status.saveId).toBe("demo-save");
  });

  it("ряд требует область так же, как значение", async () => {
    const api = apiFor(await serve());

    await expect(
      api.querySeries({ metricId: "items.produced", window: "last5Min" }),
    ).rejects.toMatchObject({ code: "SCOPE_REQUIRED" });

    await expect(
      api.querySeries({ metricId: "items.produced", scopeId: "нет-такой", window: "last5Min" }),
    ).rejects.toMatchObject({ code: "SCOPE_NOT_FOUND" });
  });

  it("scopeFilter применяется до выбора страницы", async () => {
    const api = apiFor(await serve());
    const result = await api.listMetrics({ metricId: "items.produced", scopeFilter: "такого нет" });
    // Раньше приходила полная страница областей — отладка в браузере
    // показывала то, чего живой API не вернёт.
    expect(result.metrics[0]?.availableScopes).toEqual([]);
    expect(result.metrics[0]?.scopesTruncated).toBe(false);

    const found = await api.listMetrics({ metricId: "items.produced", scopeFilter: "item 7" });
    expect(found.metrics[0]?.availableScopes.map((scope) => scope.displayName)).toEqual(["Item 7"]);
  });
});

describe("третий круг ревью Gs на #53", () => {
  it("фабричная метрика не принимает выдуманную область", async () => {
    const api = apiFor(await serve());

    // Областей у метрики нет — но это не значит, что годится любой scopeId:
    // ранний выход в общей проверке возвращал его же в ответе.
    await expect(
      api.queryMetric({ metricId: "power.production", scopeId: "bogus" }),
    ).rejects.toMatchObject({ code: "SCOPE_NOT_FOUND" });
    await expect(
      api.querySeries({ metricId: "power.production", scopeId: "bogus", window: "last5Min" }),
    ).rejects.toMatchObject({ code: "SCOPE_NOT_FOUND" });

    // Без области та же метрика читается как раньше.
    expect((await api.queryMetric({ metricId: "power.production" })).scopeId).toBe("");
  });

  it("body: null — ошибка транспорта, а не сырой TypeError", async () => {
    const server = await serve();
    const api = createApi({
      transport: createHttpTransport({
        baseUrl: server.url,
        events: false,
        fetchImpl: async (_url, init) => {
          const { id } = JSON.parse(String((init as RequestInit).body)) as { id: string };
          return new Response(JSON.stringify({ re: id, body: null }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        },
      }),
    });
    await expect(api.getStatus()).rejects.toBeInstanceOf(ApiError);
    await expect(api.getStatus()).rejects.toMatchObject({ code: "TRANSPORT_UNAVAILABLE" });
  });

  it("фасад отклоняет не-объект и от чужого транспорта", async () => {
    // Экран может принести свой транспорт — проверка стоит и в фасаде.
    const api = createApi({
      transport: {
        kind: "http",
        call: async () => null,
        on: () => () => {},
        close: () => {},
      },
      checkApiVersion: false,
    });
    await expect(api.getStatus()).rejects.toMatchObject({ code: "TRANSPORT_UNAVAILABLE" });
  });
});
