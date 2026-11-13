import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDemoSource } from "../src/dev/demo-source.js";
import { startDevServer, type DevServer } from "../src/dev/server.js";
import { createApi } from "../src/facade.js";
import { createHttpTransport } from "../src/http.js";
import { ApiError } from "../src/types.js";

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
    expect(status).toMatchObject({ apiVersion: "0.4.0", source: "fixture", inert: false });

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
