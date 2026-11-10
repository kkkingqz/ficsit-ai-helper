# Gf — состояние на 10.11.2026

**Сейчас:** S1 ([#9](https://github.com/kkkingqz/ficsit-ai-helper/issues/9)), терминал, хост и модули экрана. Ветка `mod/s1-terminal`, [PR #40](https://github.com/kkkingqz/ficsit-ai-helper/pull/40). Документы веду из `work/gf`.

**Последний результат:** устранены замечания второго раунда ревью Gs ([Gs-15](../questions/Gs.md)) в коммите `11506a3`:
- убран ручной вызов `RegisterSchematic` из `UFicsitAIWorldModule` (SML 3.12 регистрирует `mSchematics` на `INITIALIZATION`);
- подключена силовая цепь `PowerConnectionComponent->SetPowerInfo(PowerInfoComponent)` на 10 МВт, добавлен физический меш-куб стойки (`/Engine/BasicShapes/Cube.Cube`), выстроена Slate-иерархия `UFicsitAIScreenSurfaceWidget` (Header, 16:9 контент, Footer);
- добавлено открытие видимого экрана с баннерами NoPower/Inert при отсутствии питания или мультиплеере, перехват ввода клавиш через Slate `NativeOnKeyDown` и регистрация Enhanced Input в `UEnhancedInputLocalPlayerSubsystem`;
- Server Authority: `UpdateHostState()` в `Tick` и `OnUse` строго ограничен `if (HasAuthority())`; удалённые клиенты не перезаписывают `Inert` локально и реагируют через `OnRep_HostContext()`;
- проверка версии API до `OnAttach`: добавлена проверка совместимости мажорной версии (`CheckApiCompatibility`) в `AFicsitAITerminal` и `UFicsitAITestScreenHost`, создан `UFicsitAITestIncompatibleModule` (версия 2.0.0) и негативный автотест;
- персистентность состояния модулей: добавлен `FlushActiveModuleState()`, вызываемый при `NotifyContentChanged()`, `PreSaveGame_Implementation` в терминале и подсистеме `AFicsitAISubsystem`; добавлен тест кросс-терминального переноса состояния `(SaveId, ModuleId)`;
- автотест `FicsitAI.UI.ScreenHost` в `UnrealEditor-Cmd` успешен (`Result={Success}`, ExitCode: 0);
- все 5 архитектурных инвариантов `check-invariants.sh` соблюдены (5/5 OK);
- кросс-компиляция и упаковка Win64 Shipping через UAT успешна (`BUILD SUCCESSFUL`, ExitCode=0).

**Блокирует меня:** ничего.

**Ждут меня:** вердикт Gs по раунду 2 ревью в [#40](https://github.com/kkkingqz/ficsit-ai-helper/pull/40) на ревизии `11506a3`.

**Решения, на которых стою:** ADR-014, ADR-016, ADR-026, ADR-027, ADR-029, ADR-030, `ARCHITECTURE.md` §6, §17.1 (решения King 10.11.2026), правила ревью в PR (Co-40, Co-41).

**Дальше:**

1. Дождаться подтверждения Gs и аппрува по PR #40.
2. При вердикте «принято» выполнить слияние PR #40 в `main` (Co-40).
3. Подключиться к P-4 (#5, Core CMake) вместе с Gf2 после коммита Co в `core/`.
