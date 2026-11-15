import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
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

/**
 * Что делать, когда файл аккаунта потерян или не совпал с базой.
 *
 * Не «удалите файл» (ревью Gs на #48, п. 2): пароль в файле — пароль записи в
 * базе Foreman, а email адаптер каждый раз берёт один и тот же. Новый файл
 * даёт новый пароль к той же записи, то есть `sign-in 401` и `sign-up 422`
 * по кругу. Файл и база — пара: восстанавливаются вместе или убираются вместе.
 */
export function accountRecoveryHint(path?: string): string {
  const file = path === undefined ? "файл аккаунта адаптера" : `файл ${path}`;
  return (
    `В нём пароль к записи в базе Foreman, и заново он не выводится: восстановите ${file} ` +
    "из копии рядом с базой. Нужен чистый лист — уберите файл вместе с базой Foreman: " +
    "новый файл при старой базе даёт тот же email с новым паролем, и вход не пройдёт"
  );
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

/**
 * Создаёт файл аккаунта, если его ещё нет, и возвращает учётные данные.
 *
 * Два правила про секрет, оба — по ревью Gs на #48:
 *
 * - **текст ошибки не несёт содержимого файла.** `JSON.parse` кладёт в
 *   `SyntaxError.message` кусок разбираемой строки, то есть при повреждённом
 *   файле — кусок пароля, а это сообщение уходит в стартовый лог;
 * - **права существующего файла проверяются.** Файл, созданный чужой рукой с
 *   режимом 0644, читается молча, и пароль доступен любому процессу
 *   пользователя. Мы его не чиним сами: это чужое решение, но отказываемся
 *   работать и говорим, что сделать.
 */
export function loadOrCreateAccount(
  path: string,
  platform: NodeJS.Platform = process.platform,
): ForemanAccount {
  let raw: string | undefined;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }

  if (raw !== undefined) {
    assertPrivateMode(path, platform);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Сообщение разбора сюда не попадает — в нём бывает кусок пароля.
      throw new ForemanError(
        `файл аккаунта ${path} не разобран как JSON. ${accountRecoveryHint()}`,
      );
    }
    // `null` — тоже разобранный JSON: без этой проверки дальше был сырой
    // `TypeError` вместо диагностики файла (ревью Gs на #48, п. 2).
    if (typeof parsed !== "object" || parsed === null) {
      throw new ForemanError(
        `файл аккаунта ${path} разобран как JSON, но в нём не объект. ${accountRecoveryHint()}`,
      );
    }
    const fields = parsed as Partial<ForemanAccount>;
    if (
      typeof fields.email === "string" &&
      typeof fields.password === "string" &&
      fields.email.length > 0 &&
      fields.password.length > 0
    ) {
      return { email: fields.email, name: fields.name ?? "FICSIT AI", password: fields.password };
    }
    throw new ForemanError(
      `файл аккаунта ${path} есть, но в нём нет email и пароля. ${accountRecoveryHint()}`,
    );
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

/**
 * Отказ, если файл с паролем доступен не только владельцу.
 *
 * Только на платформах с POSIX-правами. На Windows `writeFileSync` с
 * `mode: 0o600` даёт файл с режимом `666` (в режиме живёт лишь бит «только
 * чтение»), и прежняя проверка «есть биты для других» отказывала сайдкару
 * читать свой же файл при втором запуске — на штатной раскладке S5-lite
 * (ревью Gs на #48, п. 1). Доступ там ограничивают ACL каталога данных
 * пользователя, а `chmod 600` в подсказке нечем выполнить.
 */
function assertPrivateMode(path: string, platform: NodeJS.Platform): void {
  if (platform === "win32") return;
  const mode = statSync(path).mode & 0o777;
  if ((mode & 0o077) === 0) return;
  throw new ForemanError(
    `файл аккаунта ${path} доступен не только владельцу (права ${mode.toString(8)}). ` +
      `Исправьте: chmod 600 ${path}`,
  );
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
   * Один полёт на операцию: вход, создание персоны и разрешение одного
   * сохранения выполняются по разу, сколько бы запросов их ни попросило.
   *
   * Без этого (ревью Gs на #48) фоновый вход при старте и первый запрос мода
   * шли в регистрацию вдвоём, и один получал `422` при уже выданной сессии;
   * два `resolvePlaythrough` подряд создавали две одноимённые персоны, а у
   * закреплённого Foreman проверка существования и вставка идут отдельно,
   * так что вторая вставка могла вернуть `500`.
   */
  private signingIn: Promise<void> | undefined;
  private ensuringForeman: Promise<string> | undefined;
  private readonly resolving = new Map<string, Promise<string>>();

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
    /** Путь файла аккаунта — только для подсказки в ошибке входа. */
    private readonly accountPath?: string,
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
    // Второй вызов не повторяет вход, а ждёт первого.
    const inFlight = this.signingIn;
    if (inFlight !== undefined) return await inFlight;

    const attempt = this.signIn().finally(() => {
      this.signingIn = undefined;
    });
    this.signingIn = attempt;
    return await attempt;
  }

  private async signIn(): Promise<void> {
    const body = JSON.stringify({
      email: this.account.email,
      password: this.account.password,
      name: this.account.name,
    });
    // Переход по `Location` здесь запрещён так же, как в запросах API: на
    // `307` тело запроса повторяется целиком, то есть пароль уходит на чужой
    // origin, а его `Set-Cookie` мы бы приняли за свою сессию (ревью Gs #48).
    const signIn = await fetch(this.url("/api/auth/sign-in/email"), {
      method: "POST",
      headers: { "content-type": "application/json", origin: this.origin },
      body,
      redirect: "manual",
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
      redirect: "manual",
    });
    if (signUp.ok) {
      this.cookie = cookieHeaderFrom(signUp, this.cookie);
      this.log.info("локальный аккаунт Foreman создан при первом запуске");
      return;
    }

    // Ни вход, ни регистрация: дальше идти некуда. Тело ответа не пишем —
    // в него Better Auth кладёт присланный адрес, а рядом лежал пароль.
    //
    // Что именно случилось, видно по паре кодов, и путать эти случаи дорого
    // (третий круг ревью Gs на #48): на `503` адаптер советовал убрать файл
    // аккаунта вместе с базой, то есть предлагал стереть разговоры из-за
    // того, что Foreman не поднялся.
    if (signIn.status >= 500 || signUp.status >= 500) {
      throw new ForemanError(
        `Foreman не отвечает: sign-in ${signIn.status}, sign-up ${signUp.status}. ` +
          "Учётные данные целы, вход повторится сам, когда Foreman поднимется",
        signUp.status,
      );
    }
    // Конфликт существующей записи: вход отвергнут, а регистрация говорит,
    // что пользователь уже есть. Только здесь подсказка про копию уместна.
    if (signIn.status === 401 && (signUp.status === 422 || signUp.status === 409)) {
      throw new ForemanError(
        `вход в Foreman не удался: sign-in ${signIn.status}, sign-up ${signUp.status}. ` +
          `Запись ${this.account.email} в базе Foreman заведена с другим паролем. ` +
          accountRecoveryHint(this.accountPath),
        signUp.status,
      );
    }
    throw new ForemanError(
      `вход в Foreman не удался: sign-in ${signIn.status}, sign-up ${signUp.status}`,
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
    const inFlight = this.ensuringForeman;
    if (inFlight !== undefined) return await inFlight;

    const attempt = this.findOrCreateForeman().finally(() => {
      this.ensuringForeman = undefined;
    });
    this.ensuringForeman = attempt;
    return await attempt;
  }

  private async findOrCreateForeman(): Promise<string> {
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

    // Один полёт на сохранение: два одновременных запроса одного saveId
    // создавали playthrough дважды.
    const inFlight = this.resolving.get(id);
    if (inFlight !== undefined) return await inFlight;

    const attempt = this.findOrCreatePlaythrough(id, saveId, saveName).finally(() => {
      this.resolving.delete(id);
    });
    this.resolving.set(id, attempt);
    return await attempt;
  }

  private async findOrCreatePlaythrough(
    id: string,
    saveId: string,
    saveName?: string,
  ): Promise<string> {
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
    if (created.ok) {
      this.log.info(`playthrough для сохранения создан (${id})`);
      return id;
    }

    // Чужая вставка того же идентификатора. У закреплённого Foreman проверка
    // существования и вставка идут отдельными запросами, поэтому конфликт
    // виден и как `409`, и как `500` от уникального ограничения. Гадать не
    // надо: спрашиваем ещё раз, и если playthrough на месте — он наш
    // (ревью Gs #48).
    if (created.status === 409 || created.status >= 500) {
      const again = await this.request(`/api/playthroughs/${id}`);
      if (again.ok) return id;
    }
    throw new ForemanError(`POST /api/playthroughs → ${created.status}`, created.status);
  }
}
