import { describe, it, expect } from 'vitest';
import { validateCard } from '../src/validator.js';

describe('Card Validator (chat-card.schema.json, AC-18)', () => {
  it('validates a correct metric card', () => {
    const raw = {
      schemaVersion: 1,
      type: 'metric',
      title: 'Потребление энергии',
      source: {
        kind: 'metric',
        id: 'power.consumption',
      },
      options: {
        showSparkline: true,
      },
    };

    const res = validateCard(raw);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.card.type).toBe('metric');
      expect(res.card.source?.id).toBe('power.consumption');
    }
  });

  it('validates a correct timeseries card', () => {
    const raw = {
      schemaVersion: 1,
      type: 'timeseries',
      title: 'График мощности (15 мин)',
      source: {
        kind: 'metric',
        id: 'power.production',
      },
      options: {
        windowMinutes: 15,
      },
    };

    const res = validateCard(raw);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.card.type).toBe('timeseries');
    }
  });

  it('rejects non-object input and provides fallback text', () => {
    const res = validateCard('not an object');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.fallbackText).toContain('Невалидный формат карточки');
    }
  });

  it('rejects unsupported schemaVersion', () => {
    const res = validateCard({
      schemaVersion: 2,
      type: 'metric',
      title: 'Тест',
      source: { kind: 'metric', id: 'power.consumption' },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain('Неподдерживаемая версия схемы: 2');
    }
  });

  it('rejects invalid title', () => {
    const resEmpty = validateCard({
      schemaVersion: 1,
      type: 'metric',
      title: '   ',
      source: { kind: 'metric', id: 'power.consumption' },
    });
    expect(resEmpty.ok).toBe(false);

    const longTitle = 'a'.repeat(81);
    const resLong = validateCard({
      schemaVersion: 1,
      type: 'metric',
      title: longTitle,
      source: { kind: 'metric', id: 'power.consumption' },
    });
    expect(resLong.ok).toBe(false);
  });

  it('rejects unknown or unsupported widget types in v0.1', () => {
    const resUnknown = validateCard({
      schemaVersion: 1,
      type: 'random_widget',
      title: 'Тест',
      source: { kind: 'metric', id: 'power.consumption' },
    });
    expect(resUnknown.ok).toBe(false);
    if (!resUnknown.ok) {
      expect(resUnknown.error).toContain('Неизвестный тип виджета');
    }

    const resTable = validateCard({
      schemaVersion: 1,
      type: 'table',
      title: 'Таблица',
      data: { columns: ['A'], rows: [['1']] },
    });
    expect(resTable.ok).toBe(false);
    if (!resTable.ok) {
      expect(resTable.error).toContain('не поддерживается в v0.1');
    }
  });

  it('enforces oneOf rule for source and data', () => {
    // Both present
    const resBoth = validateCard({
      schemaVersion: 1,
      type: 'metric',
      title: 'Тест',
      source: { kind: 'metric', id: 'power.consumption' },
      data: { text: 'Hello' },
    });
    expect(resBoth.ok).toBe(false);

    // Neither present
    const resNeither = validateCard({
      schemaVersion: 1,
      type: 'metric',
      title: 'Тест',
    });
    expect(resNeither.ok).toBe(false);
  });

  it('rejects invalid metric ID format', () => {
    const res = validateCard({
      schemaVersion: 1,
      type: 'metric',
      title: 'Тест',
      source: { kind: 'metric', id: 'INVALID-CAPS!' },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain('Некорректный source.id');
    }
  });

  it('rejects excessive options or invalid option types', () => {
    const tooManyOptions: Record<string, string> = {};
    for (let i = 0; i < 9; i++) {
      tooManyOptions[`opt${i}`] = 'val';
    }
    const resTooMany = validateCard({
      schemaVersion: 1,
      type: 'metric',
      title: 'Тест',
      source: { kind: 'metric', id: 'power.consumption' },
      options: tooManyOptions,
    });
    expect(resTooMany.ok).toBe(false);

    const resBadType = validateCard({
      schemaVersion: 1,
      type: 'metric',
      title: 'Тест',
      source: { kind: 'metric', id: 'power.consumption' },
      options: { bad: { nested: true } as unknown as string },
    });
    expect(resBadType.ok).toBe(false);
  });

  it('handles contracts/chat-card.example.json by rejecting unsupported type gracefully', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const examplePath = path.resolve(__dirname, '../../../../docs/contracts/chat-card.example.json');
    if (fs.existsSync(examplePath)) {
      const content = JSON.parse(fs.readFileSync(examplePath, 'utf-8'));
      const res = validateCard(content);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toContain('не поддерживается в v0.1');
        expect(res.fallbackText).toContain('временно недоступен в текущей версии');
      }
    }
  });
});
