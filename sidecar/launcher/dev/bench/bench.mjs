#!/usr/bin/env node
// Стенд сравнения со штатным Foreman (Co-104).
//
// Отвечает на один вопрос: что модель теряет из-за белого списка адаптера.
// Два пути на одном и том же сохранении:
//
//   наш    — модель → Foreman → адаптер (/mcp) → белый список + инструменты мода
//   штатный — модель → Foreman → sf-mcp напрямую, без фильтра и с его промптом
//
// Граница стенда — из Co-104, и она здесь соблюдается буквально:
//
//   • не в поставке. Стенд живёт в каталоге разработки лаунчера; архив берёт
//     из `sidecar/launcher/` только `foreman.pin.json`, а из адаптера — `dist/`.
//     Режима `stock` в адаптере нет: фильтр не отключается ничем во время
//     работы, и стенд его не трогает — он просто не ставит адаптер на путь;
//   • свой Foreman и свой playthrough. Свои порты, своя база в своём каталоге
//     данных, сохранение загружается явно через `SAVE_FILE_PATH`;
//   • мод не подключается. Канал мода стенд не поднимает вовсе, поэтому
//     инструментов мода в нашем пути нет — и в отчёте это видно отдельной
//     строкой, чтобы цифры не читались как «адаптер отнял у модели всё»;
//   • решений о белом списке стенд не принимает. Он показывает разницу;
//     что с ней делать — вопрос к Co (Co-104).
//
// Запуск:
//   node sidecar/launcher/dev/bench/bench.mjs --save <путь.sav>
//   node sidecar/launcher/dev/bench/bench.mjs --save <путь.sav> --model
//
// Без `--model` стенд сравнивает только поверхность инструментов: это
// детерминированно, бесплатно и воспроизводимо. С `--model` добавляется
// сравнение ответов модели — нужен ключ провайдера, и он тратится.

import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:net";
import {
  mkdtempSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
  existsSync,
  realpathSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, basename } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const REPO = resolve(import.meta.dirname, "../../../..");
const ADAPTER = join(REPO, "sidecar/adapter");
const FOREMAN_SRC = process.env.FOREMAN_SRC ?? join(process.env.HOME ?? ".", "Projects/foreman-src");

/**
 * Что каждая служба пишет в свой журнал, когда действительно слушает.
 *
 * Это и есть привязка готовности к своему экземпляру: строку в наш файл
 * может написать только наш процесс. Тексты — из кода на закреплённом
 * коммите Foreman (`sf-mcp/src/http.ts`, `ff-server/src/index.ts`) и из
 * нашего адаптера.
 */
const LISTENING = {
  sfMcp: (port) => `Listening on http://127.0.0.1:${port}`,
  ffServer: (port) => `Listening on http://127.0.0.1:${port}`,
  adapter: (port) => `адаптер слушает http://127.0.0.1:${port}`,
};

/** Свои порты: стенд не должен драться с лаунчером (8723, 8724, 8730, 8731). */
const PORTS = {
  sfMcp: Number(process.env.BENCH_SF_MCP_PORT ?? 8743),
  ffServer: Number(process.env.BENCH_FF_SERVER_PORT ?? 8744),
  adapter: Number(process.env.BENCH_ADAPTER_PORT ?? 8745),
  normalizer: Number(process.env.BENCH_NORMALIZER_PORT ?? 8746),
};

/**
 * Нормализатор ответов провайдера (ADR-034) включён на **обоих** путях.
 *
 * Он не часть сравнения: у Gemini в потоке приходит `finish_reason: "stop"`
 * вместо `"tool_calls"`, и без правки вызовы инструментов теряются у любого
 * клиента. Выключить его на штатном пути значило бы измерить ошибку
 * провайдера вместо нашего белого списка. Поэтому он один на два пути, и в
 * отчёте об этом сказано.
 */
const GEMINI_OPENAI_BASE = "https://generativelanguage.googleapis.com/v1beta/openai";

/** Вопросы по умолчанию: про числа фабрики, которые есть в любом сохранении. */
const QUESTIONS = [
  "Сколько энергии потребляет фабрика и сколько вырабатывает? Назови числа.",
  "Какие предметы производятся и с какой скоростью? Назови три самых быстрых.",
  "Хватает ли мощности электросети и есть ли риск выбить предохранитель?",
];

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return fallback;
  return process.argv[index + 1] ?? fallback;
}

