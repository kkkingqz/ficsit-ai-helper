import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { SourceError, type DevSource } from "./source.js";
import type {
  ApiStatus,
  ListMetricsArgs,
  ListMetricsResult,
  ListScopesArgs,
  ListScopesResult,
  MetricSeries,
  MetricValue,
  QueryMetricArgs,
  QuerySeriesArgs,
} from "../types.js";

/**
 * Источник Save для dev-сервера: обёртка над библиотекой Cf3.
 *
 * Пакет `@ficsitai/save-source` в зависимости фасада не попадает нарочно. Он
 * Node-овый, подтягивает пакеты Foreman из `FOREMAN_SRC` и нужен только
 * dev-серверу, а страница грузит `dist/index.js` и про сохранения не знает.
 * Поэтому он подключается динамическим импортом по пути и только когда его
 * позвали флагом: `npm install` в пакете фасада от этого не зависит, а
 * зависимость в адаптер добавляется отдельно (`OWNERSHIP.md`: «Зависимость в
 * адаптер добавляет Co2»).
 *
 * Обёртка делает три вещи и ровно три:
 *
 * 1. **Переводит форму ошибки.** Пакет бросает `FicsitAIApiError`, сервер
 *    ждёт {@link SourceError}; код, сообщение и детали проходят как есть.
 * 2. **Договаривает статус до 0.5.0.** Сохранение не умеет чат, поэтому
 *    `assistantState` — `unavailable`: экран чата обязан сказать это игроку,
 *    а не ждать с пустым полем ввода. Запросы чата сервер сам отклоняет
 *    кодом `SIDECAR_UNAVAILABLE` — методов чата у этого источника нет.
 * 3. **Ничего больше.** Формы ответов не трогает и снимок не кэширует: кэш
 *    по `mtime` у пакета свой, и вторая его копия разошлась бы с первой.
 */

/** Путь к сборке пакета по умолчанию — от каталога запуска, как `--source`. */
export const DEFAULT_SAVE_SOURCE_MODULE = "sidecar/save-source/dist/index.js";

/**
 * То, что обёртке нужно от пакета.
 *
 * Структурно, без импорта его типов: пакета нет в зависимостях, а формы
 * ответов у нас общие — они оба из одного контракта.
 */
interface SaveSourceLike {
  getStatus(): Promise<ApiStatus>;
  listMetrics(request: ListMetricsArgs): Promise<ListMetricsResult>;
  listScopes(request: ListScopesArgs): Promise<ListScopesResult>;
  queryMetric(request: QueryMetricArgs): Promise<MetricValue>;
  querySeries(request: QuerySeriesArgs): Promise<MetricSeries>;
}

export interface SaveSourceModule {
  createSaveSource(options: Record<string, unknown>): SaveSourceLike;
}

export interface SaveDevSourceOptions {
  /** Каталог сохранений — вход `SAVE_DATA_DIR` из `OWNERSHIP.md`. */
  saveDataDir?: string;
  /** Имя сохранения внутри каталога. */
  saveId?: string;
  /** Путь к конкретному `.sav` — вместо пары каталог плюс имя. */
  saveFilePath?: string;
  /** `save` — числа из файла, `saveEstimated` — расчётные (§8.5). */
  sourceMode?: "save" | "saveEstimated";
  /** Где искать сборку пакета. По умолчанию {@link DEFAULT_SAVE_SOURCE_MODULE}. */
  modulePath?: string;
  /** Подмена загрузки — для проверок без пакета Foreman на диске. */
  load?: () => Promise<SaveSourceModule>;
}

function isDetails(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Переводит ошибку пакета в форму, которую ждёт сервер.
 *
 * Класс ошибки узнаём по имени, а не `instanceof`: он приходит из модуля,
 * которого нет в наших зависимостях, и второй его копии у нас быть не
 * должно. Всё остальное пробрасываем как есть — сервер отдаст его как
 * `SOURCE_UNAVAILABLE`, и это правда: источник не готов. Придумывать код
 * контракта по чужому `ENOENT` нельзя, это было бы ложью о причине.
 */
async function contract<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "FicsitAIApiError") {
      const body = err as Error & { code?: unknown; details?: unknown };
      if (typeof body.code === "string") {
        throw new SourceError(
          body.code,
          err.message,
          isDetails(body.details) ? body.details : undefined,
        );
      }
    }
    throw err;
  }
}

async function loadModule(modulePath: string): Promise<SaveSourceModule> {
  // Путь разрешается от каталога запуска — то же правило, что у `--source`
  // (ревью Gs на #53). Голый идентификатор остаётся именем пакета.
  const target =
    modulePath.startsWith(".") || isAbsolute(modulePath) || modulePath.includes("/")
      ? pathToFileURL(resolve(modulePath)).href
      : modulePath;
  return (await import(target)) as SaveSourceModule;
}

/**
 * Собирает {@link DevSource} поверх библиотеки Save.
 *
 * Версию API пакету не объявляем: он сверяет `expectedApiVersion` строгим
 * равенством и на 0.5.0 отказал бы всему `API_VERSION_MISMATCH`, хотя
 * мажор тот же и чтения не менялись. Расхождение версий видно в статусе —
 * там его и место (§5.5).
 */
export async function createSaveDevSource(options: SaveDevSourceOptions = {}): Promise<DevSource> {
  const mode = options.sourceMode ?? "save";
  const from = options.modulePath ?? DEFAULT_SAVE_SOURCE_MODULE;
  const load = options.load ?? (() => loadModule(from));
  const module = await load();
  // Проверяем то, что получили, а не то, откуда взяли: подменённый в
  // проверках модуль обязан держать тот же договор, что настоящий, иначе
  // проверка подтверждала бы работу с тем, чего в поставке нет.
  if (typeof module?.createSaveSource !== "function") {
    throw new Error(
      `модуль «${from}» не экспортирует createSaveSource(): это не пакет @ficsitai/save-source`,
    );
  }

  const passed: Record<string, unknown> = { sourceMode: mode };
  if (options.saveDataDir !== undefined) passed["saveDataDir"] = options.saveDataDir;
  if (options.saveId !== undefined) passed["saveId"] = options.saveId;
  if (options.saveFilePath !== undefined) passed["saveFilePath"] = options.saveFilePath;
  const source = module.createSaveSource(passed);

  return {
    name: mode,

    async getStatus(): Promise<ApiStatus> {
      const status = await contract(() => source.getStatus());
      return { ...status, assistantState: "unavailable" };
    },

    async listMetrics(args: ListMetricsArgs): Promise<ListMetricsResult> {
      return await contract(() => source.listMetrics(args));
    },

    async listScopes(args: ListScopesArgs): Promise<ListScopesResult> {
      return await contract(() => source.listScopes(args));
    },

    async queryMetric(args: QueryMetricArgs): Promise<MetricValue> {
      return await contract(() => source.queryMetric(args));
    },

    async querySeries(args: QuerySeriesArgs): Promise<MetricSeries> {
      // Ряда у сохранения нет: пакет отвечает `SERIES_NOT_AVAILABLE`, и это
      // не ошибка связи, а свойство источника — `hasSeries: false` в
      // каталоге говорит то же заранее.
      return await contract(() => source.querySeries(args));
    },
  };
}
