import {
  DEFAULT_CARD_STRINGS,
  MAX_CARD_OPTIONS,
  MAX_TITLE_LENGTH,
  METRIC_ID_PATTERN,
  SUPPORTED_CARD_TYPES,
} from './constants.js';
import type { CardValidationResult, ChatCard } from './types.js';

/**
 * Валидирует аргументы вызова show_card по контракту chat-card.schema.json (AC-18).
 * При ошибке формирует человекочитаемый fallbackText для текстового ответа в чате.
 */
export function validateCard(rawInput: unknown): CardValidationResult {
  if (typeof rawInput !== 'object' || rawInput === null || Array.isArray(rawInput)) {
    return {
      ok: false,
      error: 'Входные данные карточки должны быть объектом',
      fallbackText: `[${DEFAULT_CARD_STRINGS.invalidFormat}: ожидался объект]`,
    };
  }

  const candidate = rawInput as Record<string, unknown>;

  // Проверка версии схемы
  if (candidate['schemaVersion'] !== 1) {
    return {
      ok: false,
      error: `Неподдерживаемая версия схемы: ${String(candidate['schemaVersion'])}, ожидается 1`,
      fallbackText: `[${DEFAULT_CARD_STRINGS.invalidFormat}: версия схемы должна быть 1]`,
    };
  }

  // Проверка заголовка
  const title = candidate['title'];
  if (typeof title !== 'string' || title.trim().length === 0 || title.length > MAX_TITLE_LENGTH) {
    return {
      ok: false,
      error: `Поле title должно быть непустой строкой длиной до ${MAX_TITLE_LENGTH} символов`,
      fallbackText: `[${DEFAULT_CARD_STRINGS.invalidFormat}: некорректный заголовок]`,
    };
  }

  // Проверка типа виджета
  const type = candidate['type'];
  if (typeof type !== 'string') {
    return {
      ok: false,
      error: 'Поле type должно быть строкой',
      fallbackText: `[${title} — ${DEFAULT_CARD_STRINGS.invalidFormat}: отсутствует тип виджета]`,
    };
  }

  const validTypes = ['metric', 'timeseries', 'table', 'text', 'production_graph', 'line'];
  if (!validTypes.includes(type)) {
    return {
      ok: false,
      error: `Неизвестный тип виджета: ${type}`,
      fallbackText: `[${title} — ${DEFAULT_CARD_STRINGS.invalidFormat}: неизвестный тип "${type}"]`,
    };
  }

  // Проверка поддержки типа в v0.1 (#31 / AC-18: metric и timeseries из Статистики)
  if (!SUPPORTED_CARD_TYPES.includes(type as (typeof SUPPORTED_CARD_TYPES)[number])) {
    return {
      ok: false,
      error: `Тип виджета "${type}" не поддерживается в v0.1 (поддерживаются: ${SUPPORTED_CARD_TYPES.join(', ')})`,
      fallbackText: `[${title} — виджет "${type}" временно недоступен в текущей версии]`,
    };
  }

  const hasSource = 'source' in candidate && candidate['source'] !== undefined && candidate['source'] !== null;
  const hasData = 'data' in candidate && candidate['data'] !== undefined && candidate['data'] !== null;

  // Инвариант oneOf: либо source, либо data
  if ((hasSource && hasData) || (!hasSource && !hasData)) {
    return {
      ok: false,
      error: 'Карточка должна содержать ровно одно из полей: source (ссылочная) или data (оценка ассистента)',
      fallbackText: `[${title} — ${DEFAULT_CARD_STRINGS.invalidFormat}: должно быть указано ровно одно из полей source или data]`,
    };
  }

  // Ссылочные карточки (metric, timeseries) требуют source
  if (type === 'metric' || type === 'timeseries') {
    if (!hasSource) {
      return {
        ok: false,
        error: `Виджет типа "${type}" требует наличия поля source`,
        fallbackText: `[${title} — ${DEFAULT_CARD_STRINGS.invalidFormat}: для типа "${type}" требуется источник source]`,
      };
    }
  }

  // Валидация source
  if (hasSource) {
    const sourceObj = candidate['source'];
    if (typeof sourceObj !== 'object' || sourceObj === null || Array.isArray(sourceObj)) {
      return {
        ok: false,
        error: 'Поле source должно быть объектом { kind, id }',
        fallbackText: `[${title} — ${DEFAULT_CARD_STRINGS.invalidFormat}: неверная структура source]`,
      };
    }

    const s = sourceObj as Record<string, unknown>;
    const kind = s['kind'];
    const id = s['id'];

    if (kind !== 'metric' && kind !== 'line' && kind !== 'plan') {
      return {
        ok: false,
        error: `Неизвестный source.kind: ${String(kind)}, ожидается metric, line или plan`,
        fallbackText: `[${title} — ${DEFAULT_CARD_STRINGS.invalidFormat}: неизвестный источник "${String(kind)}"]`,
      };
    }

    if (typeof id !== 'string' || !METRIC_ID_PATTERN.test(id)) {
      return {
        ok: false,
        error: `Некорректный source.id: "${String(id)}", ожидается соответствие шаблону ^[a-z][a-z0-9_.]{0,63}$`,
        fallbackText: `[${title} — ${DEFAULT_CARD_STRINGS.invalidFormat}: неверный ID источника "${String(id)}"]`,
      };
    }
  }

  // Валидация options при наличии
  if ('options' in candidate && candidate['options'] !== undefined) {
    const opts = candidate['options'];
    if (typeof opts !== 'object' || opts === null || Array.isArray(opts)) {
      return {
        ok: false,
        error: 'Поле options должно быть объектом',
        fallbackText: `[${title} — ${DEFAULT_CARD_STRINGS.invalidFormat}: options должен быть объектом]`,
      };
    }
    const keys = Object.keys(opts);
    if (keys.length > MAX_CARD_OPTIONS) {
      return {
        ok: false,
        error: `В поле options превышен лимит свойств: ${keys.length} > ${MAX_CARD_OPTIONS}`,
        fallbackText: `[${title} — ${DEFAULT_CARD_STRINGS.invalidFormat}: слишком много опций]`,
      };
    }
    for (const key of keys) {
      const val = (opts as Record<string, unknown>)[key];
      const valType = typeof val;
      if (valType !== 'string' && valType !== 'number' && valType !== 'boolean') {
        return {
          ok: false,
          error: `Свойство options.${key} имеет недопустимый тип ${valType}`,
          fallbackText: `[${title} — ${DEFAULT_CARD_STRINGS.invalidFormat}: опция "${key}" имеет недопустимый тип]`,
        };
      }
    }
  }

  return {
    ok: true,
    card: candidate as unknown as ChatCard,
  };
}
