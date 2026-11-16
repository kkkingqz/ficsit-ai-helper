import { describe, expect, it } from "vitest";
import {
  createSaveDevSource,
  DEFAULT_SAVE_SOURCE_MODULE,
  type SaveSourceModule,
} from "../src/dev/save-source.js";
import { SourceError } from "../src/dev/source.js";
import type { ApiStatus } from "../src/types.js";

/**
 * Обёртка источника Save: что dev-сервер делает с библиотекой Cf3.
 *
 * Пакет здесь подменён: проверка не про разбор `.sav` — он чужой и покрыт
 * у Cf3 — а про стык. Предмет: форма ошибки, договорённый статус и то, что
 * формы ответов обёртка не трогает. Настоящий пакет тянет сборки Foreman из
 * `FOREMAN_SRC`, и в проверках его быть не должно.
 */

/** Ошибка пакета: свой класс с тем же телом, что у контракта. */
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

const status: ApiStatus = {
  apiVersion: "0.4.0",
  saveId: "save_a_starter",
  source: "save",
  inert: false,
  lastSnapshotSessionTimeSec: 1830,
  sidecarConnected: false,
  apiVersionMismatch: "",
  reason: "",
};

interface Fake {
  module: SaveSourceModule;
  /** Параметры, с которыми обёртка позвала пакет. */
  passed: Record<string, unknown>[];
}

function fakeModule(behaviour: Partial<Record<string, () => unknown>> = {}): Fake {
  const passed: Record<string, unknown>[] = [];
  return {
    passed,
    module: {
      createSaveSource(options) {
        passed.push(options);
        const call = async (name: string, fallback: unknown): Promise<never | unknown> => {
          const act = behaviour[name];
          if (act === undefined) return fallback;
          return act();
        };
        return {
          getStatus: async () => (await call("getStatus", status)) as ApiStatus,
          listMetrics: async () =>
            (await call("listMetrics", { metrics: [], nextCursor: "" })) as never,
          listScopes: async () => (await call("listScopes", { scopes: [], nextCursor: "" })) as never,
          queryMetric: async () => (await call("queryMetric", null)) as never,
          querySeries: async () => (await call("querySeries", null)) as never,
        };
      },
    },
  };
}

describe("источник Save в dev-сервере", () => {
  it("статус договаривается до 0.5.0: ассистента у сохранения нет", async () => {
    const fake = fakeModule();
    const source = await createSaveDevSource({ load: async () => fake.module });

    const got = await source.getStatus();
    expect(got.assistantState).toBe("unavailable");
    // Остальное проходит как есть: версию пакета не подменяем, расхождение
    // видно в статусе, а не исправляется втихую.
    expect(got.apiVersion).toBe("0.4.0");
    expect(got.saveId).toBe("save_a_starter");
    expect(got.source).toBe("save");
  });

  it("ошибка пакета становится ошибкой контракта, с кодом и деталями", async () => {
    const fake = fakeModule({
      queryMetric: () => {
        throw new FicsitAIApiError("SCOPE_REQUIRED", "метрике нужна область", { metricId: "x" });
      },
    });
    const source = await createSaveDevSource({ load: async () => fake.module });

    await expect(source.queryMetric({ metricId: "x" })).rejects.toBeInstanceOf(SourceError);
    await expect(source.queryMetric({ metricId: "x" })).rejects.toMatchObject({
      body: { code: "SCOPE_REQUIRED", details: { metricId: "x" } },
    });
  });

  it("чужая ошибка кодом контракта не притворяется", async () => {
    // У системной ошибки тоже есть `code` — `ENOENT`. Отдать его экрану как
    // код контракта значило бы соврать о причине; сервер сам ответит
    // `SOURCE_UNAVAILABLE`, и это правда.
    const broken = Object.assign(new Error("нет такого файла"), { code: "ENOENT" });
    const fake = fakeModule({
      listMetrics: () => {
        throw broken;
      },
    });
    const source = await createSaveDevSource({ load: async () => fake.module });

    await expect(source.listMetrics({})).rejects.toBe(broken);
    await expect(source.listMetrics({})).rejects.not.toBeInstanceOf(SourceError);
  });

  it("`SERIES_NOT_AVAILABLE` проходит как есть: ряда у сохранения нет", async () => {
    const fake = fakeModule({
      querySeries: () => {
        throw new FicsitAIApiError("SERIES_NOT_AVAILABLE", "ряд недоступен для Save");
      },
    });
    const source = await createSaveDevSource({ load: async () => fake.module });

    await expect(source.querySeries({ metricId: "power.consumption", window: "last5Min" })).rejects
      .toMatchObject({ body: { code: "SERIES_NOT_AVAILABLE" } });
  });

  it("имя источника — режим: его видно в строке запуска и в журнале", async () => {
    const fake = fakeModule();
    const plain = await createSaveDevSource({ load: async () => fake.module });
    const estimated = await createSaveDevSource({
      sourceMode: "saveEstimated",
      load: async () => fake.module,
    });

    expect(plain.name).toBe("save");
    expect(estimated.name).toBe("saveEstimated");
    expect(fake.passed[1]).toMatchObject({ sourceMode: "saveEstimated" });
  });

  it("чего не дали — не передаём: пакет сам скажет, чего ему не хватает", async () => {
    const fake = fakeModule();
    await createSaveDevSource({ saveId: "save_a_starter", load: async () => fake.module });

    expect(fake.passed[0]).toEqual({ sourceMode: "save", saveId: "save_a_starter" });
    expect(Object.keys(fake.passed[0] ?? {})).not.toContain("saveDataDir");
  });

  it("чат у источника Save не объявлен — отказ держит сервер", async () => {
    const fake = fakeModule();
    const source = await createSaveDevSource({ load: async () => fake.module });

    // Отсутствие методов — это и есть ответ: правила отказа держит сервер, и
    // второй их копии в обёртке быть не должно. Сейчас он отвечает
    // `UNKNOWN_OP` (запросов чата в нём ещё нет), после слияния
    // [#62](https://github.com/kkkingqz/ficsit-ai-helper/pull/62) —
    // `SIDECAR_UNAVAILABLE`. Обёртке в обоих случаях делать нечего.
    expect("chatSend" in source).toBe(false);
    expect("chatHistory" in source).toBe(false);
    // Событий у сохранения нет: снимок один, и присылать нечего.
    expect(source.subscribe).toBeUndefined();
  });

  it("модуль без createSaveSource отвергается с понятным текстом", async () => {
    await expect(
      createSaveDevSource({
        modulePath: "./чужой-модуль.js",
        load: async () => ({}) as unknown as SaveSourceModule,
      }),
    ).rejects.toThrow(/чужой-модуль\.js.*createSaveSource/s);
    expect(DEFAULT_SAVE_SOURCE_MODULE).toBe("sidecar/save-source/dist/index.js");
  });
});
