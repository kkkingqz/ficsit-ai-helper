import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Logger } from "./log.js";

/**
 * Сессия Foreman: автоматический вход и сопоставление сохранения игры с
 * playthrough (S2, задача #10).
 *
 * Зачем вообще вход. У Foreman весь `/api/*` закрыт Better Auth: без сессии
 * любой запрос — 401. Пользователь сайдкара в этой схеме один — сам мод, и
 * спрашивать у игрока логин неоткуда (V-08: от распаковки до первого ответа
 * без правки конфигов, кроме ключа провайдера). Поэтому адаптер заводит себе
 * локальный аккаунт при первом запуске и дальше входит сам.
 *
 * **Cookie сессии на диск не пишется.** Она живёт только в памяти процесса:
 * иначе рядом с базой появился бы второй файл с действующим секретом, а цена
 * его отсутствия — один лишний вход при перезапуске. Пароль хранится в файле
 * аккаунта с правами 600 и в лог не попадает никогда.
 */

/** Имя персоны Foreman, под которой работает мод. Ищется по имени, не по id. */
const FOREMAN_NAME = "FICSIT AI";

const FOREMAN_PERSONALITY =
  "Ты помощник инженера в Satisfactory. Отвечай коротко и по делу, числа бери из инструментов.";

/** Префикс идентификатора playthrough, собранного из saveId. */
const PLAYTHROUGH_PREFIX = "fa-";

export interface ForemanAccount {
  email: string;
  name: string;
  password: string;
}

export class ForemanError extends Error {
  public constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "ForemanError";
  }
}

/**
 * Идентификатор playthrough из идентификатора сохранения.
 *
 * Своего хранилища для связи «сохранение → playthrough» у сайдкара нет и быть
 * не должно: данные разговора живут в одной базе — базе Foreman (§10). Поэтому
 * связь не хранится, а вычисляется: один и тот же `saveId` всегда даёт один и
 * тот же идентификатор, и его же мы передаём Foreman при создании.
 *
 * Отпечаток, а не сам `saveId`: Foreman принимает клиентский идентификатор
 * только из латиницы, цифр, дефиса и подчёркивания (до 128 знаков), а имя
 * сессии игры не ограничено ничем. Заодно имя сессии не уезжает в чужой
 * идентификатор.
 */
export function playthroughIdFor(saveId: string): string {
  const digest = createHash("sha256").update(saveId, "utf8").digest("hex");
  return `${PLAYTHROUGH_PREFIX}${digest.slice(0, 32)}`;
}

