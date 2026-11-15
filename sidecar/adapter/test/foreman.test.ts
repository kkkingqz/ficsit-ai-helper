import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { chmodSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { loadConfig } from "../src/config.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import {
  ForemanError,
  ForemanSession,
  loadOrCreateAccount,
  playthroughIdFor,
  type ForemanAccount,
} from "../src/foreman.js";
import type { Logger } from "../src/log.js";

/**
 * S2: автоматический вход в Foreman и сопоставление сохранения с playthrough.
 *
 * Проверки идут против поддельного Foreman на петле, а не против заглушки
 * `fetch`: вход — это cookie, коды ответов и порядок двух запросов, и именно
 * здесь прошлый раз пряталась разница между «работает» и «кажется».
 */

const silent: Logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

const account: ForemanAccount = {
  email: "adapter@ficsitai.local",
  name: "FICSIT AI",
  password: "пароль-для-теста-0123456789",
};

interface Seen {
  method: string;
  url: string;
  cookie: string | undefined;
  origin: string | undefined;
  body: string;
}

interface Fake {
  port: number;
  seen: Seen[];
  close: () => Promise<void>;
}

type Handler = (seen: Seen[], req: IncomingMessage, res: ServerResponse) => void;

async function fakeForeman(handler: Handler): Promise<Fake> {
  const seen: Seen[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      seen.push({
        method: req.method ?? "",
        url: req.url ?? "",
        cookie: req.headers.cookie,
        origin: req.headers.origin,
        body: Buffer.concat(chunks).toString("utf8"),
      });
      handler(seen, req, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    port: (server.address() as AddressInfo).port,
    seen,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

const json = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

const sessionOf = (fake: Fake): ForemanSession =>
  new ForemanSession(`http://127.0.0.1:${fake.port}`, account, silent);

describe("вход в Foreman", () => {
  it("обычный запуск: один вход, регистрацию не трогает", async () => {
    const fake = await fakeForeman((_seen, req, res) => {
      if (req.url === "/api/auth/sign-in/email") {
        res.writeHead(200, { "set-cookie": "better-auth.session_token=live; Path=/; HttpOnly" });
        res.end("{}");
        return;
      }
      json(res, 500, { error: "сюда ходить было не нужно" });
    });

    try {
      const session = sessionOf(fake);
      expect(session.authenticated).toBe(false);
      await session.authenticate();
      expect(session.authenticated).toBe(true);
      expect(fake.seen.map((s) => s.url)).toEqual(["/api/auth/sign-in/email"]);
    } finally {
      await fake.close();
    }
  });

  it("первый запуск: вход не прошёл — регистрируется и получает cookie", async () => {
    const fake = await fakeForeman((_seen, req, res) => {
      if (req.url === "/api/auth/sign-in/email") {
        json(res, 401, { error: "нет такого пользователя" });
        return;
      }
      if (req.url === "/api/auth/sign-up/email") {
        res.writeHead(200, { "set-cookie": "better-auth.session_token=fresh; Path=/" });
        res.end("{}");
        return;
      }
      json(res, 500, {});
    });

    try {
      const session = sessionOf(fake);
      await session.authenticate();
      expect(fake.seen.map((s) => s.url)).toEqual([
        "/api/auth/sign-in/email",
        "/api/auth/sign-up/email",
      ]);
      expect(session.authenticated).toBe(true);
    } finally {
      await fake.close();
    }
  });

  it("ни вход, ни регистрация: ошибка не несёт ни пароля, ни тела ответа", async () => {
    const fake = await fakeForeman((_seen, _req, res) => {
      json(res, 422, { error: `пароль ${account.password} не подошёл` });
    });

    try {
      const session = sessionOf(fake);
      await expect(session.authenticate()).rejects.toThrow(/sign-in 422, sign-up 422/);
      await expect(session.authenticate()).rejects.not.toThrow(
        new RegExp(account.password.slice(0, 12)),
      );
    } finally {
      await fake.close();
    }
  });

  it("Better Auth без Origin отвечает 403 — заголовок шлём в каждом запросе", async () => {
    // Поддельный Foreman ведёт себя как настоящий: нет Origin — нет входа.
    // Проверка держит находку живого прогона 12.11.2026, а не фантазию.
    const fake = await fakeForeman((_seen, req, res) => {
      if (req.headers.origin === undefined) {
        json(res, 403, { message: "Missing or null Origin", code: "MISSING_OR_NULL_ORIGIN" });
        return;
      }
      if (req.url?.startsWith("/api/auth/") === true) {
        res.writeHead(200, { "set-cookie": "better-auth.session_token=live" });
        res.end("{}");
        return;
      }
      json(res, 200, []);
    });

    try {
      const session = sessionOf(fake);
      await session.authenticate();
      expect(fake.seen[0]?.origin).toBe(`http://127.0.0.1:${fake.port}`);
      const response = await session.request("/api/foremen");
      expect(response.status).toBe(200);
      expect(fake.seen.every((s) => s.origin !== undefined)).toBe(true);
    } finally {
      await fake.close();
    }
  });

  it("истёкшая сессия: 401 на запросе — вход заново и один повтор", async () => {
    let authCalls = 0;
    const fake = await fakeForeman((seen, req, res) => {
      if (req.url?.startsWith("/api/auth/") === true) {
        authCalls += 1;
        res.writeHead(200, { "set-cookie": `better-auth.session_token=cookie-${authCalls}` });
        res.end("{}");
        return;
      }
      // Первый запрос с первой cookie отвергается, второй проходит.
      const apiCalls = seen.filter((s) => s.url === "/api/foremen").length;
      if (apiCalls === 1) {
        json(res, 401, { error: "Authentication required." });
        return;
      }
      json(res, 200, []);
    });

    try {
      const session = sessionOf(fake);
      const response = await session.request("/api/foremen");
      expect(response.status).toBe(200);
      expect(authCalls).toBe(2);
      const apiRequests = fake.seen.filter((s) => s.url === "/api/foremen");
      expect(apiRequests).toHaveLength(2);
      expect(apiRequests[0]?.cookie).toContain("cookie-1");
      expect(apiRequests[1]?.cookie).toContain("cookie-2");
    } finally {
      await fake.close();
    }
  });
});

describe("сохранение игры → playthrough", () => {
  it("идентификатор годится для Foreman и не зависит от символов имени сессии", () => {
    const id = playthroughIdFor("Моё сохранение #1 / слот 2");
    expect(id).toMatch(/^fa-[0-9a-f]{32}$/);
    expect(id.length).toBeLessThanOrEqual(128);
  });

  it("один и тот же saveId всегда даёт один и тот же playthrough", () => {
    expect(playthroughIdFor("save-A")).toBe(playthroughIdFor("save-A"));
    expect(playthroughIdFor("save-A")).not.toBe(playthroughIdFor("save-B"));
  });

  it("существующий playthrough берётся, а не создаётся заново", async () => {
    const id = playthroughIdFor("save-A");
    const fake = await fakeForeman((_seen, req, res) => {
      if (req.url?.startsWith("/api/auth/") === true) {
        res.writeHead(200, { "set-cookie": "better-auth.session_token=ok" });
        res.end("{}");
        return;
      }
      if (req.url === `/api/playthroughs/${id}`) {
        json(res, 200, { id });
        return;
      }
      json(res, 500, { error: "лишний запрос" });
    });

    try {
      expect(await sessionOf(fake).resolvePlaythrough("save-A")).toBe(id);
      expect(fake.seen.some((s) => s.method === "POST" && s.url === "/api/playthroughs")).toBe(
        false,
      );
    } finally {
      await fake.close();
    }
  });

  it("нового сохранения ещё нет: playthrough создаётся с нашим id и без пути к файлу", async () => {
    const id = playthroughIdFor("save-B");
    const fake = await fakeForeman((_seen, req, res) => {
      if (req.url?.startsWith("/api/auth/") === true) {
        res.writeHead(200, { "set-cookie": "better-auth.session_token=ok" });
        res.end("{}");
        return;
      }
      if (req.url === `/api/playthroughs/${id}`) {
        json(res, 404, { error: "Playthrough not found." });
        return;
      }
      if (req.url === "/api/foremen" && req.method === "GET") {
        json(res, 200, []);
        return;
      }
      if (req.url === "/api/foremen" && req.method === "POST") {
        json(res, 201, { id: "foreman-1" });
        return;
      }
      if (req.url === "/api/playthroughs" && req.method === "POST") {
        json(res, 201, { id });
        return;
      }
      json(res, 500, {});
    });

    try {
      expect(await sessionOf(fake).resolvePlaythrough("save-B", "Завод у озера")).toBe(id);
      const create = fake.seen.find((s) => s.method === "POST" && s.url === "/api/playthroughs");
      const body = JSON.parse(create?.body ?? "{}") as Record<string, unknown>;
      expect(body.id).toBe(id);
      expect(body.foremanId).toBe("foreman-1");
      expect(body.name).toBe("Завод у озера");
      expect(Object.keys(body)).not.toContain("savePath");
    } finally {
      await fake.close();
    }
  });

  it("гонка двух запусков: 409 на создании — это не ошибка", async () => {
    const id = playthroughIdFor("save-C");
    // Чужой запуск успел создать playthrough между нашим GET и POST: первый
    // GET отвечает 404, POST — 409, а подтверждающий GET уже 200. Так это и
    // выглядит у настоящего Foreman, где проверка и вставка — разные запросы.
    let createdElsewhere = false;
    const fake = await fakeForeman((_seen, req, res) => {
      if (req.url?.startsWith("/api/auth/") === true) {
        res.writeHead(200, { "set-cookie": "better-auth.session_token=ok" });
        res.end("{}");
        return;
      }
      if (req.url === `/api/playthroughs/${id}`) {
        if (createdElsewhere) {
          json(res, 200, { id });
          return;
        }
        json(res, 404, {});
        return;
      }
      if (req.url === "/api/foremen") {
        json(res, 200, [{ id: "foreman-1", name: "FICSIT AI" }]);
        return;
      }
      createdElsewhere = true;
      json(res, 409, { error: `Playthrough '${id}' already exists.` });
    });

    try {
      expect(await sessionOf(fake).resolvePlaythrough("save-C")).toBe(id);
    } finally {
      await fake.close();
    }
  });

  it("персона ищется по имени и создаётся один раз на процесс", async () => {
    const fake = await fakeForeman((_seen, req, res) => {
      if (req.url?.startsWith("/api/auth/") === true) {
        res.writeHead(200, { "set-cookie": "better-auth.session_token=ok" });
        res.end("{}");
        return;
      }
      if (req.url === "/api/foremen") {
        json(res, 200, [
          { id: "чужой", name: "Другой помощник" },
          { id: "наш", name: "FICSIT AI" },
        ]);
        return;
      }
      json(res, 500, {});
    });

    try {
      const session = sessionOf(fake);
      expect(await session.ensureForeman()).toBe("наш");
      expect(await session.ensureForeman()).toBe("наш");
      expect(fake.seen.filter((s) => s.url === "/api/foremen")).toHaveLength(1);
    } finally {
      await fake.close();
    }
  });
});

describe("файл аккаунта", () => {
  it("создаётся с правами 600 и случайным паролем", () => {
    const dir = mkdtempSync(join(tmpdir(), "ficsitai-account-"));
    const path = join(dir, "вложенный", "adapter-account.json");

    const first = loadOrCreateAccount(path);
    expect(first.password.length).toBeGreaterThanOrEqual(32);
    expect(statSync(path).mode & 0o777).toBe(0o600);

    // Второй запуск берёт тот же пароль, иначе прошлый аккаунт станет чужим.
    expect(loadOrCreateAccount(path).password).toBe(first.password);

    const stored = JSON.parse(readFileSync(path, "utf8")) as ForemanAccount;
    expect(stored.email).toBe(first.email);
  });

  it("битый файл — отказ с понятной причиной, а не молчаливый новый аккаунт", () => {
    const dir = mkdtempSync(join(tmpdir(), "ficsitai-account-"));
    const path = join(dir, "adapter-account.json");
    writeFileSync(path, '{"email":"есть","password":""}', { mode: 0o600 });
    expect(() => loadOrCreateAccount(path)).toThrow(/нет email и пароля/);
  });
});

describe("замечания ревью Gs на #48", () => {
  it("вход не идёт за редиректом: пароль не уходит на чужой origin", async () => {
    // Второй сервер — «чужой origin». Он не должен увидеть ни тела, ни того,
    // что его cookie приняли за нашу сессию.
    const other = await fakeForeman((_seen, _req, res) => {
      res.writeHead(200, { "set-cookie": "better-auth.session_token=чужая; Path=/" });
      res.end("{}");
    });
    const foreman = await fakeForeman((_seen, req, res) => {
      if (req.url?.startsWith("/api/auth/")) {
        // 307 повторяет метод и тело целиком — именно так пароль и уезжает.
        res.writeHead(307, { location: `http://127.0.0.1:${other.port}${req.url}` });
        res.end();
        return;
      }
      json(res, 500, { error: "сюда ходить было не нужно" });
    });

    try {
      const session = sessionOf(foreman);
      await expect(session.authenticate()).rejects.toThrow(/вход в Foreman не удался/);
      expect(session.authenticated).toBe(false);
      expect(other.seen).toHaveLength(0);
    } finally {
      await foreman.close();
      await other.close();
    }
  });

  it("повреждённый файл аккаунта не выносит содержимое в ошибку", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "ficsitai-acc-")), "account.json");
    // Пароль в повреждённом JSON: сообщение разбора процитировало бы его.
    writeFileSync(path, '{"email":"a@b","password":"сЕкРеТ-123456', { mode: 0o600 });
    try {
      loadOrCreateAccount(path);
      throw new Error("ожидался отказ");
    } catch (err: unknown) {
      const message = (err as Error).message;
      expect(message).toContain("не разобран");
      expect(message).not.toContain("сЕкРеТ");
    }
  });

  it("файл аккаунта с чужими правами не читается молча", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "ficsitai-acc-")), "account.json");
    writeFileSync(path, JSON.stringify({ email: "a@b", password: "пароль" }), { mode: 0o644 });
    expect(() => loadOrCreateAccount(path)).toThrow(/доступен не только владельцу/);
  });

  it("два одновременных входа дают один запрос к Foreman", async () => {
    const fake = await fakeForeman((_seen, req, res) => {
      if (req.url === "/api/auth/sign-in/email") {
        res.writeHead(200, { "set-cookie": "better-auth.session_token=live; Path=/" });
        res.end("{}");
        return;
      }
      json(res, 500, { error: "регистрация была не нужна" });
    });
    try {
      const session = sessionOf(fake);
      await Promise.all([session.authenticate(), session.authenticate(), session.authenticate()]);
      expect(fake.seen.filter((entry) => entry.url.startsWith("/api/auth/"))).toHaveLength(1);
    } finally {
      await fake.close();
    }
  });

  it("два одновременных запроса одного сохранения создают playthrough один раз", async () => {
    const fake = await fakeForeman((_seen, req, res) => {
      if (req.url === "/api/auth/sign-in/email") {
        res.writeHead(200, { "set-cookie": "better-auth.session_token=live; Path=/" });
        res.end("{}");
        return;
      }
      if (req.method === "GET" && req.url === "/api/foremen") {
        json(res, 200, [{ id: "f-1", name: "FICSIT AI" }]);
        return;
      }
      if (req.method === "GET" && req.url?.startsWith("/api/playthroughs/")) {
        json(res, 404, { error: "нет" });
        return;
      }
      if (req.method === "POST" && req.url === "/api/playthroughs") {
        json(res, 201, { id: "создан" });
        return;
      }
      json(res, 500, { error: req.url });
    });
    try {
      const session = sessionOf(fake);
      const [first, second] = await Promise.all([
        session.resolvePlaythrough("Сейв"),
        session.resolvePlaythrough("Сейв"),
      ]);
      expect(first).toBe(second);
      expect(fake.seen.filter((entry) => entry.url === "/api/playthroughs")).toHaveLength(1);
    } finally {
      await fake.close();
    }
  });

  it("чужая вставка того же идентификатора подтверждается повторным GET", async () => {
    let created = false;
    const fake = await fakeForeman((_seen, req, res) => {
      if (req.url === "/api/auth/sign-in/email") {
        res.writeHead(200, { "set-cookie": "better-auth.session_token=live; Path=/" });
        res.end("{}");
        return;
      }
      if (req.method === "GET" && req.url === "/api/foremen") {
        json(res, 200, [{ id: "f-1", name: "FICSIT AI" }]);
        return;
      }
      if (req.method === "GET" && req.url?.startsWith("/api/playthroughs/")) {
        json(res, created ? 200 : 404, created ? { id: "есть" } : { error: "нет" });
        return;
      }
      if (req.method === "POST" && req.url === "/api/playthroughs") {
        // Уникальное ограничение базы: у закреплённого Foreman это 500.
        created = true;
        json(res, 500, { error: "unique constraint" });
        return;
      }
      json(res, 500, { error: req.url });
    });
    try {
      const session = sessionOf(fake);
      await expect(session.resolvePlaythrough("Сейв")).resolves.toBe(playthroughIdFor("Сейв"));
    } finally {
      await fake.close();
    }
  });

  it("не-петлевой адрес Foreman — отказ запуска", () => {
    expect(() =>
      loadConfig({
        ADAPTER_TOKEN: "x".repeat(32),
        FOREMAN_BASE_URL: "http://10.0.0.5:8724",
      } as NodeJS.ProcessEnv),
    ).toThrow(/петле/);
  });
});