const flag = (name) => process.argv.includes(`--${name}`);

/* ---------- процессы ---------- */

const started = [];

/**
 * Номер запуска: у каждого — свой журнал.
 *
 * Оба прохода `--model` поднимают `ff-server` и прежде писали в один файл в
 * режиме append. Второй проход находил маркер **первого** запуска, считал
 * службу готовой и уходил с запросом к тому, кто занял порт (ревью Gs на
 * #68). Один файл на запуск убирает саму возможность: маркер ищется только
 * в журнале этого запуска.
 */
let launches = 0;

function nodeCommand() {
  // Тот же приём, что в `foreman-local.sh`: системный Node 22, иначе разовый
  // nix shell. Профиль не меняем.
  return process.env.BENCH_NODE_PREFIX ?? "";
}

function startProcess(name, cwd, script, env, logDir, marker) {
  launches += 1;
  const logFile = join(logDir, `${launches}-${name}.log`);
  const out = openSync(logFile, "a");
  const prefix = nodeCommand();
  const command = prefix === "" ? "npm" : prefix.split(" ")[0];
  const args = prefix === "" ? script : [...prefix.split(" ").slice(1), "npm", ...script];
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ["ignore", out, out],
    detached: true,
  });
  // Смерть своей команды запоминаем сразу: без этого стенд ждал готовности у
  // того, кого уже нет, и принимал за свою службу чужого слушателя на том же
  // порту (ревью Gs на #68).
  const service = { name, child, logFile, marker, exit: undefined };
  child.once("exit", (code, signal) => {
    service.exit = code === null ? `сигнал ${String(signal)}` : `код ${String(code)}`;
  });
  started.push(service);
  return service;
}

/** Свободен ли порт. Проверяем привязкой, а не запросом: запрос видит чужого. */
function portFree(port) {
  return new Promise((done) => {
    const probe = createServer();
    probe.once("error", () => done(false));
    probe.once("listening", () => probe.close(() => done(true)));
    probe.listen(port, "127.0.0.1");
  });
}

/**
 * Отказ при занятом порте — до любого запуска.
 *
 * Стенд не поднимает второй экземпляр поверх чужого слушателя: иначе он
 * спросит список инструментов у него и подпишет отчёт как своим прогоном
 * (ревью Gs на #68). Тот же приём у `foreman-local.sh`.
 */
async function requireFreePorts(ports) {
  // Совпадающие порты предварительная проверка пропускала: оба раза порт был
  // свободен, потом его занимала первая служба, вторая падала, и стенд
  // сравнивал службу сама с собой (дополнительный сценарий Gs на #68).
  const seen = new Map();
  for (const [name, port] of Object.entries(ports)) {
    const already = seen.get(port);
    if (already !== undefined) {
      throw new Error(`порты ${already} и ${name} совпадают (${port}) — у каждой службы свой порт`);
    }
    seen.set(port, name);
  }
  for (const [name, port] of Object.entries(ports)) {
    if (!(await portFree(port))) {
      throw new Error(
        `порт ${port} (${name}) занят — остановите прежний прогон или задайте другой порт ` +
          `(BENCH_SF_MCP_PORT, BENCH_FF_SERVER_PORT, BENCH_ADAPTER_PORT, BENCH_NORMALIZER_PORT)`,
      );
    }
  }
}

/** Ждёт, пока порт освободится: между проходами ff-server поднимается заново. */
async function waitForPortFree(port, name, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await portFree(port)) return;
    if (Date.now() > deadline) {
      throw new Error(`порт ${port} (${name}) не освободился за ${timeoutMs} мс`);
    }
    await new Promise((done) => setTimeout(done, 200));
  }
}

/** Сказала ли своя служба в свой журнал то, что говорит при старте. */
function logHas(file, marker) {
  try {
    return readFileSync(file, "utf8").includes(marker);
  } catch {
    return false;
  }
}

/** Последние строки журнала — чтобы причина отказа была видна сразу. */
function logTail(file, lines = 12) {
  try {
    return readFileSync(file, "utf8").trimEnd().split("\n").slice(-lines).join("\n");
  } catch {
    return "(журнал пуст)";
  }
}

