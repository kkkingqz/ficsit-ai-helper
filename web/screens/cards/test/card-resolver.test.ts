import { describe, it, expect, vi } from 'vitest';
import type { FicsitAIApi, MetricDescriptor, MetricValue, MetricSeries } from '@ficsitai/screens-api';
import { resolveCard } from '../src/card-resolver.js';
import type { ChatCard } from '../src/types.js';

function createMockApi(overrides?: Partial<FicsitAIApi>): FicsitAIApi {
  const defaultDescriptors: MetricDescriptor[] = [
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
    {
      id: 'power.production',
      displayName: 'Производство энергии',
      unit: 'megawatt',
      scope: 'powerNetwork',
      hasSeries: true,
      costClass: 'cheap',
      sampleIntervalSec: 5,
      external: false,
      availableScopes: [],
      scopesTruncated: false,
    },
  ];

  return {
    transport: 'bridge',
    getStatus: vi.fn().mockResolvedValue({
      apiVersion: '0.5.0',
      saveId: 'test-save',
      source: 'live',
      inert: false,
      lastSnapshotSessionTimeSec: 1000,
      sidecarConnected: true,
      apiVersionMismatch: '',
      reason: '',
    }),
    listMetrics: vi.fn().mockResolvedValue({
      metrics: defaultDescriptors,
      nextCursor: '',
    }),
    listScopes: vi.fn().mockResolvedValue({ scopes: [], nextCursor: '' }),
    queryMetric: vi.fn().mockImplementation((args: { metricId: string }): Promise<MetricValue> => {
      return Promise.resolve({
        kind: 'value',
        metricId: args.metricId,
        scopeId: '',
        value: 1250.4,
        unit: 'megawatt',
        precisionDigits: 1,
        sessionTimeSec: 1000,
        state: 'value',
        source: 'live',
      });
    }),
    querySeries: vi.fn().mockImplementation((args: { metricId: string; window: string }): Promise<MetricSeries> => {
      return Promise.resolve({
        kind: 'series',
        metricId: args.metricId,
        scopeId: '',
        unit: 'megawatt',
        window: args.window as any,
        source: 'live',
        intervalSec: 5,
        timestamps: [900, 950, 1000],
        values: [1200, 1230, 1250.4],
        firstPointSessionTimeSec: 900,
        windowIncomplete: false,
      });
    }),
    on: vi.fn().mockReturnValue(() => {}),
    close: vi.fn(),
    ...overrides,
  };
}

describe('Card Resolver (live values & catalog lookup, AC-18)', () => {
  it('resolves live metric card correctly', async () => {
    const api = createMockApi();
    const card: ChatCard = {
      schemaVersion: 1,
      type: 'metric',
      title: 'Потребление',
      source: { kind: 'metric', id: 'power.consumption' },
    };

    const res = await resolveCard(card, api, { currentSessionTimeSec: 1005 });
    expect(res.status).toBe('fresh');
    expect(res.isReference).toBe(true);
    expect(res.metric?.value).toBe(1250.4);
    expect(res.fallbackText).toBe('Потребление: 1250.4 MW');
  });

  it('marks metric stale when age exceeds threshold', async () => {
    const api = createMockApi();
    const card: ChatCard = {
      schemaVersion: 1,
      type: 'metric',
      title: 'Потребление',
      source: { kind: 'metric', id: 'power.consumption' },
    };

    // Metric reading is at sessionTimeSec: 1000.
    // sampleIntervalSec = 5 -> threshold = max(3 * 5, 10) = 15s.
    // If currentSessionTimeSec is 1020, age is 20s > 15s -> stale!
    const res = await resolveCard(card, api, { currentSessionTimeSec: 1020 });
    expect(res.status).toBe('stale');
    expect(res.metric?.value).toBe(1250.4);
  });

  it('resolves timeseries card with points and window', async () => {
    const api = createMockApi();
    const card: ChatCard = {
      schemaVersion: 1,
      type: 'timeseries',
      title: 'График выработки',
      source: { kind: 'metric', id: 'power.production' },
      options: { windowMinutes: 60 },
    };

    const res = await resolveCard(card, api, { currentSessionTimeSec: 1002 });
    expect(res.status).toBe('fresh');
    expect(res.series?.values.length).toBe(3);
    expect(res.series?.window).toBe('last60Min');
    expect(res.fallbackText).toContain('График выработки (60 мин): 1250.4 MW (3 точек)');
  });

  it('returns error when metric ID is not present in catalog', async () => {
    const api = createMockApi();
    const card: ChatCard = {
      schemaVersion: 1,
      type: 'metric',
      title: 'Неизвестная метрика',
      source: { kind: 'metric', id: 'unknown.metric' },
    };

    const res = await resolveCard(card, api);
    expect(res.status).toBe('error');
    expect(res.error).toContain('Метрика отсутствует в каталоге: "unknown.metric"');
    expect(res.fallbackText).toContain('[Неизвестная метрика: Метрика отсутствует в каталоге: "unknown.metric"]');
  });

  it('handles api exception gracefully without crash', async () => {
    const api = createMockApi({
      queryMetric: vi.fn().mockRejectedValue(new Error('Network timeout')),
    });
    const card: ChatCard = {
      schemaVersion: 1,
      type: 'metric',
      title: 'Потребление',
      source: { kind: 'metric', id: 'power.consumption' },
    };

    const res = await resolveCard(card, api);
    expect(res.status).toBe('error');
    expect(res.error).toContain('Network timeout');
    expect(res.fallbackText).toContain('Не удалось получить значение метрики');
  });
});
