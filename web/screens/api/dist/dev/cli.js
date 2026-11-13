#!/usr/bin/env node
import { createDemoSource } from "./demo-source.js";
import { startDevServer } from "./server.js";
/**
 * Запуск dev-сервера экранов: `ficsitai-screens-dev --root web/screens --port 5173`.
 *
 * Источник выбирается флагом. `demo` — свой, для самопроверки; остальные
 * подключаются по пути к модулю, который экспортирует `createSource()`:
 * так наборы Fixture (Gf2) и источник Save (Cf3) приезжают без правки
 * сервера.
 */
async function loadSource(spec) {
    if (spec === "demo")
        return createDemoSource();
    const module = (await import(spec));
    if (typeof module.createSource !== "function") {
        throw new Error(`модуль «${spec}» не экспортирует createSource()`);
    }
    return await module.createSource();
}
function flag(name, fallback) {
    const index = process.argv.indexOf(`--${name}`);
    if (index < 0)
        return fallback;
    return process.argv[index + 1] ?? fallback;
}
async function main() {
    const root = flag("root", ".");
    const source = await loadSource(flag("source", "demo"));
    const port = Number.parseInt(flag("port", "5173"), 10);
    const server = await startDevServer({ root, source, port, watch: flag("watch") !== "off" });
    console.log(`экраны: ${server.url} (источник «${source.name}», корень ${root})`);
    console.log("горячая перезагрузка: подключите <script src=\"/api/v0/reload.js\"></script>");
    const stop = (signal) => {
        console.log(`${signal}: останавливаюсь`);
        void server.close().then(() => process.exit(0));
    };
    process.on("SIGINT", () => stop("SIGINT"));
    process.on("SIGTERM", () => stop("SIGTERM"));
}
await main();
//# sourceMappingURL=cli.js.map