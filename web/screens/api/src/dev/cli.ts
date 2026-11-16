#!/usr/bin/env node
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createDemoSource } from "./demo-source.js";
import { createSaveDevSource, type SaveDevSourceOptions } from "./save-source.js";
import { startDevServer } from "./server.js";
import type { DevSource } from "./source.js";

/**
 * Запуск dev-сервера экранов: `ficsitai-screens-dev --root web/screens --port 5173`.
 *
 * Источник выбирается флагом. Свои два: `demo` — для самопроверки, `save` и
 * `saveEstimated` — библиотека Cf3 поверх файла сохранения. Остальные
 * подключаются по пути к модулю, который экспортирует `createSource()`: так
 * наборы Fixture и проигрыватель Recording (Gf2) приедут без правки
 * сервера.
 */
async function loadSource(spec: string): Promise<DevSource> {
  if (spec === "demo") return createDemoSource();
  if (spec === "save" || spec === "saveEstimated") return await loadSaveSource(spec);
  // Путь к файлу разрешается от каталога запуска, а не от `dist/dev/`, где
  // лежит этот файл: иначе документированный `--source ./my-source.js` не
  // находился (ревью Gs на #53). `pathToFileURL` нужен и для Windows, где
  // голый путь с диском не является корректным URL.
  const target =
    spec.startsWith(".") || isAbsolute(spec) ? pathToFileURL(resolve(spec)).href : spec;
  const module = (await import(target)) as { createSource?: () => DevSource | Promise<DevSource> };
  if (typeof module.createSource !== "function") {
    throw new Error(`модуль «${spec}» не экспортирует createSource()`);
  }
  return await module.createSource();
}

function flag(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return fallback;
  return process.argv[index + 1] ?? fallback;
}

/**
 * Источник Save: флаги поверх входов из `OWNERSHIP.md`.
 *
 * `SAVE_DATA_DIR` и `saveId` — документированные входы пакета, поэтому
 * переменная окружения работает без флага. Поля, которых не дали, не
 * передаём вовсе: пакет сам скажет, чего ему не хватает, и скажет кодом
 * контракта, а не нашей догадкой.
 */
async function loadSaveSource(mode: "save" | "saveEstimated"): Promise<DevSource> {
  const options: SaveDevSourceOptions = { sourceMode: mode };
  const dir = flag("save-dir", process.env["SAVE_DATA_DIR"]);
  const id = flag("save-id", process.env["FICSITAI_SAVE_ID"]);
  const file = flag("save-file");
  const module = flag("save-package", process.env["FICSITAI_SAVE_SOURCE"]);
  if (dir !== undefined) options.saveDataDir = dir;
  if (id !== undefined) options.saveId = id;
  if (file !== undefined) options.saveFilePath = file;
  if (module !== undefined) options.modulePath = module;
  return await createSaveDevSource(options);
}

/**
 * Врезки каталогов: `--mount /third_party=third_party`, можно несколько раз.
 *
 * Нужны, когда страница ссылается за пределы корня: «Статистика» просит
 * uPlot из `third_party/` рядом с `web/`. Без врезки один из двух адресов
 * неизбежно отдавал 404 — на это я сам потратил прогон ревью.
 */
function mounts(): Record<string, string> {
  const found: Record<string, string> = {};
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] !== "--mount") continue;
    const pair = process.argv[index + 1];
    const split = pair === undefined ? -1 : pair.indexOf("=");
    if (pair === undefined || split <= 0) {
      throw new Error("--mount ждёт пару вида /третий-путь=каталог");
    }
    found[pair.slice(0, split)] = pair.slice(split + 1);
  }
  return found;
}

async function main(): Promise<void> {
  const root = flag("root", ".") as string;
  const source = await loadSource(flag("source", "demo") as string);
  const port = Number.parseInt(flag("port", "5173") as string, 10);

  const server = await startDevServer({
    root,
    source,
    port,
    mounts: mounts(),
    watch: flag("watch") !== "off",
  });
  console.log(`экраны: ${server.url} (источник «${source.name}», корень ${root})`);
  console.log("горячая перезагрузка: подключите <script src=\"/api/v0/reload.js\"></script>");

  const stop = (signal: string): void => {
    console.log(`${signal}: останавливаюсь`);
    void server.close().then(() => process.exit(0));
  };
  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));
}

await main();