function stopAll() {
  for (const { child } of started.reverse()) {
    try {
      // Убиваем группу: node живёт внучатым процессом под npm и nix, и
      // одиночный kill оставлял бы слушателя на порту (урок лаунчера).
      process.kill(-child.pid, "SIGTERM");
    } catch {
      /* уже умер */
    }
  }
  started.length = 0;
}

process.on("exit", stopAll);
process.on("SIGINT", () => {
  stopAll();
  process.exit(130);
});

/**
 * Ждёт готовности **своей** службы, и это не то же самое, что отвечающий порт.
 *
 * Свободный порт перед запуском не доказывает ничего о том, что будет через
 * секунду: Gs поднял чужой слушатель ровно в момент старта своей команды,
 * своя упала с кодом 42, а стенд принял чужой ответ, спросил у него список
 * инструментов и записал `foreign_tool` в отчёт (ревью Gs на #68).
 * Повторная проверка после запроса этого не лечит — она снова проверяет
 * порт, а не владельца.
 *
 * Поэтому готовность определяется по **своему журналу**: служба пишет в
 * файл, который открыли мы, и строку о прослушивании своего порта может
 * написать только она. Чужой процесс в этот файл не пишет. Запрос по HTTP
 * остаётся вторым условием — журнал говорит «слушаю», запрос подтверждает,
 * что отвечает.
 */
async function waitForReady(service, url, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  const stop = (why) =>
    new Error(`${service.name}: ${why}\nЖурнал ${service.logFile}:\n${logTail(service.logFile, 20)}`);

  for (;;) {
    if (service.exit !== undefined) throw stop(`завершился (${service.exit}) до готовности`);

    if (service.marker !== undefined && !logHas(service.logFile, service.marker)) {
      // Своя служба ещё не сказала, что слушает. Чужой ответ на этом порту
      // нас не касается: спрашивать его нельзя.
      if (Date.now() > deadline) throw stop(`не сказал «${service.marker}» за ${timeoutMs} мс`);
      await new Promise((done) => setTimeout(done, 300));
      continue;
    }

    try {
      await fetch(url, { signal: AbortSignal.timeout(2000) });
      return;
    } catch {
      if (Date.now() > deadline) throw stop(`не отвечает на ${url} за ${timeoutMs} мс`);
      await new Promise((done) => setTimeout(done, 500));
    }
  }
}

/**
 * Ревизия Foreman, на которой **на самом деле** шёл прогон.
 *
 * Прежде отчёт печатал закреплённый коммит из `foreman.pin.json`, то есть
 * приписывал результат ревизии, которой мог и не быть в каталоге (ревью Gs
 * на #68). Теперь берём `rev-parse HEAD` самого каталога, говорим, совпал
 * ли он с закреплённым, и помечаем незакоммиченные правки: сравнение,
 * подписанное чужой ревизией, хуже сравнения без подписи.
 */
