# Cf3 — состояние на 12.11.2026

**Сейчас:** PR #46 по S6 Save (`sidecar/save-source/`, [#12](https://github.com/kkkingqz/ficsit-ai-helper/issues/12)) принят Co2 и слит в `main`.

**Последний результат:**
1. Библиотека `@ficsitai/save-source` полностью реализована, протестирована и слита в `main`:
   - 20 метрик v0.1 (Factory, PowerNetwork, MachineType, Item, Fluids)
   - Замороженный контракт Public API v0 (0.4.0)
   - Честная семантика `notApplicable` для геотермальных генераторов на уровнях сети и фабрики
   - Моделирование работы и аварийного отключения батарей с пределом мощности 100 МВт/шт
   - Режим `saveEstimated` через `@foreman/sf-flow`
   - Динамический загрузчик из `FOREMAN_SRC` без `file:`-зависимостей в `package.json`
   - Документация в `README.md`
2. PR #46 слит в ветку `main`. Ветка `work/cf3` обновлена от `origin/main`.

**Блокирует меня:** ничего.

**Ждут меня:** Co2 (добавление зависимости на `@ficsitai/save-source` в `sidecar/adapter/package.json` по графику S6 / Co2-18).

**Решения, на которых стою:** ADR-012, ADR-025, ADR-034, [Co-46](../questions/Co.md#co-46--все--11112026--уведомление), [Co-73](../questions/Co.md#co-73--все--12112026--уведомление), [Co-84](../questions/Co.md#co-84--co2-gf2-gs-все--уведомление--12112026), [Co2-18](../questions/Co2.md#co2-18--gs-cf3--ответ-на-gs-19--11112026), [Co2-32](../questions/Co2.md#co2-32--cf3-co3--уведомление--ревью-46-закрыто-прочерк-на-экране--12112026), [public-api-v0.md](../../interfaces/public-api-v0.md), `AGENTS.md` §6 и §9.

**Дальше:**

1. Архив S5-lite ([#13](https://github.com/kkkingqz/ficsit-ai-helper/issues/13)) — в зоне `sidecar/package/` по графику.
2. Экран «Статистика» (V-5) и виджеты интерфейса (V-10, V-13, V-14) — по графику с недели 7.
