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

import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, openSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, basename } from "node:path";
import { pathToFileURL } from "node:url";

const REPO = resolve(import.meta.dirname, "../../../..");
const ADAPTER = join(REPO, "sidecar/adapter");
const FOREMAN_SRC = process.env.FOREMAN_SRC ?? join(process.env.HOME ?? ".", "Projects/foreman-src");

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

function nodeCommand() {
  // Тот же приём, что в `foreman-local.sh`: системный Node 22, иначе разовый
  // nix shell. Профиль не меняем.
  return process.env.BENCH_NODE_PREFIX ?? "";
}

function startProcess(name, cwd, script, env, logDir) {
  const out = openSync(join(logDir, `${name}.log`), "a");
  const prefix = nodeCommand();
  const command = prefix === "" ? "npm" : prefix.split(" ")[0];
  const args = prefix === "" ? script : [...prefix.split(" ").slice(1), "npm", ...script];
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ["ignore", out, out],
    detached: true,
  });
  started.push({ name, child });
  return child;
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

async function waitForHttp(url, name, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await fetch(url, { signal: AbortSignal.timeout(2000) });
      return;
    } catch {
      if (Date.now() > deadline) throw new Error(`${name} не поднялся за ${timeoutMs} мс: ${url}`);
      await new Promise((done) => setTimeout(done, 500));
    }
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

function report(data) {
  const lines = [];
  lines.push(`# Стенд сравнения со штатным Foreman`);
  lines.push("");
  lines.push(`Прогон ${data.at}. Сохранение: \`${data.save}\`. Foreman: \`${data.foremanCommit}\`.`);
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
  if (!existsSync(FOREMAN_SRC)) {
    console.error(`нет клона Foreman: ${FOREMAN_SRC} (коммит — sidecar/launcher/foreman.pin.json)`);
    process.exit(2);
  }

  const data = mkdtempSync(join(tmpdir(), "ficsitai-bench-"));
  const logs = join(data, "logs");
  const saves = join(data, "saves");
  mkdirSync(logs);
  mkdirSync(saves);
  const token = "bench-token-0123456789abcdef";
  const pin = JSON.parse(readFileSync(join(REPO, "sidecar/launcher/foreman.pin.json"), "utf8"));

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

  startProcess("sf-mcp", FOREMAN_SRC, ["run", "start:mcp"], common, logs);
  await waitForHttp(`http://127.0.0.1:${PORTS.sfMcp}/health`, "sf-mcp");
  console.log(`sf-mcp поднят на ${PORTS.sfMcp}`);

  startProcess(
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
      ADAPTER_LOG_LEVEL: "warn",
      ...(llm === undefined
        ? {}
        : {
            LLM_UPSTREAM_BASE_URL: llm.upstream,
            NORMALIZER_PORT: String(PORTS.normalizer),
          }),
    },
    logs,
  );
  await waitForHttp(`http://127.0.0.1:${PORTS.adapter}/health`, "адаптер");
  console.log(`адаптер поднят на ${PORTS.adapter}`);

  const surface = await toolSurfaces(token, log);
  console.log(
    `поверхность: штатный ${surface.stockTools.length}, наш ${surface.ourTools.length}, ` +
      `скрыто ${surface.hidden.length}`,
  );

  let model;
  if (llm !== undefined) {
    await waitForHttp(`http://127.0.0.1:${PORTS.normalizer}`, "нормализатор");
    console.log(`нормализатор поднят на ${PORTS.normalizer} (ADR-034, нужен обоим путям)`);
    model = await modelRuns(data, logs, token, save, log, llm);
  }

  const text = report({
    at: new Date().toISOString(),
    save,
    foremanCommit: `${pin.commit.slice(0, 8)} (${pin.commitDate})`,
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
    startProcess(
      "ff-server",
      FOREMAN_SRC,
      ["run", "start:server"],
      { ...common, ...llm.forForeman(), ...env },
      logs,
    );
    await waitForHttp(base, `ff-server (${tag})`);
    console.log(`ff-server поднят для «${name}»`);

    const account = loadOrCreateAccount(join(data, "bench-account.json"), log);
    // Сохранение одно, а playthrough у путей разный: иначе второй путь
    // получил бы историю первого и отвечал бы по чужому разговору.
    runs[name] = await askForeman(base, account, `bench-${tag}-${basename(save)}`, questions, log);

    const ff = started.find((item) => item.name === "ff-server");
    if (ff !== undefined) {
      try {
        process.kill(-ff.child.pid, "SIGTERM");
      } catch {
        /* уже умер */
      }
      started.splice(started.indexOf(ff), 1);
    }
    await new Promise((done) => setTimeout(done, 1500));
  }

  return { model: llm.model, questions: questions.length, runs };
}

main().catch((err) => {
  console.error(`стенд не доработал: ${err instanceof Error ? err.message : String(err)}`);
  stopAll();
  process.exit(1);
});