export function foremanRevision(pin, dir = FOREMAN_SRC) {
  const git = (args) =>
    // stderr гасим: у не-git каталога git пишет туда объяснение, а у нас на
    // этот случай есть своя строка в отчёте.
    execFileSync("git", ["-C", dir, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  try {
    // Корень репозитория обязан совпадать с самим каталогом: папке без
    // своего git доставался HEAD родительского репозитория, и отчёт о
    // сравнении подписывался ревизией FICSIT AI как ревизией Foreman (ревью
    // Gs на #68). Сравниваем канонические пути, иначе `/tmp` против
    // `/private/tmp` даст ложное расхождение.
    const top = realpathSync(git(["rev-parse", "--show-toplevel"]));
    if (top !== realpathSync(dir)) {
      return { sha: "", dirty: false, pinned: pin.commit, matchesPin: false, foreignGit: top };
    }
    const sha = git(["rev-parse", "HEAD"]);
    const dirty = git(["status", "--porcelain"]) !== "";
    return { sha, dirty, pinned: pin.commit, matchesPin: sha === pin.commit };
  } catch {
    return { sha: "", dirty: false, pinned: pin.commit, matchesPin: false };
  }
}

/* ---------- поверхность инструментов ---------- */

async function toolSurfaces(token, log) {
  const { UpstreamMcp } = await import(pathToFileURL(join(ADAPTER, "dist/upstream.js")).href);

  // Клиент тот же, которым адаптер ходит к sf-mcp: стенд измеряет через тот
  // код, что работает в поставке, а не через свой второй.
  const stock = new UpstreamMcp(`http://127.0.0.1:${PORTS.sfMcp}/mcp`, log);
  const ours = new UpstreamMcp(`http://127.0.0.1:${PORTS.adapter}/mcp?token=${token}`, log);

  const stockTools = (await stock.listTools()).map((tool) => tool.name).sort();
  const ourTools = (await ours.listTools()).map((tool) => tool.name).sort();

  const hidden = stockTools.filter((name) => !ourTools.includes(name));
  const added = ourTools.filter((name) => !stockTools.includes(name));

  // Список — ещё не поведение. Зовём скрытый инструмент по памяти о чужом
  // промпте: так его позовёт и модель, если промпт пообещает.
  let refusal = "вызов не проверен: скрытых инструментов нет";
  if (hidden.length > 0) {
    const name = hidden[0];
    try {
      const result = await ours.callTool(name, {});
      refusal = `НЕ ОТКАЗАНО: «${name}» ответил ${JSON.stringify(result).slice(0, 120)}`;
    } catch (err) {
      refusal = `«${name}» → ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  return { stockTools, ourTools, hidden, added, refusal };
}

/* ---------- ответы модели ---------- */

async function askForeman(baseUrl, account, saveId, questions, log) {
  const { ForemanSession } = await import(pathToFileURL(join(ADAPTER, "dist/foreman.js")).href);
  const { parseSse } = await import(pathToFileURL(join(ADAPTER, "dist/stream.js")).href);
  const session = new ForemanSession(baseUrl, account, log);
  await session.authenticate();
  const playthroughId = await session.resolvePlaythrough(saveId, basename(saveId));

  const answers = [];
  for (const question of questions) {
    const started = Date.now();
    // Запрос — тот же, что делает адаптер в бою (`turns.ts`): без
    // `accept: text/event-stream` ff-server отвечает не потоком, и стенд
    // читал пустые ответы, хотя модель отвечала.
    const response = await session.request(`/api/playthroughs/${playthroughId}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify({ message: question }),
    });

    const answer = { question, status: response.status, tools: [], text: "", error: "", ms: 0 };
    if (!response.ok || response.body === null) {
      answer.error = (await response.text().catch(() => "")).slice(0, 300);
    } else {
      // Разбор — тот же, что у адаптера: события Foreman `text` с `delta`,
      // `tool_use` с `name`, `done`, `error` (`turns.ts`, relay).
      for await (const event of parseSse(response.body)) {
        let data = {};
        try {
          data = JSON.parse(event.data);
        } catch {
          /* не JSON — для `text` это всё равно кусок */
        }
        if (event.event === "text" && typeof data.delta === "string") answer.text += data.delta;
        else if (event.event === "tool_use" && typeof data.name === "string") {
          if (!answer.tools.includes(data.name)) answer.tools.push(data.name);
        } else if (event.event === "error") {
          answer.error = typeof data.message === "string" ? data.message : event.data;
        }
      }
    }
    answer.ms = Date.now() - started;
    answer.full = answer.text;
    answer.text = answer.text.replace(/\s+/g, " ").trim().slice(0, 600);
    answer.empty = answer.text.length === 0;
    answers.push(answer);
  }
  return { playthroughId, answers };
}

/* ---------- отчёт ---------- */

/** Строка о ревизии Foreman для отчёта: что запускали, а не что закреплено. */
export function describeForeman(foreman, dir = FOREMAN_SRC) {
  if (foreman.sha === "") {
    const why =
      foreman.foreignGit === undefined
        ? "каталог не git-клон"
        : `git-корень чужой: \`${foreman.foreignGit}\``;
    return `\`${dir}\` — **ревизия неизвестна** (${why}), ` +
      `закреплено \`${foreman.pinned.slice(0, 8)}\``;
  }
  const dirty = foreman.dirty ? ", **есть незакоммиченные правки**" : "";
  return foreman.matchesPin
    ? `\`${foreman.sha.slice(0, 8)}\` — совпадает с закреплённым${dirty}`
    : `\`${foreman.sha.slice(0, 8)}\` — **не закреплённый** ` +
      `(закреплено \`${foreman.pinned.slice(0, 8)}\`)${dirty}`;
}

function report(data) {
  const lines = [];
  lines.push(`# Стенд сравнения со штатным Foreman`);
  lines.push("");
  lines.push(`Прогон ${data.at}. Сохранение: \`${data.save}\`.`);
  lines.push("");
  lines.push(`Foreman: ${data.foreman}`);
  lines.push("");
  lines.push(`## Поверхность инструментов`);
  lines.push("");
  lines.push(`| | штатный Foreman | наш путь |`);
  lines.push(`|---|---|---|`);
  lines.push(`| инструментов видно | ${data.surface.stockTools.length} | ${data.surface.ourTools.length} |`);
  lines.push("");
  lines.push(`**Скрыто белым списком (${data.surface.hidden.length}):** ${data.surface.hidden.map((n) => `\`${n}\``).join(", ") || "—"}`);
  lines.push("");
  lines.push(`**Добавлено модом:** ${data.surface.added.map((n) => `\`${n}\``).join(", ") || "— (мод к стенду не подключается, Co-104)"}`);
  lines.push("");
  lines.push(`**Вызов скрытого инструмента через наш путь:** ${data.surface.refusal}`);
  lines.push("");

  if (data.model !== undefined) {
    lines.push(`## Ответы модели`);
    lines.push("");
    lines.push(`Модель: \`${data.model.model}\`. По ${data.model.questions} вопроса на путь.`);
    lines.push("");
    lines.push(
      `Нормализатор ответов провайдера (ADR-034) включён на **обоих** путях: без него у Gemini ` +
        `теряются вызовы инструментов, и сравнение измеряло бы ошибку провайдера, а не белый список.`,
    );
    lines.push("");
    for (const [path, run] of Object.entries(data.model.runs)) {
      lines.push(`### ${path}`);
      lines.push("");
      for (const answer of run.answers) {
        lines.push(`- **${answer.question}**`);
        lines.push(`  - HTTP ${answer.status}, ${answer.ms} мс, инструменты: ${answer.tools.join(", ") || "ни одного"}`);
        if (answer.error !== "") lines.push(`  - ошибка: ${answer.error.slice(0, 300)}`);
        lines.push(`  - ответ: ${answer.empty ? "**пусто**" : answer.text}`);
      }
      lines.push("");
    }
  } else {
    lines.push(`## Ответы модели`);
    lines.push("");
    lines.push(`Не запускались: нужен флаг \`--model\` и ключ провайдера.`);
    lines.push("");
  }
  return lines.join("\n");
}