/** Создаёт файл аккаунта, если его ещё нет, и возвращает учётные данные. */
export function loadOrCreateAccount(path: string): ForemanAccount {
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as Partial<ForemanAccount>;
    if (
      typeof parsed.email === "string" &&
      typeof parsed.password === "string" &&
      parsed.email.length > 0 &&
      parsed.password.length > 0
    ) {
      return { email: parsed.email, name: parsed.name ?? "FICSIT AI", password: parsed.password };
    }
    throw new ForemanError(`файл аккаунта ${path} есть, но в нём нет email и пароля`);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }

  // Пароль видит только этот файл: в лог, в аргументы команд и в ответы API он
  // не уходит. 32 байта из криптографического источника — не «сложность», а
  // длина: подбирать его некому, но и записывать слабый незачем.
  const account: ForemanAccount = {
    email: "adapter@ficsitai.local",
    name: "FICSIT AI",
    password: randomBytes(32).toString("base64url"),
  };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(account, undefined, 2)}\n`, { mode: 0o600 });
  return account;
}

/** Склеивает cookie из ответа Better Auth в строку заголовка `cookie`. */
function cookieHeaderFrom(response: Response, previous: string): string {
  const jar = new Map<string, string>();
  for (const pair of previous.split("; ")) {
    const eq = pair.indexOf("=");
    if (eq > 0) jar.set(pair.slice(0, eq), pair.slice(eq + 1));
  }
  for (const raw of response.headers.getSetCookie()) {
    const first = raw.split(";", 1)[0] ?? "";
    const eq = first.indexOf("=");
    if (eq <= 0) continue;
    const name = first.slice(0, eq);
    const value = first.slice(eq + 1);
    if (value.length === 0) jar.delete(name);
    else jar.set(name, value);
  }
  return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
}

export class ForemanSession {
  private cookie = "";
  private foremanId: string | undefined;

  /**
   * Свой `Origin` в каждом запросе.
   *
   * Better Auth отвечает `403 MISSING_OR_NULL_ORIGIN` на запрос без этого
   * заголовка: защита от межсайтовых запросов написана для браузера, а
   * `fetch` в Node ничего не подставляет. `ff-server` доверяет `Origin`,
   * host которого совпадает с адресом запроса, — то есть ровно тому, что
   * прислала бы страница с того же адреса. Защиту это не ослабляет: она про
   * чужие страницы, а адаптер страницей не является и ходит на петлю.
   */
  private readonly origin: string;

  public constructor(
    private readonly baseUrl: string,
    private readonly account: ForemanAccount,
    private readonly log: Logger,
  ) {
    this.origin = new URL(baseUrl).origin;
  }

  /** true, когда в памяти есть cookie сессии (не проверяя её у Foreman). */
  public get authenticated(): boolean {
    return this.cookie.length > 0;
  }

  private url(path: string): string {
    return new URL(path, this.baseUrl).toString();
  }

  /**
   * Вход: сначала обычный, при «нет такого пользователя» — регистрация.
   *
   * Порядок именно такой, а не «сначала регистрация»: вход — обычный случай
   * каждого запуска, а регистрация бывает один раз за установку. Better Auth
   * на неверные учётные данные и на отсутствующего пользователя отвечает
   * одинаково (401), поэтому отличить «не завёлся» от «пароль не тот» можно
   * только попыткой регистрации: она вернёт 422, если пользователь уже есть.
   */
  public async authenticate(): Promise<void> {
    const body = JSON.stringify({
      email: this.account.email,
      password: this.account.password,
      name: this.account.name,
    });
    const signIn = await fetch(this.url("/api/auth/sign-in/email"), {
      method: "POST",
      headers: { "content-type": "application/json", origin: this.origin },
      body,
    });
    if (signIn.ok) {
      this.cookie = cookieHeaderFrom(signIn, this.cookie);
      this.log.debug("вход в Foreman выполнен");
      return;
    }

    const signUp = await fetch(this.url("/api/auth/sign-up/email"), {
      method: "POST",
      headers: { "content-type": "application/json", origin: this.origin },
      body,
    });
    if (signUp.ok) {
      this.cookie = cookieHeaderFrom(signUp, this.cookie);
      this.log.info("локальный аккаунт Foreman создан при первом запуске");
      return;
    }

    // Ни вход, ни регистрация: дальше идти некуда. Тело ответа не пишем —
    // в него Better Auth кладёт присланный адрес, а рядом лежал пароль.
    throw new ForemanError(
      `вход в Foreman не удался: sign-in ${signIn.status}, sign-up ${signUp.status}. ` +
        "Если аккаунт заведён с другим паролем, удалите файл аккаунта адаптера и перезапустите сайдкар",
      signUp.status,
    );
  }

  /**
   * Запрос к API Foreman с сессией. На 401 входит заново и повторяет один раз:
   * сессия Better Auth живёт дольше запуска игры, но не вечно, и отдавать моду
   * ошибку из-за истёкшей cookie незачем.
   */
  public async request(path: string, init: RequestInit = {}): Promise<Response> {
    if (!this.authenticated) await this.authenticate();

    const send = (): Promise<Response> =>
      fetch(this.url(path), {
        ...init,
        headers: {
          ...(init.headers as Record<string, string>),
          cookie: this.cookie,
          origin: this.origin,
        },
        redirect: "manual",
      });

    let response = await send();
    if (response.status === 401) {
      this.log.debug("сессия Foreman истекла — вхожу заново");
      this.cookie = "";
      await this.authenticate();
      response = await send();
    }
    return response;
  }

  private async json<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.request(path, init);
    if (!response.ok) {
      throw new ForemanError(`${init.method ?? "GET"} ${path} → ${response.status}`, response.status);
    }
    return (await response.json()) as T;
  }

  /** Персона, под которой работает мод: ищется по имени, создаётся один раз. */
  public async ensureForeman(): Promise<string> {
    if (this.foremanId !== undefined) return this.foremanId;

    const existing = await this.json<{ id: string; name: string }[]>("/api/foremen");
    const found = existing.find((foreman) => foreman.name === FOREMAN_NAME);
    if (found !== undefined) {
      this.foremanId = found.id;
      return found.id;
    }

    const created = await this.json<{ id: string }>("/api/foremen", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: FOREMAN_NAME, personality: FOREMAN_PERSONALITY }),
    });
    this.foremanId = created.id;
    this.log.info("персона Foreman для мода создана");
    return created.id;
  }

  /**
   * Playthrough для сохранения игры: берётся существующий, иначе создаётся с
   * нашим же идентификатором. Пути к файлу `.sav` здесь нет и не будет —
   * сайдкар говорит о сохранении идентификатором, а файлы остаются делом
   * Foreman (`SAVE_DATA_DIR`).
   */
  public async resolvePlaythrough(saveId: string, saveName?: string): Promise<string> {
    if (saveId.length === 0) throw new ForemanError("saveId пустой");
    const id = playthroughIdFor(saveId);

    const existing = await this.request(`/api/playthroughs/${id}`);
    if (existing.ok) return id;
    if (existing.status !== 404) {
      throw new ForemanError(`GET /api/playthroughs/${id} → ${existing.status}`, existing.status);
    }

    const foremanId = await this.ensureForeman();
    const created = await this.request("/api/playthroughs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, foremanId, name: saveName ?? saveId }),
    });
    // 409 — тот же playthrough успели создать параллельно: это не ошибка,
    // идентификатор всё равно наш.
    if (created.ok || created.status === 409) {
      if (created.ok) this.log.info(`playthrough для сохранения создан (${id})`);
      return id;
    }
    throw new ForemanError(`POST /api/playthroughs → ${created.status}`, created.status);
  }
}
