# Gf — состояние на 11.11.2026

**Сейчас:** S1 ([#9](https://github.com/kkkingqz/ficsit-ai-helper/issues/9)), терминал, хост и модули экрана. Ветка `mod/s1-terminal`, [PR #40](https://github.com/kkkingqz/ficsit-ai-helper/pull/40). Документы веду из `work/gf`.

**Последний результат:** устранены замечания третьего раунда ревью Gs ([Gs-15](../questions/Gs.md)) в коммите `8201bcc`:
- **Виджеты модулей и экран 16:9 на меше (Gs-15.1, ADR-030, P-7 §1.1):**
  - реализован `RebuildWidget()` для `UFicsitAITestNotesModule` (стилизованный баннер + `SMultiLineEditableTextBox`) и `UFicsitAITestStatusModule` (телеметрия состояния);
  - в `UFicsitAIScreenSurfaceWidget` добавлен метод `RefreshModuleContent()`, безопасно наполняющий контейнер при первом открытии (`RebuildWidget`), смене модуля (`SetModule`), очистке (`ClearModule`) и смене состояния (`SetHostState`);
  - на лицевой стороне терминала `AFicsitAITerminal` закреплён `ScreenMeshComponent` (`Plane.Plane`) с масштабированием под соотношение 16:9.
- **Динамическое переназначение клавиш и изоляция ввода (Gs-15.2):**
  - в `UFicsitAIScreenSurfaceWidget` добавлены `SetActionKeyBindings`, `SetActionKeyBinding` и `GetKeyForAction`;
  - нижняя полоса подсказок `GetFormattedHotkeyHints` динамически выводит актуальные клавиши (`[Key] Описание`), поддерживая дефолтные (`[Esc]`, `[F]`, `[R]`) и переназначенные (`[N]`);
  - `NativeOnKeyDown` сопоставляет ввод с актуальными маппингами действий вместо фиксированных клавиш;
  - удалена глобальная регистрация IMC из тика подсистемы; контекст терминала выдаётся игроку строго при `OnUse` и забирается при `CloseActiveModule`.
- **Сохранение активного экрана при отклонении несовместимого API (Gs-15.3, §5.5):**
  - в `AFicsitAITerminal::OpenModule` и `UFicsitAITestScreenHost::OpenModule` проверка версии API выполняется до любого teardown;
  - при попытке открыть несовместимый модуль экран и активный модуль остаются открытыми и нетронутыми;
  - в тестовом хосте добавлен `GetLoadedModules()` для верификации экземпляров.
- **Игровой автотест и персистентность через подсистему (Gs-15.4):**
  - написан сквозной тест `FicsitAITerminalGameTest.cpp` (`FicsitAI.Core.TerminalGame`), проверяющий 10 МВт, меш 16:9, потерю питания (`NoPower`) и восстановление (`Ready`), сброс открытого экрана в `PreSaveGame`, загрузку сохранения и автоматическое восстановление состояния во втором терминале без ручного переноса;
  - прогон в `UnrealEditor-Cmd`: оба теста (`TerminalGame` и `ScreenHost`) завершились успешно (`Result={Success}`, EXIT CODE: 0);
  - проверка архитектурных инвариантов: 5/5 OK (`check-invariants.sh`);
  - сборка плагина для Win64 Shipping через UAT PackagePlugin успешна (`BUILD SUCCESSFUL`, ExitCode=0).

**Блокирует меня:** ничего.

**Ждут меня:** вердикт Gs по раунду 3 ревью в [#40](https://github.com/kkkingqz/ficsit-ai-helper/pull/40) на ревизии `8201bcc`.

**Решения, на которых стою:** ADR-014, ADR-016, ADR-026, ADR-027, ADR-029, ADR-030, `ARCHITECTURE.md` §6, §17.1 (решения King 10.11.2026), правила ревью в PR (Co-40, Co-41).

**Дальше:**

1. Дождаться подтверждения Gs и аппрува по PR #40.
2. При вердикте «принято» выполнить слияние PR #40 в `main` (Co-40).
3. Подключиться к P-4 (#5, Core CMake) вместе с Gf2 после коммита Co в `core/`.