describe("повторное ревью Gs на #48", () => {
  it("на Windows свой же файл аккаунта читается при втором запуске", () => {
    // Windows: `mode: 0o600` при записи даёт `666` — в режиме живёт только бит
    // «только чтение». Прежняя проверка видела биты для других и отказывала
    // сайдкару читать свой файл после перезапуска.
    const path = join(mkdtempSync(join(tmpdir(), "ficsitai-acc-")), "account.json");
    const first = loadOrCreateAccount(path, "win32");
    chmodSync(path, 0o666);

    expect(loadOrCreateAccount(path, "win32").password).toBe(first.password);
    // Там, где права настоящие, отказ остаётся.
    expect(() => loadOrCreateAccount(path, "linux")).toThrow(/доступен не только владельцу/);
  });

  it("`null` в файле аккаунта — диагностика, а не сырой TypeError", () => {
    const path = join(mkdtempSync(join(tmpdir(), "ficsitai-acc-")), "account.json");
    writeFileSync(path, "null", { mode: 0o600 });
    try {
      loadOrCreateAccount(path);
      throw new Error("ожидался отказ");
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(ForemanError);
      expect((err as Error).message).toMatch(/не объект/);
    }
  });

  it("ошибка входа ведёт к копии рядом с базой, а не по кругу к удалению файла", async () => {
    // Запись в базе есть, пароль другой: именно это видит игрок, потерявший
    // файл аккаунта. Подсказка «удалите файл» заводила бы тот же email заново.
    const fake = await fakeForeman((_seen, req, res) => {
      if (req.url === "/api/auth/sign-in/email") {
        json(res, 401, { code: "INVALID_EMAIL_OR_PASSWORD" });
        return;
      }
      json(res, 422, { code: "USER_ALREADY_EXISTS" });
    });

    try {
      const session = new ForemanSession(
        `http://127.0.0.1:${fake.port}`,
        account,
        silent,
        "/данные/adapter-account.json",
      );
      await expect(session.authenticate()).rejects.toThrow(/восстановите файл \/данные\/adapter-account\.json/);
      await expect(session.authenticate()).rejects.not.toThrow(/удалите файл аккаунта адаптера и перезапустите/);
    } finally {
      await fake.close();
    }
  });
});