/* ---------- прогон ---------- */

async function main() {
  const savePath = arg("save");
  if (savePath === undefined) {
    console.error("нужен --save <путь к .sav>: сохранение стенд загружает явно (Co-104)");
    process.exit(2);
  }
  const save = resolve(savePath);
  if (!existsSync(save)) {
    console.error(`нет файла сохранения: ${save}`);
    process.exit(2);
  }
  if (!existsSync(join(FOREMAN_SRC, "packages/sf-mcp/package.json"))) {
    // Пустой каталог стенд принимал и подписывал отчёт закреплённым
    // коммитом (ревью Gs на #68). Теперь требуем именно клон Foreman.
    console.error(
      `${FOREMAN_SRC} не похож на клон Foreman: нет packages/sf-mcp/package.json ` +
        `(коммит — sidecar/launcher/foreman.pin.json)`,
    );
    process.exit(2);
  }

  const data = mkdtempSync(join(tmpdir(), "ficsitai-bench-"));
  const logs = join(data, "logs");
  const saves = join(data, "saves");
  mkdirSync(logs);
  mkdirSync(saves);
  const token = "bench-token-0123456789abcdef";
  const pin = JSON.parse(readFileSync(join(REPO, "sidecar/launcher/foreman.pin.json"), "utf8"));
  const foreman = foremanRevision(pin);

  // Порты проверяются до запуска: стенд не поднимает второй экземпляр
  // поверх чужого слушателя (ревью Gs на #68).
  await requireFreePorts(flag("model") ? PORTS : { sfMcp: PORTS.sfMcp, adapter: PORTS.adapter });

  const { createLogger } = await import(pathToFileURL(join(ADAPTER, "dist/log.js")).href);
  const log = createLogger(flag("verbose") ? "debug" : "warn");
  // Ключ читаем до запуска: нормализатор живёт в процессе адаптера, и без
  // этих двух переменных он не поднимется.
  const llm = flag("model") ? llmConfig() : undefined;

  console.log(`стенд: каталог данных ${data}`);
  console.log(`сохранение загружается явно: ${save}`);

  // Общее окружение обоих путей: своя база, свои порты, своё сохранение.
  const common = {
    DATABASE_URL: `file:${join(data, "foreman.db")}`,
    SAVE_DATA_DIR: saves,
    SAVE_FILE_PATH: save,
    HOST: "127.0.0.1",
    PORT: String(PORTS.ffServer),
    MCP_TRANSPORT: "http",
    MCP_HTTP_HOST: "127.0.0.1",
    MCP_HTTP_PORT: String(PORTS.sfMcp),
    BETTER_AUTH_SECRET: "bench-secret-not-a-real-one-0123456789",
  };

  const sfMcp = startProcess(
    "sf-mcp",
    FOREMAN_SRC,
    ["run", "start:mcp"],
    common,
    logs,
    LISTENING.sfMcp(PORTS.sfMcp),
  );
  await waitForReady(sfMcp, `http://127.0.0.1:${PORTS.sfMcp}/health`);
  console.log(`sf-mcp поднят на ${PORTS.sfMcp}`);

  const adapter = startProcess(
    "adapter",
    ADAPTER,
    ["run", "start"],
    {
      ADAPTER_HOST: "127.0.0.1",
      ADAPTER_PORT: String(PORTS.adapter),
      ADAPTER_TOKEN: token,
      SF_MCP_URL: `http://127.0.0.1:${PORTS.sfMcp}/mcp`,
      FOREMAN_BASE_URL: `http://127.0.0.1:${PORTS.ffServer}`,
      FOREMAN_ACCOUNT_PATH: join(data, "adapter-account.json"),
      // `info`, а не `warn`: готовность стенд определяет по строке адаптера о
      // прослушивании своего порта, а она пишется уровнем `info`. На `warn`
      // стенд ждал её 90 с и не дождался — поймал мой же прогон.
      ADAPTER_LOG_LEVEL: "info",
      ...(llm === undefined
        ? {}
        : {
            LLM_UPSTREAM_BASE_URL: llm.upstream,
            NORMALIZER_PORT: String(PORTS.normalizer),
          }),
    },
    logs,
    LISTENING.adapter(PORTS.adapter),
  );
  await waitForReady(adapter, `http://127.0.0.1:${PORTS.adapter}/health`);
  console.log(`адаптер поднят на ${PORTS.adapter}`);

  const surface = await toolSurfaces(token, log);
  console.log(
    `поверхность: штатный ${surface.stockTools.length}, наш ${surface.ourTools.length}, ` +
      `скрыто ${surface.hidden.length}`,
  );

  let model;
  if (llm !== undefined) {
    await waitForReady(
      { ...adapter, marker: `нормализатор ответов слушает http://127.0.0.1:${PORTS.normalizer}` },
      `http://127.0.0.1:${PORTS.normalizer}`,
    );
    console.log(`нормализатор поднят на ${PORTS.normalizer} (ADR-034, нужен обоим путям)`);
    model = await modelRuns(data, logs, token, save, log, llm);
  }

  const text = report({
    at: new Date().toISOString(),
    save,
    foreman: describeForeman(foreman),
    surface,
    model,
  });

  const out = arg("out", join(data, "report.md"));
  writeFileSync(out, `${text}\n`, "utf8");
  console.log(`\n${text}\n`);
  console.log(`отчёт: ${out}`);
  console.log(`журналы: ${logs}`);
  stopAll();
}

