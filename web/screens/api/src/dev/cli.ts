#!/usr/bin/env node
import { createDemoSource } from "./demo-source.js";
import { startDevServer } from "./server.js";
import type { DevSource } from "./source.js";

/**
 * Запуск dev-сервера экранов: `ficsitai-screens-dev --root web/screens --port 5173`.
 *
 * Источник выбирается флагом. `demo` — свой, для самопроверки; остальные
 * подключаются по пути к модулю, который экспортирует `createSource()`:
 * так наборы Fixture (Gf2) и источник Save (Cf3) приезжают без правки
 * сервера.
 */
async function loadSource(spec: string): Promise<DevSource> {
  if (spec === "demo") return createDemoSource();
  const module = (await import(spec)) as { createSource?: () => DevSource | Promise<DevSource> };
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

async function main(): Promise<void> {
  const root = flag("root", ".") as string;
  const source = await loadSource(flag("source", "demo") as string);
  const port = Number.parseInt(flag("port", "5173") as string, 10);

  const server = await startDevServer({ root, source, port, watch: flag("watch") !== "off" });
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
