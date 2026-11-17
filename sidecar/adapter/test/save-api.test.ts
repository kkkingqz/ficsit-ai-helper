import type { AddressInfo } from "node:net";
import { request as httpRequest, type Server } from "node:http";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { createSaveApi, type SaveApi } from "../src/save-api.js";
import { loadConfig, saveSourceConfigured, type Config } from "../src/config.js";
import type { Logger } from "../src/log.js";

/**
 * Поверхность чтения API v0 по сохранению (§8.5, §13).
 *
 * Библиотека Cf3 здесь подменена: предмет проверки — конверт, отбор
 * операций и перевод ошибки, а разбор `.sav` покрыт у неё самой и требует
 * сборок Foreman на диске. Конверт настоящий: тот же, что у моста и у
 * dev-сервера, иначе экран, отлаженный в браузере, встретил бы здесь другую
 * форму.
 */

const quiet: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

/** Ошибка библиотеки: свой класс с тем же телом, что у контракта. */
class FicsitAIApiError extends Error {
  public readonly code: string;
  public readonly details: Record<string, unknown> | undefined;

  public constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "FicsitAIApiError";
    this.code = code;
    this.details = details;
  }
}

const status = {
  apiVersion: "0.4.0",
  saveId: "save_a_starter",
  source: "save",
  inert: false,
  lastSnapshotSessionTimeSec: 3600,
  sidecarConnected: false,
  apiVersionMismatch: "",
  reason: "",
};

function config(overrides: Partial<Config> = {}): Config {
  const base = loadConfig({
    ADAPTER_TOKEN: "0123456789abcdef0123",
    FICSITAI_SAVE_FILE: "/несуществующий/save_a_starter.sav",
  } as NodeJS.ProcessEnv);
  return { ...base, ...overrides };
}

interface Started {
  url: string;
  port: number;
  /** Слушатель уже закрыт самой проверкой. */
  closed?: boolean;
  api: SaveApi;
  server: Server;
  /** Чем библиотеку позвали. */
  passed: Record<string, unknown>[];
  calls: string[];
}

const started: Started[] = [];

afterEach(async () => {
  while (started.length > 0) {
    const item = started.pop();
    item?.api.close();
    if (item?.closed === true) continue;
    await new Promise<void>((done) => item?.server.close(() => done()));
  }
});

async function serve(
  behaviour: Partial<Record<string, (args: Record<string, unknown>) => unknown>> = {},
  overrides: Partial<Config> = {},
): Promise<Started> {
  const passed: Record<string, unknown>[] = [];
  const calls: string[] = [];

  // Слушатель поднимается первым: проверка `Host` сверяет порт с настройкой,
  // поэтому настройка должна знать тот порт, на котором мы слушаем.
  const app = express();
  app.use(express.json());
  const server = await new Promise<Server>((done) => {
    const listener = app.listen(0, "127.0.0.1", () => done(listener));
  });
  const port = (server.address() as AddressInfo).port;

  const api = await createSaveApi({
    config: config({ port, ...overrides }),
    log: quiet,
    createSource(options) {
      passed.push(options);
      const read = async (name: string, args: Record<string, unknown>): Promise<unknown> => {
        calls.push(name);
        const act = behaviour[name];
        return act === undefined ? status : act(args);
      };
      return {
        getStatus: (args: Record<string, unknown>) => read("getStatus", args),
        listMetrics: (args: Record<string, unknown>) => read("listMetrics", args),
        listScopes: (args: Record<string, unknown>) => read("listScopes", args),
        queryMetric: (args: Record<string, unknown>) => read("queryMetric", args),
        querySeries: (args: Record<string, unknown>) => read("querySeries", args),
      };
    },
  });

  app.use("/api/v0", api.router);
  const item: Started = { url: `http://127.0.0.1:${port}`, port, api, server, passed, calls };
  started.push(item);
  return item;
}

const post = (url: string, body: unknown): Promise<Response> =>
  fetch(`${url}/api/v0`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

/**
 * Запрос со своими заголовками `Host` и `Origin`.
 *
 * Через `node:http`, а не `fetch`: `Host` там подставляется сам, а предмет
 * проверки — именно чужой `Host` (ревью Gs на #67, п. 3).
 */
function raw(
  port: number,
  headers: Record<string, string>,
  body: unknown,
  method = "POST",
  path = "/api/v0",
): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; text: string }> {
  return new Promise((done, fail) => {
    const payload = body === undefined ? "" : JSON.stringify(body);
    const request = httpRequest(
      {
        host: "127.0.0.1",
        port,
        path,
        method,
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(payload),
          ...headers,
        },
      },
      (response) => {
        let text = "";
        response.on("data", (chunk: Buffer) => (text += chunk.toString("utf8")));
        response.on("end", () =>
          done({ status: response.statusCode ?? 0, headers: response.headers, text }),
        );
      },
    );
    request.on("error", fail);
    if (payload !== "") request.write(payload);
    request.end();
  });
}

