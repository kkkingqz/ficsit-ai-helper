# Gf — состояние на 12.11.2026

**Сейчас:** Ожидание ревью `Gs` по [PR #49](https://github.com/kkkingqz/ficsit-ai-helper/pull/49) (`mod/s8-terminal-screen` → `main`, коммит [`f64e5ab`](https://github.com/kkkingqz/ficsitai-helper/commit/f64e5ab)). Документы в `work/gf`, личный Starter Project `~/Projects/SML-gf` на `a7e85503` (`CL 517554`).

**Последний результат:** Реализован и верифицирован рендер экрана терминала в мире (S8 `3.4`/`3.5`, §6.6: `Widget3DPassThrough_Opaque_OneSided`, `UTextureRenderTarget2D` 1280×720, `bWorldSurfaceMode`, `SetWorldScreenTexture`, `TryProjectWorldHitToScreenUV`) и опциональный стенд диагностики (`-FicsitAITestScenario=S1Screen|P7`):
- `./tools/host/verify-pr.sh FicsitAI` на `f64e5ab`: **пройдено** (`Win64 Shipping` 51 МБ, `sha256 b8b5eda4b0442e95…`, `CL 517554`, Proton, `FicsitAI: 0.1.0, SML: 3.12.0`, 120 с, главное меню — да, `FATAL=0`, `PLUGIN_ERRORS=0`).
- `tools/ci/check-invariants.sh`: `5/5` блокирующих OK; `UnrealEditor-Cmd` (`FicsitAI`): `6/6 Result={Success}`, `EXIT CODE: 0`.
- Живой `S1Screen` в Proton DX12 (`yt`, `--exclusive`): `aspect=1.7778`, `rt=1280x720`, `idleNoRedraw=1 (draws 1->1)`, `traceHit=1`, `uv=(0.500,0.500)`, `externalTexOk=1`, `noPowerBlocked=1`, `FATAL=0`.
- Живые замеры `P7` в Proton DX12 (`--exclusive`):
  - **Save A (`m22_autosave_2`)**: `buildables=71` (`factories=14`, `generators=2`), `baseFrameAvg=7.113 ms`, `telFrameAvg=6.895 ms`, `collect1HzAvg=0.086 ms` (`max=0.095 ms`), §3.4 `customDataAvg=0.0132 ms` (`max=0.0812 ms`), `bfsDepth15Avg=0.0035 ms` (`max=0.0127 ms`, `avgNodes=6.1`).
  - **Save B (`yt`)**: `buildables=2248` (`factories=286`, `generators=48`), `baseFrameAvg=7.536 ms`, `telFrameAvg=7.403 ms`, `collect1HzAvg=0.296 ms` (`max=0.345 ms`), §3.4 `customDataAvg=0.0053 ms` (`max=0.0247 ms`), `bfsDepth15Avg=0.0179 ms` (`p95=0.0426 ms`, `max=0.0615 ms`, `avgNodes=54.2`).
  - **Save D (`save_d_sfplus`)**: без установленных архивов `SatisfactoryPlus`/`RefinedPower` загрузка задерживается на десериализации отсутствующих модовых акторов.
Отправлено уведомление [`Gf-22`](../questions/Gf.md#gf-22--gs-co-gf2--запрос-на-ревью-pr-49-s8-34-66-замеры-p-7--12112026) (`Gs`, `Co`, `Gf2`).

**Блокирует меня:** Не заблокирован; очередь `Gf` чиста (`0` непрочитанных уведомлений). Для замеров P-7 на Save C/D требуются сам `Save C` и (для Save D) архивы модов из его окружения.

**Ждут меня:** `Gs` (ревью PR #49), `Co` (приёмка `SetWorldScreenTexture` / `TryProjectWorldHitToScreenUV` для `FicsitAIWebRuntime`, S8 `3.4`), `Gf2` (данные замеров P-7 §3.2/§3.4).

**Решения, на которых стою:** [архитектура §6.6, §8.2, §17.1, ADR-029, ADR-030, ADR-035](../../ARCHITECTURE.md), [среда §5.1](../../ENVIRONMENT.md#51-клонирование-starter-project), [протокол P-7](../../../tests/test-plan/telemetry-protocol.md), [зоны владения](../OWNERSHIP.md).

**Дальше:**
1. Дождаться ревью `Gs` по [PR #49](https://github.com/kkkingqz/ficsit-ai-helper/pull/49), при необходимости исправить замечания и влить в `main`.
2. После появления `Save C` (и набора модов Save D) дополнить прогоны P-7 §3.2/§3.4 и интеграцию `BuildingIndex` со сборщиками S3.
3. При случае с хоста закрыть [#2](https://github.com/kkkingqz/ficsit-ai-helper/issues/2) (`P-1`).
