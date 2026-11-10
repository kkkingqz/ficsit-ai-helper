---
title: "FICSIT AI — Тест-план этапа 1 (P-7, задача #32)"
subtitle: "Чек-листы готовности спайков, критериев V-01…V-11 и протоколы замеров"
author: "Gf2, автоматизатор тестирования и тестер"
date: "10.11.2026"
lang: ru-RU
---

# Тест-план этапа 1 (P-7, #32)

Владелец: **Gf2** ([docs/team/OWNERSHIP.md](../../docs/team/OWNERSHIP.md)).

## Состав тест-плана

| Документ | Статус | Назначение |
|---|---|---|
| [**s8-checklist.md**](s8-checklist.md) | **Готов** | Чек-лист спайка S8 «Веб-экраны через BLUI», протокол замеров кадрового времени и критерии ворот W |
| [**spikes-checklist.md**](spikes-checklist.md) | **Готов** | Чек-листы завершения спайков S1, S2, S3, S5-lite, S6 по условиям ARCHITECTURE.md §13 |
| [**acceptance-v01-checklist.md**](acceptance-v01-checklist.md) | **Готов** | Чек-листы приёмки всех критериев вертикального среза V-01…V-11 по PLAN-v0.1.md §2 |
| [**telemetry-protocol.md**](telemetry-protocol.md) | **Готов** | Протокол замеров бюджета GameThread и стоимости выборки телеметрии (S3, V-09) |
| [**windows-pilot-checklist.md**](windows-pilot-checklist.md) | **Готов** | Чек-лист проверок на чистой Windows для пилотного тестера (AC-12, V-08, ADR-033, R-27) |
| [**gate-report-templates.md**](gate-report-templates.md) | **Готов** | Шаблоны отчётов о проверке критериев для ворот решений W, G1, G2 |

## Связанные материалы

- Спецификация тестовых сохранений P-5: [`fixtures/saves-specification.md`](../../fixtures/saves-specification.md).
- Скрипт проверки архитектурных инвариантов: [`tools/ci/check-invariants.sh`](../../tools/ci/check-invariants.sh).
- Проверка очереди вопросов между агентами: [`tools/questions.py`](../../tools/questions.py).

## Принцип работы

Работа считается готовой по чек-листу Gf2 из P-7, а не по субъективному ощущению (правило 2 KICKOFF.md). Чек-лист публикуется до начала работы над спайком.