describe("чтения API v0 по сохранению", () => {
  it("конверт тот же, что у моста: ответ приходит с своим `re`", async () => {
    const { url, calls } = await serve();

    const response = await post(url, { id: "a-1", op: "getStatus", args: {} });
    expect(response.status).toBe(200);
    // Статус договорён до 0.5.0: ассистента у сохранения нет, и экран чата
    // должен это видеть, а не ждать с пустым полем ввода.
    expect(await response.json()).toEqual({
      re: "a-1",
      // Причина обязательна: контракт отводит `reason` именно под неё, и
      // пустое поле оставляло экран без объяснения (ревью Gs на #66).
      body: {
        ...status,
        assistantState: "unavailable",
        reason: "чата у источника Save нет: это снимок сохранения, а не живая игра",
      },
    });
    expect(calls).toEqual(["getStatus"]);
  });

  it("причину источника своей не затираем", async () => {
    const { url } = await serve({
      getStatus: () => ({ ...status, reason: "Save source requires saveFilePath" }),
    });

    const body = (await (await post(url, { id: "a-15", op: "getStatus", args: {} })).json()) as {
      body: { reason: string; assistantState: string };
    };
    expect(body.body.reason).toBe("Save source requires saveFilePath");
    expect(body.body.assistantState).toBe("unavailable");
  });

  it("остальные чтения проходят как есть, без наших полей", async () => {
    const page = { metrics: [], nextCursor: "" };
    const { url } = await serve({ listMetrics: () => page });

    expect(await (await post(url, { id: "a-9", op: "listMetrics", args: {} })).json()).toEqual({
      re: "a-9",
      body: page,
    });
  });

  it("аргументы доходят до библиотеки как есть: правила её, а не наши", async () => {
    const seen: Record<string, unknown>[] = [];
    const { url } = await serve({
      listMetrics: (args) => {
        seen.push(args);
        return { metrics: [], nextCursor: "" };
      },
    });

    await post(url, { id: "a-2", op: "listMetrics", args: { pageSize: 500, scopeFilter: "x" } });
    // Ни `pageSize`, ни зависимость `scopeFilter` от `metricId` мы не
    // проверяем: вторая копия правил контракта разошлась бы с первой.
    expect(seen[0]).toEqual({ pageSize: 500, scopeFilter: "x" });
  });

  it("ошибка библиотеки приходит кодом контракта, с деталями", async () => {
    const { url } = await serve({
      queryMetric: () => {
        throw new FicsitAIApiError("SCOPE_REQUIRED", "нужна область", { scope: "powerNetwork" });
      },
    });

    const response = await post(url, { id: "a-3", op: "queryMetric", args: { metricId: "x" } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      re: "a-3",
      error: {
        code: "SCOPE_REQUIRED",
        message: "нужна область",
        details: { scope: "powerNetwork" },
      },
    });
  });

  it("чужая ошибка кодом контракта не притворяется", async () => {
    // У системной ошибки тоже есть `code` — `ENOENT`. Отдать его экрану как
    // код контракта значило бы соврать о причине.
    const { url } = await serve({
      getStatus: () => {
        throw Object.assign(new Error("нет такого файла"), { code: "ENOENT" });
      },
    });

    const body = (await (await post(url, { id: "a-4", op: "getStatus", args: {} })).json()) as {
      error: { code: string; message: string };
    };
    expect(body.error.code).toBe("SOURCE_UNAVAILABLE");
    expect(body.error.message).toBe("нет такого файла");
  });

  it("запись и чат этой поверхности не принадлежат", async () => {
    const { url, calls } = await serve();

    for (const op of ["chatSend", "applyPlan", "queryMetricUnknown"]) {
      const body = (await (await post(url, { id: `a-${op}`, op, args: {} })).json()) as {
        re: string;
        error: { code: string };
      };
      expect(body.re).toBe(`a-${op}`);
      expect(body.error.code).toBe("UNKNOWN_OP");
    }
    // До библиотеки ни один из них не дошёл.
    expect(calls).toEqual([]);
  });

  it("битый конверт до библиотеки не доходит", async () => {
    const { url, calls } = await serve();

    for (const broken of [
      { op: "getStatus", args: {} },
      { id: "", op: "getStatus", args: {} },
      { id: "a-5", args: {} },
      { id: "a-6", op: "getStatus", args: null },
      { id: "a-7", op: "getStatus", args: [] },
      [1, 2, 3],
    ]) {
      const response = await post(url, broken);
      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: { code: string } };
      expect(body.error.code).toBe("INVALID_ARGUMENT");
    }
    expect(calls).toEqual([]);
  });

  it("пустое тело от библиотеки — ошибка, а не успех без body", async () => {
    // Ответ без `body` и без `error` транспорт страницы читает как
    // `TRANSPORT_UNAVAILABLE` и роняет `getStatus()` сырым `TypeError`
    // (повторное ревью Gs на #53). Отвечаем причиной сами.
    const { url } = await serve({ getStatus: () => null });

    const body = (await (await post(url, { id: "a-8", op: "getStatus", args: {} })).json()) as {
      error: { code: string };
    };
    expect(body.error.code).toBe("SOURCE_UNAVAILABLE");
  });

  it("поток событий открывается и говорит режим, хотя событий не будет", async () => {
    const { url } = await serve();

    const controller = new AbortController();
    const response = await fetch(`${url}/api/v0/events`, { signal: controller.signal });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const reader = response.body?.getReader();
    const chunk = await reader?.read();
    expect(new TextDecoder().decode(chunk?.value)).toContain("event: ready");
    controller.abort();
  });

  it("режим передаётся библиотеке, а путь к файлу — как задан", async () => {
    const { passed } = await serve({}, { saveSourceMode: "saveEstimated" });

    expect(passed[0]).toEqual({
      sourceMode: "saveEstimated",
      saveFilePath: "/несуществующий/save_a_starter.sav",
    });
  });
});

