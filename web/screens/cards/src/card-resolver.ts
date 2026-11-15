import type {
  FicsitAIApi,
  MetricDescriptor,
  MetricSeries,
  MetricValue,
  SeriesWindow,
} from '@ficsitai/screens-api';
import { DEFAULT_CARD_STRINGS } from './constants.js';
import { evaluateCardFreshness } from './freshness.js';
import type { ChatCard, ResolvedCard } from './types.js';

export interface ResolveCardOptions {
  currentSessionTimeSec?: number | undefined;
}

export function formatUnit(unit: string): string {
  switch (unit) {
    case 'megawatt':
      return 'MW';
    case 'megawattHour':
      return 'MWh';
    case 'itemsPerMinute':
      return 'шт/мин';
    case 'cubicMetersPerMinute':
      return 'м³/мин';
    case 'percent':
      return '%';
    case 'seconds':
      return 'с';
    case 'count':
      return 'шт';
    default:
      return unit;
  }
}

/**
 * Разрешает ссылочную карточку show_card, получая живые значения из фасада FicsitAIApi (AC-18).
 */
export async function resolveCard(
  card: ChatCard,
  api: FicsitAIApi,
  options?: ResolveCardOptions,
): Promise<ResolvedCard> {
  const isReference = Boolean(card.source);

  // Статическая карточка с данными (не v0.1, но базово поддерживается)
  if (!isReference || !card.source) {
    const textData = card.data?.text ?? '';
    return {
      card,
      status: 'fresh',
      isReference: false,
      fallbackText: textData.length > 0 ? textData : `[${card.title}]`,
    };
  }

  const metricId = card.source.id;

  try {
    // 1. Сверка с каталогом метрик (ARCHITECTURE.md §7.6)
    const listRes = await api.listMetrics();
    const descriptor: MetricDescriptor | undefined = listRes.metrics.find(
      (m: MetricDescriptor) => m.id === metricId,
    );

    if (!descriptor) {
      const errorMsg = `${DEFAULT_CARD_STRINGS.metricNotFound}: "${metricId}"`;
      return {
        card,
        status: 'error',
        isReference: true,
        error: errorMsg,
        fallbackText: `[${card.title}: ${errorMsg}]`,
      };
    }

    // 2. Обработка карточки одиночной метрики
    if (card.type === 'metric') {
      const reading: MetricValue = await api.queryMetric({ metricId });
      const status = evaluateCardFreshness(
        reading,
        descriptor.sampleIntervalSec,
        options?.currentSessionTimeSec,
      );

      const unitStr = formatUnit(reading.unit);
      const valStr =
        reading.value !== null
          ? `${reading.value.toFixed(reading.precisionDigits)} ${unitStr}`
          : '—';
      const fallbackText = `${card.title}: ${valStr}`;

      return {
        card,
        status,
        isReference: true,
        metric: reading,
        descriptor,
        fallbackText,
      };
    }

    // 3. Обработка карточки временного ряда (timeseries)
    if (card.type === 'timeseries') {
      let windowMinutes = 15;
      let windowParam: SeriesWindow = 'last15Min';

      if (card.options && typeof card.options['windowMinutes'] === 'number') {
        const parsed = card.options['windowMinutes'];
        if (parsed === 5) {
          windowMinutes = 5;
          windowParam = 'last5Min';
        } else if (parsed === 60) {
          windowMinutes = 60;
          windowParam = 'last60Min';
        } else {
          windowMinutes = 15;
          windowParam = 'last15Min';
        }
      }

      const [reading, series]: [MetricValue, MetricSeries] = await Promise.all([
        api.queryMetric({ metricId }),
        api.querySeries({ metricId, window: windowParam }),
      ]);

      const status = evaluateCardFreshness(
        reading,
        descriptor.sampleIntervalSec,
        options?.currentSessionTimeSec,
      );

      const unitStr = formatUnit(reading.unit);
      const valStr =
        reading.value !== null
          ? `${reading.value.toFixed(reading.precisionDigits)} ${unitStr}`
          : '—';
      const pointsCount = series.values.length;
      const fallbackText = `${card.title} (${windowMinutes} мин): ${valStr} (${pointsCount} точек)`;

      return {
        card,
        status,
        isReference: true,
        metric: reading,
        series,
        descriptor,
        fallbackText,
      };
    }

    // Неподдерживаемый тип для ссылочной карточки
    return {
      card,
      status: 'error',
      isReference: true,
      error: DEFAULT_CARD_STRINGS.unsupportedWidget,
      fallbackText: `[${card.title}: ${DEFAULT_CARD_STRINGS.unsupportedWidget}]`,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      card,
      status: 'error',
      isReference: true,
      error: `${DEFAULT_CARD_STRINGS.metricLoadError}: ${message}`,
      fallbackText: `[${card.title}: ${DEFAULT_CARD_STRINGS.metricLoadError}]`,
    };
  }
}
