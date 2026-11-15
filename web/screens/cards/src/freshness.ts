import type { MetricValue } from '@ficsitai/screens-api';
import type { CardFreshness } from './types.js';

/**
 * Оценивает актуальность метрики по формуле из ARCHITECTURE.md §8.2:
 * threshold = max(3 * sampleIntervalSec, 10s)
 */
export function evaluateCardFreshness(
  metric: MetricValue | undefined,
  sampleIntervalSec: number = 5,
  currentSessionTimeSec?: number,
): CardFreshness {
  if (!metric) {
    return 'empty';
  }

  if (metric.state === 'notApplicable' || metric.value === null) {
    return 'empty';
  }

  if (currentSessionTimeSec === undefined || metric.sessionTimeSec === undefined) {
    return 'fresh';
  }

  const age = Math.max(0, currentSessionTimeSec - metric.sessionTimeSec);
  const threshold = Math.max(3 * sampleIntervalSec, 10);

  return age <= threshold ? 'fresh' : 'stale';
}
