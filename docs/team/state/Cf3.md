# Cf3 — состояние на 15.11.2026

**Сейчас:** Реализован контроллер экрана V-5 «Статистика» ([#22](https://github.com/kkkingqz/ficsit-ai-helper/issues/22)) в пакете `@ficsitai/screen-statistics` (`web/screens/statistics/`). Открыт [PR #59](https://github.com/kkkingqz/ficsit-ai-helper/pull/59) на ревью Co2. Также открыт точечный [PR #58](https://github.com/kkkingqz/ficsit-ai-helper/pull/58) по тайм-аутам сайдкара (Co2-53).

**Последний результат:**
1. Пакет `@ficsitai/screen-statistics` ([PR #59](https://github.com/kkkingqz/ficsit-ai-helper/pull/59)):
   - Реализован `StatisticsController` поверх фасада `@ficsitai/screens-api` и представления D-2.
   - Поддерживаются вкладки «Энергия» и «Ресурсы», окна 5/15/60 минут, подписка на `metrics.snapshot`.
   - Реализован инвариант не более 4 активных рядов с FIFO-вытеснением старейшего и уведомлением игрока.
   - Реализована оценка актуальности данных по формуле $age \le \max(3 \cdot sampleIntervalSec, 10s)$.
   - Реализован RFC 4180 экспорт таблиц и временных рядов в CSV.
   - Обеспечена толерантность экрана к разрыву связи с сайдкаром (FR-10 / D-1 §2.5).
   - Проверки: `npm run typecheck` (0 ошибок), `npm test` (20/20 тестов зелёные), `npm run build` успешен. CI в PR #59 зелёный (2/2).
2. Пакет `@ficsitai/package` ([PR #58](https://github.com/kkkingqz/ficsit-ai-helper/pull/58)):
   - Устранены замечания Co2-53 (тайм-ауты 30/60/120 с c SIGKILL, WINEPREFIX в `cache/wine-prefix`, vitest.config.ts). CI зелёный (2/2).
3. Спайк S5-lite ([PR #55](https://github.com/kkkingqz/ficsit-ai-helper/pull/55), `a0e18ba`) и S6 Save ([PR #46](https://github.com/kkkingqz/ficsit-ai-helper/pull/46)) влиты в `main`.

**Блокирует меня:** ничего.

**Ждут меня:**
- Co2: ревью [PR #58](https://github.com/kkkingqz/ficsit-ai-helper/pull/58) (тайм-ауты сайдкара) и [PR #59](https://github.com/kkkingqz/ficsit-ai-helper/pull/59) (контроллер «Статистики», #22).

**Решения, на которых стою:** ADR-012, ADR-015, ADR-025, ADR-032, ADR-033, ADR-034, [Co2-51](../questions/Co2.md#co2-51--cf3-gf2--ответ-на-cf3-8--повторное-ревью-55-принято--15112026), `AGENTS.md` §6 и §9.

**Дальше:**
1. Получение ревью Co2 по PR #58 и PR #59, устранение замечаний при наличии, слияние после одобрения и зелёных проверок.
2. Переход к V-14 «Карточки в чате» ([#31](https://github.com/kkkingqz/ficsit-ai-helper/issues/31)) в `web/screens/cards/`.
