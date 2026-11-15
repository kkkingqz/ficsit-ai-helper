# Cf3 — состояние на 15.11.2026

**Сейчас:** Ознакомлен с результатами ворот W (ADR-032 принят, Co-101) и фасадом API от Co2 ([PR #53](https://github.com/kkkingqz/ficsit-ai-helper/pull/53), Co2-38). Готовлюсь к спайку S5-lite ([#13](https://github.com/kkkingqz/ficsit-ai-helper/issues/13)) в `sidecar/package/` и веб-экранам «Статистика» (V-5) и карточкам (V-14).

**Последний результат:**
1. Библиотека `@ficsitai/save-source` (S6 Save, [#12](https://github.com/kkkingqz/ficsit-ai-helper/issues/12)) полностью реализована, протестирована, одобрена Co2 и влита в `main` ([PR #46](https://github.com/kkkingqz/ficsit-ai-helper/pull/46)).
2. Подтверждено ознакомление с Co-100, Co-101 (принятие ADR-032 на воротах W) и Co2-38 (фасад `@ficsitai/screens-api` для веб-экранов).
3. Ветка `work/cf3` обновлена от `origin/main`.

**Блокирует меня:** ничего.

**Ждут меня:**
- S5-lite ([#13](https://github.com/kkkingqz/ficsit-ai-helper/issues/13)): подготовка сборщика архива сайдкара в `sidecar/package/` (Linux и Windows раскладки, Node 22, `ff-server`, `sf-mcp`, адаптер, Prisma).
- V-5 ([#22](https://github.com/kkkingqz/ficsit-ai-helper/issues/22)) и V-14 ([#31](https://github.com/kkkingqz/ficsit-ai-helper/issues/31)): веб-экраны и карточки поверх `@ficsitai/screens-api` по графику.

**Решения, на которых стою:** ADR-012, ADR-025, ADR-032, ADR-034, [Co-46](../questions/Co.md#co-46--все--11112026--уведомление), [Co-73](../questions/Co.md#co-73--все--12112026--уведомление), [Co-84](../questions/Co.md#co-84--co2-gf2-gs-все--уведомление--12112026), [Co-100](../questions/Co.md#co-100--все--уведомление--отчёт-по-воротам-w-готов-решение-за-king--15112026), [Co-101](../questions/Co.md#co-101--все--уведомление--adr-032-принят-экраны--веб-во-встроенном-браузере--15112026), [Co2-18](../questions/Co2.md#co2-18--gs-cf3--ответ-на-gs-19--11112026), [Co2-32](../questions/Co2.md#co2-32--cf3-co3--уведомление--ревью-46-закрыто-прочерк-на-экране--12112026), [Co2-38](../questions/Co2.md#co2-38--cf3-gs2--уведомление--фасад-api-готов-на-него-можно-опираться--13112026), [public-api-v0.md](../../interfaces/public-api-v0.md), `AGENTS.md` §6 и §9.

**Дальше:**

1. Архив S5-lite ([#13](https://github.com/kkkingqz/ficsit-ai-helper/issues/13)) — в зоне `sidecar/package/` по графику недели 4–5.
2. Экран «Статистика» (V-5) и карточки (V-14) — в `web/screens/statistics/` и `web/screens/cards/` поверх фасада Co2 (`@ficsitai/screens-api`).
