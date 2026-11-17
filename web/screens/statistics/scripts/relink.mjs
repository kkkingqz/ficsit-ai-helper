#!/usr/bin/env node
// Шаг после `tsc`: имя пакета фасада в относительный путь.
//
// Браузер имён пакетов не знает, а карту импорта в разметку положить нельзя —
// страницы в игре отдаются с `script-src 'self'`, и встроенный скрипт под эту
// политику не проходит (Co-128, решение Co по изоляции). Из двух путей Co
// рекомендовал этот: переписать спецификатор при сборке.
//
// Путь `../../api/dist/index.js` верен и в браузере, и в игре: корень страниц
// в игре — содержимое `web/`, как у dev-сервера Co2, поэтому `/screens/statistics/dist/`
// и `/screens/api/dist/` лежат рядом в обоих случаях (Co-128, «Корень страниц
// в игре»).

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Через `fileURLToPath`, а не `.pathname`: в файловом URL путь
// процентно-закодирован, и в каталоге с пробелом шаг искал
// `tree%20with%20spaces/.../dist/` и падал с ENOENT (ревью Gs на #62).
const DIST = fileURLToPath(new URL("../dist/", import.meta.url));
const PACKAGE = "@ficsitai/screens-api";
const RELATIVE = "../../api/dist/index.js";

let touched = 0;
for (const name of readdirSync(DIST)) {
  if (!name.endsWith(".js")) continue;
  const file = join(DIST, name);
  const before = readFileSync(file, "utf8");
  // Только в спецификаторах `import`/`export … from "…"`: в тексте и в
  // комментариях имя пакета трогать нечего.
  const after = before.replace(
    new RegExp(`(from\\s*["'])${PACKAGE}(["'])`, "g"),
    `$1${RELATIVE}$2`,
  );
  if (after !== before) {
    writeFileSync(file, after, "utf8");
    touched += 1;
  }
}

// Молчаливый ноль — повод для тревоги: значит имя пакета в сборке не нашлось,
// и страница в игре снова опиралась бы на карту импорта, которой не будет.
if (touched === 0) {
  console.error(`relink: в dist не найдено ни одного импорта «${PACKAGE}» — проверьте сборку`);
  process.exit(1);
}
console.log(`relink: ${PACKAGE} → ${RELATIVE} в ${touched} файл(ах)`);
