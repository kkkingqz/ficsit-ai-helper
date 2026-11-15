# Cf3 — состояние на 15.11.2026

**Сейчас:** Spike S5-lite ([#13](https://github.com/kkkingqz/ficsit-ai-helper/issues/13)) полностью завершён и слит в `main` ([PR #55](https://github.com/kkkingqz/ficsit-ai-helper/pull/55), `a0e18ba`). Ознакомлен с `Co3-13`, `Co2-50`, `Gs2-22`, дан ответ Gs2 в `Cf3-9` по стыку V-5 «Статистика». Перехожу к реализации экрана V-5 «Статистика» ([#22](https://github.com/kkkingqz/ficsit-ai-helper/issues/22)) в `web/screens/statistics/` поверх `@ficsitai/screens-api` и представления Gs2 ([PR #57](https://github.com/kkkingqz/ficsit-ai-helper/pull/57)).

**Последний результат:**
1. Пакет `@ficsitai/package` обновлён по ревью Co2-46 и пожеланиям Co2-51 (коммиты `c852a49`, `1738102`):
   - В раскладку включён системный промпт `third_party/foreman/SYSTEM_PROMPT.md` (`SYSTEM_PROMPT_PATH` в `launcher.cjs`), запуск `ff-server` проверен.
   - Лаунчер переведён на CommonJS (`launcher.cjs`) с `package.json` (`{"type":"commonjs"}`).
   - Скрипты `start.sh` и `start.bat` поддерживают `./start.sh set-key` и проброс аргументов.
   - В лаунчере выставлен `FOREMAN_ACCOUNT_PATH: data/adapter-account.json`.
   - Загрузки бинарников (Node 22, `better-sqlite3`) верифицируются по SHA-256 (с динамической загрузкой `SHASUMS256.txt` для Node).
   - Исключены dev-инструменты (`prisma` CLI, `@types`, линтеры), размер архивов сокращён: Linux 97.35 МБ (был 177 МБ), Windows 87.03 МБ (был 167 МБ).
   - Внедрена проверка зависимостей адаптера на сборке (`verifyAdapterDependencies`).
   - Добавлены `verifyLinuxNode` и синхронный `verifyForemanStartup` в сборку; Wine 11.0 верификация включена внутрь сборки win-x64.
   - Реализована проверка совместимости semver (0.x и 1.x+) и preflight проверка порта normalizer.
2. Проверки: `npm run typecheck` (0 ошибок), `npm test` (7/7 зелёные), Wine 11.0 верификация успешна, CI зелёный (2/2).
3. [PR #55](https://github.com/kkkingqz/ficsit-ai-helper/pull/55) слит в `main` (`a0e18ba`). Спайк S5-lite ([#13](https://github.com/kkkingqz/ficsit-ai-helper/issues/13)) закрыт.
4. Ранее `@ficsitai/save-source` (S6 Save, [#12](https://github.com/kkkingqz/ficsit-ai-helper/issues/12)) одобрена и влита в `main` ([PR #46](https://github.com/kkkingqz/ficsit-ai-helper/pull/46)).

**Блокирует меня:** ничего.

**Ждут меня:**
- V-5 ([#22](https://github.com/kkkingqz/ficsit-ai-helper/issues/22)): реализация контроллера экрана «Статистика» (`web/screens/statistics/`).
- V-14 ([#31](https://github.com/kkkingqz/ficsit-ai-helper/issues/31)): карточки в чате (после V-5).

**Решения, на которых стою:** ADR-012, ADR-015, ADR-025, ADR-032, ADR-033, ADR-034, [Co2-51](../questions/Co2.md#co2-51--cf3-gf2--ответ-на-cf3-8--повторное-ревью-55-принято--15112026), `AGENTS.md` §6 и §9.

**Дальше:**
1. Создание каркаса `web/screens/statistics/` (package.json, tsconfig, сборка/dev-сервер по аналогии с `web/screens/api/`).
2. Подключение фасада `@ficsitai/screens-api` к представлению `mountStatistics` из `web/ui-kit/screens/`.
3. Реализация запросов энергии (производство, потребление, ёмкость, генераторы, батареи, предохранители) и ресурсов (баланс, производство, потребление).
4. Реализация интерактивности: выбор окон 5/15/60, вытеснение и переключение рядов, экспорт в CSV.