function llmConfig() {
  const keyFile = join(process.env.HOME ?? ".", ".local/share/ficsitai/foreman/llm.key");
  const key = process.env.LLM_API_KEY ?? (existsSync(keyFile) ? readFileSync(keyFile, "utf8").trim() : "");
  if (key === "") throw new Error(`нет ключа провайдера: ни LLM_API_KEY, ни ${keyFile}`);
  const model = process.env.LLM_MODEL ?? "gemini-3.5-flash-lite";
  return {
    key,
    model,
    upstream: process.env.LLM_UPSTREAM_BASE_URL ?? GEMINI_OPENAI_BASE,
    // Foreman читает `LLM_BASE_URL` и ходит в нормализатор, а тот — к
    // провайдеру. Поставить сюда адрес провайдера напрямую можно, но тогда
    // у Gemini пропадут вызовы инструментов (ADR-034), и сравнение станет
    // про ошибку провайдера.
    forForeman(summaryModel = model) {
      return {
        LLM_PROVIDER: "openai",
        LLM_API_KEY: key,
        LLM_MODEL: model,
        LLM_SUMMARY_MODEL: process.env.LLM_SUMMARY_MODEL ?? summaryModel,
        LLM_BASE_URL: `http://127.0.0.1:${PORTS.normalizer}`,
      };
    },
  };
}

