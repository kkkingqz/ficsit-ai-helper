import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import {
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
    const fake = await fakeForeman((_seen, req, res) => {
      if (req.url?.startsWith("/api/auth/") === true) {
        res.writeHead(200, { "set-cookie": "better-auth.session_token=ok" });
        res.end("{}");
        return;
      }
      if (req.url === `/api/playthroughs/${id}`) {
        json(res, 404, {});
        return;
      }
      if (req.url === "/api/foremen") {
        json(res, 200, [{ id: "foreman-1", name: "FICSIT AI" }]);
        return;
      }
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
    writeFileSync(path, '{"email":"есть","password":""}');
    expect(() => loadOrCreateAccount(path)).toThrow(/нет email и пароля/);
  });
});
