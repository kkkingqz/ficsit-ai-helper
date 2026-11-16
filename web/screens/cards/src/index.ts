export * from './types.js';
export * from './constants.js';
export * from './validator.js';
export * from './freshness.js';
export * from './card-resolver.js';
export * from './renderer.js';

import type { FicsitAIApi } from '@ficsitai/screens-api';
import { resolveCard, type ResolveCardOptions } from './card-resolver.js';
import { renderCard } from './renderer.js';
import type { CardRenderModel } from './types.js';
import { validateCard } from './validator.js';

/**
 * Единый сквозной процессор для вызова инструмента show_card (AC-18).
 * 1. Валидирует аргументы вызова. Если невалидно — возвращает ошибку с fallbackText.
 * 2. Разрешает ссылочную карточку через FicsitAIApi (живые значения).
 * 3. Рендерит карточку в структуру CardRenderModel.
 */
export async function processShowCard(
  rawInput: unknown,
  api: FicsitAIApi,
  options?: ResolveCardOptions,
): Promise<{ ok: boolean; model?: CardRenderModel; fallbackText: string }> {
  const validation = validateCard(rawInput);
  if (!validation.ok) {
    return {
      ok: false,
      fallbackText: validation.fallbackText,
    };
  }

  let resolveOpts = options;
  if (!resolveOpts?.currentSessionTimeSec) {
    try {
      const status = await api.getStatus();
      if (status.lastSnapshotSessionTimeSec) {
        resolveOpts = {
          ...resolveOpts,
          currentSessionTimeSec: status.lastSnapshotSessionTimeSec,
        };
      }
    } catch {
      // Ignore getStatus errors if api is unreachable
    }
  }

  const resolved = await resolveCard(validation.card, api, resolveOpts);
  const model = renderCard(resolved);

  return {
    ok: true,
    model,
    fallbackText: model.fallbackText,
  };
}
