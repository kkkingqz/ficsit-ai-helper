# Cf3 — состояние на 15.11.2026

**Сейчас:** Завершены все закреплённые задачи этапа v0.1:
1. Spike S5-lite ([#13](https://github.com/kkkingqz/ficsit-ai-helper/issues/13)) влит в `main` ([PR #55](https://github.com/kkkingqz/ficsit-ai-helper/pull/55), `a0e18ba`). Замечания Co2-53 устранены в [PR #58](https://github.com/kkkingqz/ficsit-ai-helper/pull/58).
2. Экран V-5 «Статистика» ([#22](https://github.com/kkkingqz/ficsit-ai-helper/issues/22)) реализован в пакете `@ficsitai/screen-statistics` ([PR #59](https://github.com/kkkingqz/ficsit-ai-helper/pull/59)).
3. Экран V-14 «Карточки в чате» ([#31](https://github.com/kkkingqz/ficsit-ai-helper/issues/31), AC-18) реализован в пакете `@ficsitai/screen-cards` ([PR #60](https://github.com/kkkingqz/ficsit-ai-helper/pull/60)).

Все три PR (#58, #59, #60) открыты, имеют 100% зелёные проверки CI и ожидают ревью Co2 / Gs2.

**Последний результат:**
1. Пакет `@ficsitai/screen-cards` ([PR #60](https://github.com/kkkingqz/ficsit-ai-helper/pull/60)):
   - Реализована валидация схемы `chat-card.schema.json` для виджетов `metric` и `timeseries`.
   - Реализован безопасный текстовый fallback для невалидных карточек по AC-18.
   - Реализовано разрешение ссылочных карточек через `FicsitAIApi` со сверкой каталога и расчётом актуальности.
   - Реализован рендеринг карточек в HTML со sparkline SVG и защитой от XSS.
   - Проверки: `npm run typecheck` (0 ошибок), `npm test` (19/19 тестов зелёные), `npm run build` успешен. CI зелёный (2/2).
2. Пакет `@ficsitai/screen-statistics` ([PR #59](https://github.com/kkkingqz/ficsit-ai-helper/pull/59)):
   - Реализован `StatisticsController` (энергия, ресурсы, окна 5/15/60 мин, инвариант 4 рядов, CSV экспорт по RFC 4180, толерантность к разрыву сайдкара FR-10).
   - Проверки: `npm run typecheck` (0 ошибок), `npm test` (20/20 тестов зелёные), `npm run build` успешен. CI зелёный (2/2).
3. Пакет `@ficsitai/package` ([PR #58](https://github.com/kkkingqz/ficsit-ai-helper/pull/58)):
   - Устранены замечания Co2-53 (тайм-ауты 30/60/120 с c SIGKILL, WINEPREFIX в `cache/wine-prefix`, vitest.config.ts). CI зелёный (2/2).

**Блокирует меня:** ничего.

**Ждут меня:**
- Co2, Gs2: ревью [PR #58](https://github.com/kkkingqz/ficsit-ai-helper/pull/58), [PR #59](https://github.com/kkkingqz/ficsit-ai-helper/pull/59), [PR #60](https://github.com/kkkingqz/ficsit-ai-helper/pull/60).

**Решения, на которых стою:** ADR-012, ADR-015, ADR-021, ADR-025, ADR-032, ADR-033, ADR-034, [Co2-51](../questions/Co2.md#co2-51--cf3-gf2--ответ-на-cf3-8--повторное-ревью-55-принято--15112026), `AGENTS.md` §6 и §9.

**Дальше:**
1. Получение ревью Co2 / Gs2 по PR #58, PR #59, PR #60, устранение замечаний при наличии, слияние после одобрения и зелёных проверок.
2. Совместная сквозная интеграция экранов с игрой и терминалом (V-01, V-02, V-03).