describe("замечания ревью Gs на #67", () => {
  const ALLOWED = "http://127.0.0.1:5173";

  it("чужой Host данных не получает (DNS rebinding)", async () => {
    // Браузер отправит запрос на любое имя, которое разрешается в
    // 127.0.0.1, и чужая страница может навести своё имя на петлю. Прежде
    // сервер отдавал на такой запрос реальные числа сохранения.
    const { port, calls } = await serve();

    const answer = await raw(port, { host: "ficsitai.example.com:1" }, {
      id: "h-1",
      op: "getStatus",
      args: {},
    });
    expect(answer.status).toBe(403);
    expect(answer.text).toContain("чужим Host");
    expect(answer.text).not.toContain("save_a_starter");
    // До библиотеки запрос не дошёл вовсе.
    expect(calls).toEqual([]);
  });

  it("свой Host с чужим origin тоже отказ, а разрешённый — проходит с заголовками", async () => {
    const { port } = await serve({}, { saveAllowOrigins: [ALLOWED] });
    const host = `127.0.0.1:${port}`;

    const stranger = await raw(port, { host, origin: "https://chyzhoi.example" }, {
      id: "h-2",
      op: "getStatus",
      args: {},
    });
    expect(stranger.status).toBe(403);
    expect(stranger.text).toContain("стороннего origin");

    const allowed = await raw(port, { host, origin: ALLOWED }, {
      id: "h-3",
      op: "getStatus",
      args: {},
    });
    expect(allowed.status).toBe(200);
    expect(allowed.headers["access-control-allow-origin"]).toBe(ALLOWED);
    expect(allowed.headers["vary"]).toBe("origin");
  });

  it("предполётный запрос: без разрешения — отказ, с разрешением — 204 и заголовки", async () => {
    const { port } = await serve({}, { saveAllowOrigins: [ALLOWED] });
    const host = `127.0.0.1:${port}`;

    // Прежде Express отвечал на OPTIONS 200 без заголовков доступа — вид
    // разрешения без разрешения.
    const bare = await raw(port, { host }, undefined, "OPTIONS");
    expect(bare.status).toBe(403);

    const stranger = await raw(port, { host, origin: "https://chyzhoi.example" }, undefined, "OPTIONS");
    expect(stranger.status).toBe(403);
    expect(stranger.text).toContain("FICSITAI_SAVE_ALLOW_ORIGIN");

    const allowed = await raw(port, { host, origin: ALLOWED }, undefined, "OPTIONS");
    expect(allowed.status).toBe(204);
    expect(allowed.headers["access-control-allow-origin"]).toBe(ALLOWED);
    expect(allowed.headers["access-control-allow-methods"]).toContain("POST");
  });

  it("по умолчанию из браузера не пускает никого", async () => {
    const { port } = await serve();
    const answer = await raw(port, { host: `127.0.0.1:${port}`, origin: ALLOWED }, {
      id: "h-4",
      op: "getStatus",
      args: {},
    });
    expect(answer.status).toBe(403);
  });

  it("пропущенный и битый `args` — отказ, и `re` не теряется", async () => {
    const { url, calls } = await serve();

    for (const broken of [
      { id: "a-10", op: "getStatus" },
      { id: "a-11", op: "getStatus", args: null },
    ]) {
      const response = await post(url, broken);
      expect(response.status).toBe(400);
      const body = (await response.json()) as { re?: string; error: { code: string } };
      // Без `re` клиент не свяжет ответ со своим запросом и покажет ошибку
      // транспорта вместо причины.
      expect(body.re).toBe((broken as { id: string }).id);
      expect(body.error.code).toBe("INVALID_ARGUMENT");
    }
    expect(calls).toEqual([]);
  });

  it("аргумент не того типа — INVALID_ARGUMENT, а не ошибка источника", async () => {
    const { url, calls } = await serve();

    const response = await post(url, { id: "a-12", op: "queryMetric", args: { metricId: 42 } });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { re: string; error: { code: string; message: string } };
    expect(body.re).toBe("a-12");
    expect(body.error.code).toBe("INVALID_ARGUMENT");
    expect(body.error.message).toContain("metricId");
    // Внутренний `TypeError` библиотеки наружу больше не выходит.
    expect(body.error.message).not.toContain("TypeError");
    expect(calls).toEqual([]);
  });

  it("правила контракта остались у библиотеки: границы не наши", async () => {
    const seen: Record<string, unknown>[] = [];
    const { url } = await serve({
      listMetrics: (args) => {
        seen.push(args);
        return { metrics: [], nextCursor: "" };
      },
    });

    // `pageSize: 500` вне границ контракта — но это правило, а не тип, и
    // проверяет его библиотека. Наша проверка типов его не перехватывает.
    await post(url, { id: "a-13", op: "listMetrics", args: { pageSize: 500 } });
    expect(seen[0]).toEqual({ pageSize: 500 });
  });

  it("незнакомое поле аргументов доходит до библиотеки нетронутым", async () => {
    const seen: Record<string, unknown>[] = [];
    const { url } = await serve({
      queryMetric: (args) => {
        seen.push(args);
        return { kind: "value" };
      },
    });

    // Добавление минорной версии не должно молча теряться у нас.
    await post(url, { id: "a-14", op: "queryMetric", args: { metricId: "x", будущее: "поле" } });
    expect(seen[0]).toEqual({ metricId: "x", "будущее": "поле" });
  });

  it("close() закрывает открытый поток, и слушатель успевает остановиться", async () => {
    // Проба Gs: `saveApi.close()` зачищал таймер, но поток оставался открыт,
    // и callback `server.close()` не вызывался до отключения клиента —
    // адаптер висел на остановке.
    const started = await serve();
    const response = await fetch(`${started.url}/api/v0/events`);
    const reader = response.body?.getReader();
    const first = await reader?.read();
    expect(new TextDecoder().decode(first?.value)).toContain("event: ready");

    started.api.close();
    const next = await reader?.read();
    expect(next?.done).toBe(true);

    // И слушатель закрывается, не дожидаясь клиента.
    const closed = await new Promise<boolean>((done) => {
      const timer = setTimeout(() => done(false), 2000);
      started.server.close(() => {
        clearTimeout(timer);
        done(true);
      });
    });
    expect(closed).toBe(true);
    // Закрыт — повторное закрытие в afterEach не нужно.
    started.closed = true;
  });
});

describe("включение источника Save", () => {
  const base = { ADAPTER_TOKEN: "0123456789abcdef0123" } as NodeJS.ProcessEnv;

  it("каталога одного мало: SAVE_DATA_DIR задан и для Foreman", () => {
    // Включение по каталогу открывало бы чтение у каждого игрока, который
    // про него не просил.
    expect(saveSourceConfigured(loadConfig({ ...base, SAVE_DATA_DIR: "/saves" }))).toBe(false);
    expect(saveSourceConfigured(loadConfig({ ...base, FICSITAI_SAVE_ID: "a" }))).toBe(false);
    expect(
      saveSourceConfigured(loadConfig({ ...base, SAVE_DATA_DIR: "/saves", FICSITAI_SAVE_ID: "a" })),
    ).toBe(true);
    expect(saveSourceConfigured(loadConfig({ ...base, FICSITAI_SAVE_FILE: "/a.sav" }))).toBe(true);
  });

  it("без сохранения поверхности нет вовсе", () => {
    expect(saveSourceConfigured(loadConfig(base))).toBe(false);
  });
});
