# Cf3 — состояние на 15.11.2026

**Сейчас:** Исправлены все 10 замечаний Co2 по [PR #55](https://github.com/kkkingqz/ficsit-ai-helper/pull/55) (S5-lite, [#13](https://github.com/kkkingqz/ficsit-ai-helper/issues/13)) в `sidecar/package/`. Зафиксирован вопрос Cf3-8, жду повторного ревью Co2.

**Последний результат:**
1. Пакет `@ficsitai/package` обновлён по ревью Co2-46:
   - В раскладку включён системный промпт `third_party/foreman/SYSTEM_PROMPT.md` (`SYSTEM_PROMPT_PATH` в `launcher.cjs`), запуск `ff-server` проверен.
   - Лаунчер переведён на CommonJS (`launcher.cjs`) с `package.json` (`{"type":"commonjs"}`).
   - Скрипты `start.sh` и `start.bat` поддерживают `./start.sh set-key`.
   - В лаунчере выставлен `FOREMAN_ACCOUNT_PATH: data/adapter-account.json`.
   - Все загрузки внешних бинарников (Node 22.23.4, `better-sqlite3`) верифицируются по SHA-256 (`EXPECTED_SHA256`).
   - Исключены dev-инструменты (`prisma` CLI, `@types`, линтеры), размер архивов сокращён: Linux 97.35 МБ (был 177 МБ), Windows 87.03 МБ (был 167 МБ).
   - Внедрена проверка зависимостей адаптера на сборке (`verifyAdapterDependencies`).
   - Добавлен `verifyLinuxNode` для проверки нативного аддона под Linux portable Node.
   - Добавлен `tsconfig.test.json`, `npm run typecheck` проверяет исходники и тесты.
2. Проверки: `npm run typecheck` (0 ошибок), `npm test` (6/6 зелёные), Wine 11.0 верификация успешна.
3. Ранее `@ficsitai/save-source` (S6 Save, [#12](https://github.com/kkkingqz/ficsit-ai-helper/issues/12)) одобрена и влита в `main` ([PR #46](https://github.com/kkkingqz/ficsit-ai-helper/pull/46)).

**Блокирует меня:** ничего.

**Ждут меня:**
- Co2: повторное ревью [PR #55](https://github.com/kkkingqz/ficsit-ai-helper/pull/55).
- V-5 ([#22](https://github.com/kkkingqz/ficsit-ai-helper/issues/22)) и V-14 ([#31](https://github.com/kkkingqz/ficsit-ai-helper/issues/31)): веб-экраны и карточки поверх `@ficsitai/screens-api` по графику.

**Решения, на которых стою:** ADR-012, ADR-015, ADR-025, ADR-032, ADR-033, ADR-034, [Co2-46](../questions/Co2.md#co2-46--cf3-gf2--ответ-на-cf3-7--ревью-pr-55-s5-lite-нужны-правки--15112026), `AGENTS.md` §6 и §9.

**Дальше:**
1. Повторное ревью и слияние PR #55 по S5-lite.
2. Экран «Статистика» (V-5) и карточки (V-14) — в `web/screens/statistics/` и `web/screens/cards/` поверх `@ficsitai/screens-api`.
