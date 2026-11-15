import { formatUnit } from './card-resolver.js';
import { DEFAULT_CARD_STRINGS } from './constants.js';
import type { CardRenderModel, ResolvedCard } from './types.js';

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Рендерит разрешённую карточку в структуру CardRenderModel с HTML-разметкой и fallbackText.
 */
export function renderCard(resolved: ResolvedCard): CardRenderModel {
  const { card, status, isReference, metric, series, error } = resolved;
  const title = card.title;
  const type = card.type;

  // Определение бейджа актуальности/источника
  let badgeText: string;
  if (status === 'error') {
    badgeText = DEFAULT_CARD_STRINGS.error;
  } else if (status === 'stale') {
    badgeText = DEFAULT_CARD_STRINGS.stale;
  } else if (status === 'loading') {
    badgeText = DEFAULT_CARD_STRINGS.loading;
  } else if (status === 'empty') {
    badgeText = DEFAULT_CARD_STRINGS.empty;
  } else {
    badgeText = isReference ? DEFAULT_CARD_STRINGS.liveTelemetry : DEFAULT_CARD_STRINGS.assistantEstimate;
  }

  // Определение первичного значения и единицы
  let primaryValue = '—';
  let unit = '';
  let secondaryText: string | undefined;

  if (error) {
    primaryValue = '—';
    secondaryText = error;
  } else if (metric && metric.value !== null) {
    primaryValue = metric.value.toFixed(metric.precisionDigits);
    unit = formatUnit(metric.unit);
  }

  // Данные точек для графика (timeseries)
  let points: Array<{ timeSec: number; value: number }> | undefined;
  if (series && series.values.length > 0) {
    points = series.timestamps.map((t, idx) => ({
      timeSec: t,
      value: series.values[idx] ?? 0,
    }));
    const validValues = series.values.filter((v): v is number => typeof v === 'number');
    if (validValues.length > 0) {
      const minVal = Math.min(...validValues);
      const maxVal = Math.max(...validValues);
      const avgVal = validValues.reduce((acc, p) => acc + p, 0) / validValues.length;
      secondaryText = `мин: ${minVal.toFixed(1)} / макс: ${maxVal.toFixed(1)} / ср: ${avgVal.toFixed(1)} ${unit}`;
    }
  }

  const safeTitle = escapeHtml(title);
  const safeBadge = escapeHtml(badgeText);
  const safeValue = escapeHtml(primaryValue);
  const safeUnit = escapeHtml(unit);
  const safeSecondary = secondaryText ? escapeHtml(secondaryText) : '';
  const sourceLabel = isReference ? DEFAULT_CARD_STRINGS.liveTelemetry : DEFAULT_CARD_STRINGS.assistantEstimate;

  const chartHtml =
    points && points.length > 0
      ? `<div class="ficsit-card__chart" data-points="${points.length}"><svg viewBox="0 0 200 40" class="ficsit-card__sparkline" preserveAspectRatio="none"><polyline fill="none" stroke="currentColor" stroke-width="2" points="${generateSparklinePoints(points, 200, 40)}" /></svg></div>`
      : '';

  const secondaryHtml = safeSecondary ? `<div class="ficsit-card__secondary">${safeSecondary}</div>` : '';

  const html = `
<div class="ficsit-card ficsit-card--${status} ficsit-card--${type}" data-card-type="${type}" role="region" aria-label="${safeTitle}">
  <header class="ficsit-card__header">
    <span class="ficsit-card__title">${safeTitle}</span>
    <span class="ficsit-card__badge ficsit-card__badge--${status}">${safeBadge}</span>
  </header>
  <div class="ficsit-card__body">
    <div class="ficsit-card__metric">
      <span class="ficsit-card__value">${safeValue}</span>
      ${safeUnit ? `<span class="ficsit-card__unit">${safeUnit}</span>` : ''}
    </div>
    ${secondaryHtml}
    ${chartHtml}
  </div>
  <footer class="ficsit-card__footer">
    <span class="ficsit-card__source">${escapeHtml(sourceLabel)}</span>
  </footer>
</div>`.trim();

  return {
    title,
    type,
    status,
    isReference,
    badgeText,
    primaryValue,
    unit,
    secondaryText,
    points,
    html,
    fallbackText: resolved.fallbackText,
  };
}

function generateSparklinePoints(
  points: Array<{ timeSec: number; value: number }>,
  width: number,
  height: number,
): string {
  if (points.length < 2) return '';
  const min = Math.min(...points.map((p) => p.value));
  const max = Math.max(...points.map((p) => p.value));
  const range = max - min || 1;

  const tMin = points[0]!.timeSec;
  const tMax = points[points.length - 1]!.timeSec;
  const tRange = tMax - tMin || 1;

  return points
    .map((p) => {
      const x = ((p.timeSec - tMin) / tRange) * width;
      const y = height - ((p.value - min) / range) * (height - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}
