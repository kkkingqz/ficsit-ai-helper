# Gf — состояние на 11.11.2026

**Сейчас:** S1 ([#9](https://github.com/kkkingqz/ficsit-ai-helper/issues/9)), терминал, хост и модули экрана. Ветка `mod/s1-terminal`, [PR #40](https://github.com/kkkingqz/ficsit-ai-helper/pull/40). Документы веду из `work/gf`.

**Последний результат:** устранены замечания четвёртого раунда ревью Gs ([Gs-15](../questions/Gs.md)) в коммите `245b9e4`:
- **Мгновенное перестроение маппингов и обработка динамических привязок (Gs-15.1):**
  - в `AddMappingContext` и `RemoveMappingContext` передан `FModifyContextOptions` с `bForceImmediately = true` для синхронного перестроения `EnhancedActionMappings` до чтения `QueryKeysMappedToAction`;
  - подписан динамический делегат `ControlMappingsRebuiltDelegate` на метод `HandleControlMappingsRebuilt()`, автоматически обновляющий привязки и подсказки открытого экрана при смене профиля на лету.
- **JSON-сериализация заметок и полный round-trip (Gs-15.2):**
  - `UFicsitAITestNotesModule` переведён на `FJsonObject`, `TJsonWriterFactory` и `FJsonSerializer` из модуля `Json`;
  - поддержан строгий round-trip кавычек (`Pump "A" offline`), обратных слешей, переносов строк (`\n`) и очистка заметки при передаче пустой строки;
  - `SMultiLineEditableTextBox` переведён на `.HintText(...)` вместо подстановки плейсхолдера в рабочий текст.
- **Точные пропорции экрана 16:9 с учётом родительской иерархии (Gs-15.3, ADR-030, P-7 §1.1):**
  - `ScreenMeshComponent` крепится к `RootComponent` актора (базовый `USceneComponent` с масштабом `1.0, 1.0, 1.0`), исключая искажения масштабом корпуса стойки (`0.5, 1.2, 1.8`);
  - физические размеры экрана зафиксированы на 96 см в ширину и 54 см в высоту на лицевой панели (`Scale = 0.54, 0.96, 1.0`);
  - `GetScreenAspectRatio()` вычисляет итоговый масштаб с учётом цепочки родителей (`0.96 / 0.54 = 1.7777778` — ровно 16:9).
- **Физическая сериализация .sav на диск и сетевая репликация питания (Gs-15.4, §1.4 P-7):**
  - автотест `FicsitAI.Core.TerminalGame` выполняет запись и чтение файла `.sav` на диске через UE Archive с `ArIsSaveGame = true`, подтверждая сериализацию `UPROPERTY(SaveGame)`;
  - создаётся новая подсистема из файла `.sav` и подтверждается автоматическое восстановление сложного текста заметок во втором терминале без ручной передачи;
  - подтверждена сетевая репликация потери питания (`NoPower`) и восстановления (`Ready`) на клиентском терминале через `OnRep_HostContext()`.
- **Верификация:**
  - прогон в `UnrealEditor-Cmd`: оба теста (`TerminalGame` и `ScreenHost`) завершились успешно (`Result={Success}`, EXIT CODE: 0);
  - проверка архитектурных инвариантов: 5/5 OK (`check-invariants.sh`);
  - упаковка плагина для Win64 Shipping через UAT PackagePlugin успешна (`BUILD SUCCESSFUL`, ExitCode=0).

**Блокирует меня:** ничего.

**Ждут меня:** вердикт Gs по раунду 4 ревью в [#40](https://github.com/kkkingqz/ficsit-ai-helper/pull/40) на ревизии `245b9e4`.

**Решения, на которых стою:** ADR-014, ADR-016, ADR-026, ADR-027, ADR-029, ADR-030, `ARCHITECTURE.md` §6, §17.1 (решения King 10.11.2026), правила ревью в PR (Co-40, Co-41).

**Дальше:**

1. Дождаться подтверждения Gs и аппрува по PR #40.
2. При вердикте «принято» выполнить слияние PR #40 в `main` (Co-40).
3. Подключиться к P-4 (#5, Core CMake) вместе с Gf2 после коммита Co в `core/`.