async function modelRuns(data, logs, token, save, log, llm) {
  const { loadOrCreateAccount } = await import(pathToFileURL(join(ADAPTER, "dist/foreman.js")).href);
  const questions = QUESTIONS.slice(0, Number(arg("questions", String(QUESTIONS.length))));
  const base = `http://127.0.0.1:${PORTS.ffServer}`;
  const runs = {};

  // База одна, и миграции применяются один раз: playthrough у путей свой
  // (разные `saveId`), а схема общая.
  await new Promise((done, fail) => {
    const child = spawn("npm", ["run", "db:deploy", "-w", "@foreman/ff-server"], {
      cwd: FOREMAN_SRC,
      env: { ...process.env, DATABASE_URL: `file:${join(data, "foreman.db")}` },
      stdio: ["ignore", openSync(join(logs, "migrate.log"), "a"), openSync(join(logs, "migrate.log"), "a")],
    });
    child.on("exit", (code) => (code === 0 ? done() : fail(new Error(`миграции вышли с ${code}`))));
  });

  for (const [name, env] of [
    [
      "наш путь (адаптер, белый список, свой промпт)",
      {
        MCP_URL: `http://127.0.0.1:${PORTS.adapter}/mcp?token=${token}`,
        SYSTEM_PROMPT_PATH: join(REPO, "third_party/foreman/SYSTEM_PROMPT.md"),
      },
    ],
    [
      "штатный Foreman (sf-mcp напрямую, его промпт)",
      { MCP_URL: `http://127.0.0.1:${PORTS.sfMcp}/mcp` },
    ],
  ]) {
    const common = {
      DATABASE_URL: `file:${join(data, "foreman.db")}`,
      SAVE_DATA_DIR: join(data, "saves"),
      SAVE_FILE_PATH: save,
      HOST: "127.0.0.1",
      PORT: String(PORTS.ffServer),
      BETTER_AUTH_SECRET: "bench-secret-not-a-real-one-0123456789",
    };
    const tag = env.SYSTEM_PROMPT_PATH === undefined ? "stock" : "ours";
    // Порт должен быть свободен и перед вторым проходом: иначе вопросы уйдут
    // прежнему ff-server с прежним MCP_URL, и сравнение сравнит путь с собой.
    await waitForPortFree(PORTS.ffServer, "ff-server");
    const ffServer = startProcess(
      "ff-server",
      FOREMAN_SRC,
      ["run", "start:server"],
      { ...common, ...llm.forForeman(), ...env },
      logs,
      LISTENING.ffServer(PORTS.ffServer),
    );
    ffServer.name = `ff-server (${tag})`;
    await waitForReady(ffServer, base);
    console.log(`ff-server поднят для «${name}»`);

    const account = loadOrCreateAccount(join(data, "bench-account.json"), log);
    // Сохранение одно, а playthrough у путей разный: иначе второй путь
    // получил бы историю первого и отвечал бы по чужому разговору.
    runs[name] = await askForeman(base, account, `bench-${tag}-${basename(save)}`, questions, log);

    try {
      process.kill(-ffServer.child.pid, "SIGTERM");
    } catch {
      /* уже умер */
    }
    started.splice(started.indexOf(ffServer), 1);
  }

  return { model: llm.model, questions: questions.length, runs };
}

// Запуск только когда файл позвали напрямую: иначе `foremanRevision` и
// `describeForeman` нельзя импортировать в проверке, не поднимая стенд.
if (process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  main().catch((err) => {
    console.error(`стенд не доработал: ${err instanceof Error ? err.message : String(err)}`);
    stopAll();
    process.exit(1);
  });
}
