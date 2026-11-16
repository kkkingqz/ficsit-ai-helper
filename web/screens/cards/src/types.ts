import type {
  FicsitAIApi,
  MetricDescriptor,
  MetricSeries,
  MetricValue,
  Unit,
} from '@ficsitai/screens-api';

/**
 * Типы виджетов карточек по схеме chat-card.schema.json (ARCHITECTURE.md §7.6)
 */
export type CardWidgetType =
  | 'metric'
  | 'timeseries'
  | 'table'
  | 'text'
  | 'production_graph'
  | 'line';

/**
 * Поддерживаемые виджеты карточек в рамках v0.1 (задача #31, AC-18)
 */
export type SupportedCardType = 'metric' | 'timeseries';

export interface CardSource {
  kind: 'metric' | 'line' | 'plan';
  id: string;
}

export type CardOptionValue = string | number | boolean;

export interface CardData {
  text?: string | undefined;
  columns?: string[] | undefined;
  rows?: string[][] | undefined;
}

/**
 * Контракт карточки в ответе модели (chat-card.schema.json, schemaVersion: 1)
 */
export interface ChatCard {
  schemaVersion: 1;
  type: CardWidgetType;
  title: string;
  source?: CardSource | undefined;
  options?: Record<string, CardOptionValue> | undefined;
  data?: CardData | undefined;
}

/**
 * Результат валидации карточки
 */
export type CardValidationResult =
  | {
      ok: true;
      card: ChatCard;
    }
  | {
      ok: false;
      error: string;
      fallbackText: string;
    };

/**
 * Состояние актуальности данных карточки
 */
export type CardFreshness = 'fresh' | 'stale' | 'loading' | 'empty' | 'error';

/**
 * Разрешённое состояние ссылочной или статической карточки
 */
export interface ResolvedCard {
  card: ChatCard;
  status: CardFreshness;
  isReference: boolean;
  metric?: MetricValue | undefined;
  series?: MetricSeries | undefined;
  descriptor?: MetricDescriptor | undefined;
  error?: string | undefined;
  fallbackText: string;
}

/**
 * Результат рендеринга карточки
 */
export interface CardRenderModel {
  title: string;
  type: CardWidgetType;
  status: CardFreshness;
  isReference: boolean;
  badgeText: string;
  primaryValue: string;
  unit: Unit | string;
  secondaryText?: string | undefined;
  points?: Array<{ timeSec: number; value: number }> | undefined;
  html: string;
  fallbackText: string;
}

export type { FicsitAIApi };
