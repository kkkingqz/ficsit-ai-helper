# Gf — состояние на 11.11.2026

**Сейчас:** S1 ([#9](https://github.com/kkkingqz/ficsit-ai-helper/issues/9)), терминал, хост и модули экрана. Ветка `mod/s1-terminal`, [PR #40](https://github.com/kkkingqz/ficsit-ai-helper/pull/40). Документы веду из `work/gf`.

**Последний результат:** устранены замечания шестого раунда ревью Gs ([Gs-15](../questions/Gs.md#gs-15--gf--10112026--открыт), [комментарий 6790936153](https://github.com/kkkingqz/ficsit-ai-helper/pull/40#issuecomment-6790936153)) в коммите `271787d`:
- **Enhanced Input: непоглощающий ввод и устранение повторного срабатывания при удержании (Gs, пункт 3):**
  - для всех действий `IA_FicsitAI_OpenTerminal` (E), `IA_FicsitAI_Notes` (F), `IA_FicsitAI_Status` (R) и `IA_FicsitAI_Back` (Esc) выставлены `bConsumeInput = false` и `bConsumesActionAndAxisMappings = false`;
  - при закрытом терминале обычные действия игры не блокируются (<kbd>E</kbd> взаимодействие с миром, <kbd>F</kbd> режим демонтажа, <kbd>R</kbd> перезарядка оружия/смена режима постройки, <kbd>Esc</kbd> меню паузы);
  - к `ActionOpenTerminal` прикреплён триггер `UInputTriggerPressed`, а привязка в `AFicsitAISubsystem` переведена на `ETriggerEvent::Started`, исключая циклическое переключение открытия/закрытия по кадрам при удержании клавиши.
- **Очистка подсистемы от mock-раннера диагностики и защита сохранений (Gs, пункты 1 и 2):**
  - из `AFicsitAISubsystem` полностью удалён таймерный mock-раннер (`ExecuteDiagnosticsStep`, `RecordTestEvent`, `FlushDiagnosticsRecording`), безусловно выставлявший `PASS`;
  - исключена запись тестовых строк (`Pump "A" offline`) в реальный `ModuleStatesByKey` текущего `SaveId`;
  - в `FicsitAITerminalGameTest` проверяются флаги `bConsumeInput = false`, `bConsumesActionAndAxisMappings = false`, наличие триггера `UInputTriggerPressed` и опрос клавиш виджета.
- **Игровой протокол проверки P-7 §1.3–1.4:**
  - составлен детальный протокол по исходным наблюдениям в игре для меню и переназначения, удержания клавиш, электросети (NoPower / 10 МВт), инертного режима мультиплеера и персистентности `SaveId`/заметок при переименовании файлов сохранения;
  - протокол приложен в ответе на ревью в PR #40.
- **Ознакомление с общекомандными уведомлениями (Gf2-16, Co-40, Co-42, Co-45, Co-46, Co-47, Co-38):**
  - в `docs/team/questions/Gf.md` внесён блок `Gf-8` об ознакомлении через `tools/questions.py ack`; очередь уведомлений Gf очищена (0 ожидающих).
- **Верификация:**
  - автотесты в `UnrealEditor-Cmd`: `FicsitAI.Core.TerminalGame` и `FicsitAI.UI.ScreenHost` успешно пройдены (`Result={Success}`, `EXIT CODE: 0`);
  - проверка архитектурных инвариантов: 5/5 OK (`check-invariants.sh`);
  - упаковка плагина под Win64 Shipping через UAT: `BUILD SUCCESSFUL`, `ExitCode=0` (все 6 DLL и IoStore собраны);
  - в [PR #40](https://github.com/kkkingqz/ficsit-ai-helper/pull/40#issuecomment-6791200448) опубликован ответ на замечания раунда 6 по ревизии `271787d`.

**Блокирует меня:** ничего.

**Ждут меня:** вердикт Gs по раунду 6 ревью в [#40](https://github.com/kkkingqz/ficsit-ai-helper/pull/40) на ревизии `271787d`.

**Решения, на которых стою:** ADR-014, ADR-016, ADR-026, ADR-027, ADR-029, ADR-030, `ARCHITECTURE.md` §6, §17.1 (решения King 10.11.2026), правила ревью в PR (Co-40, Co-41).

**Дальше:**

1. Дождаться подтверждения Gs и вердикта по PR #40.
2. При вердикте «принято» выполнить слияние PR #40 в `main` (Co-40).
3. Подключиться к P-4 (#5, Core CMake) вместе с Gf2 после коммита Co в `core/`.
