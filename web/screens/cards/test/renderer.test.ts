import { describe, it, expect, vi } from 'vitest';
import type { FicsitAIApi } from '@ficsitai/screens-api';
import { processShowCard } from '../src/index.js';
import { renderCard } from '../src/renderer.js';
import type { ResolvedCard } from '../src/types.js';

describe('Card Renderer & show_card Pipeline (AC-18)', () => {
  it('renders a metric card into structured model and HTML', () => {
    const resolved: ResolvedCard = {
      card: {
        schemaVersion: 1,
        type: 'metric',
        title: 'Потребление энергии',
        source: { kind: 'metric', id: 'power.consumption' },
      },
      status: 'fresh',
      isReference: true,
      metric: {
        kind: 'value',
        metricId: 'power.consumption',
        scopeId: '',
        value: 1250.4,
        unit: 'megawatt',
        precisionDigits: 1,
        sessionTimeSec: 1000,
        state: 'value',
        source: 'live',
      },
      fallbackText: 'Потребление энергии: 1250.4 MW',
    };

    const model = renderCard(resolved);
    expect(model.title).toBe('Потребление энергии');
    expect(model.primaryValue).toBe('1250.4');
    expect(model.unit).toBe('MW');
    expect(model.badgeText).toBe('Телеметрия');
    expect(model.html).toContain('ficsit-card--fresh');
    expect(model.html).toContain('1250.4');
    expect(model.html).toContain('MW');
    expect(model.html).toContain('Потребление энергии');
  });

  it('renders a timeseries card with sparkline svg', () => {
    const resolved: ResolvedCard = {
      card: {
        schemaVersion: 1,
        type: 'timeseries',
        title: 'Производство энергии',
        source: { kind: 'metric', id: 'power.production' },
      },
      status: 'fresh',
      isReference: true,
      metric: {
        kind: 'value',
        metricId: 'power.production',
        scopeId: '',
        value: 2000,
        unit: 'megawatt',
        precisionDigits: 0,
        sessionTimeSec: 1000,
        state: 'value',
        source: 'live',
      },
      series: {
        kind: 'series',
        metricId: 'power.production',
        scopeId: '',
        unit: 'megawatt',
        window: 'last15Min',
        source: 'live',
        intervalSec: 5,
        timestamps: [100, 200, 300],
        values: [1800, 2000, 1900],
        firstPointSessionTimeSec: 100,
        windowIncomplete: false,
      },
      fallbackText: 'Производство энергии (15 мин): 2000 MW (3 точек)',
    };

    const model = renderCard(resolved);
    expect(model.points?.length).toBe(3);
    expect(model.secondaryText).toContain('мин: 1800.0 / макс: 2000.0');
    expect(model.html).toContain('<polyline fill="none"');
    expect(model.html).toContain('ficsit-card__sparkline');
  });

  it('escapes unsafe HTML to prevent XSS injection in title and classes', () => {
    const resolved: ResolvedCard = {
      card: {
        schemaVersion: 1,
        type: 'metric',
        title: '<script>alert("xss")</script>',
        source: { kind: 'metric', id: 'power.consumption' },
      },
      status: 'fresh',
      isReference: true,
      metric: {
        kind: 'value',
        metricId: 'power.consumption',
        scopeId: '',
        value: 100,
        unit: 'megawatt',
        precisionDigits: 0,
        sessionTimeSec: 1000,
        state: 'value',
        source: 'live',
      },
      fallbackText: 'Safe fallback',
    };

    const model = renderCard(resolved);
    expect(model.html).not.toContain('<script>');
    expect(model.html).toContain('&lt;script&gt;');
  });

  it('executes processShowCard end-to-end and pulls session time from getStatus', async () => {
    const mockApi: FicsitAIApi = {
      transport: 'bridge',
      getStatus: vi.fn().mockResolvedValue({
        lastSnapshotSessionTimeSec: 502,
      }),
      listMetrics: vi.fn().mockResolvedValue({
        metrics: [
          {
            id: 'power.consumption',
            displayName: 'Потребление энергии',
            unit: 'megawatt',
            scope: 'powerNetwork',
            hasSeries: true,
            costClass: 'cheap',
            sampleIntervalSec: 5,
            external: false,
            availableScopes: [],
            scopesTruncated: false,
          },
        ],
        nextCursor: '',
      }),
      listScopes: vi.fn(),
      queryMetric: vi.fn().mockResolvedValue({
        kind: 'value',
        metricId: 'power.consumption',
        scopeId: '',
        value: 450.5,
        unit: 'megawatt',
        precisionDigits: 1,
        sessionTimeSec: 500,
        state: 'value',
        source: 'live',
      }),
      querySeries: vi.fn(),
      on: vi.fn().mockReturnValue(() => {}),
      close: vi.fn(),
    };

    const input = {
      schemaVersion: 1,
      type: 'metric',
      title: 'Нагрузка сети',
      source: { kind: 'metric', id: 'power.consumption' },
    };

    const result = await processShowCard(input, mockApi);
    expect(result.ok).toBe(true);
    expect(result.model?.primaryValue).toBe('450.5');
    expect(result.model?.unit).toBe('MW');
    expect(result.model?.status).toBe('fresh');
    expect(result.fallbackText).toBe('Нагрузка сети: 450.5 MW');
    expect(mockApi.getStatus).toHaveBeenCalled();
  });

  it('executes processShowCard and returns fallback text for invalid card (AC-18)', async () => {
    const mockApi: FicsitAIApi = {
      transport: 'bridge',
      getStatus: vi.fn(),
      listMetrics: vi.fn(),
      listScopes: vi.fn(),
      queryMetric: vi.fn(),
      querySeries: vi.fn(),
      on: vi.fn().mockReturnValue(() => {}),
      close: vi.fn(),
    };

    const invalidInput = {
      schemaVersion: 99, // unsupported
      type: 'metric',
      title: 'Неверная карточка',
    };

    const result = await processShowCard(invalidInput, mockApi);
    expect(result.ok).toBe(false);
    expect(result.model).toBeUndefined();
    expect(result.fallbackText).toContain('Невалидный формат карточки: версия схемы должна быть 1');
  });
});
