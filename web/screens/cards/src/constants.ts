import type { SupportedCardType } from './types.js';

export const SUPPORTED_CARD_TYPES: readonly SupportedCardType[] = ['metric', 'timeseries'] as const;

export const METRIC_ID_PATTERN = /^[a-z][a-z0-9_.]{0,63}$/;

export const MAX_CARD_OPTIONS = 8;
export const MAX_TITLE_LENGTH = 80;

export const DEFAULT_CARD_STRINGS = {
  assistantEstimate: 'Оценка ассистента',
  liveTelemetry: 'Телеметрия',
  fresh: 'Актуально',
  stale: 'Устарело',
  loading: 'Загрузка...',
  empty: 'Нет данных',
  error: 'Ошибка',
  invalidFormat: 'Невалидный формат карточки',
  unsupportedWidget: 'Тип карточки пока не поддерживается',
  metricNotFound: 'Метрика отсутствует в каталоге',
  metricLoadError: 'Не удалось получить значение метрики',
  seriesLoadError: 'Не удалось загрузить временной ряд',
} as const;
