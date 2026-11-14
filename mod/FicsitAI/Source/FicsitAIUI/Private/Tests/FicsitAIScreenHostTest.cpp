#include "Misc/AutomationTest.h"
#include "Host/FicsitAITestScreenHost.h"
#include "FicsitAIScreenModuleFactoryImpl.h"
#include "Modules/FicsitAITestNotesModule.h"
#include "Modules/FicsitAITestStatusModule.h"
#include "Modules/FicsitAITestIncompatibleModule.h"
#include "Input/Events.h"
#include "Widgets/SWidget.h"

#if WITH_DEV_AUTOMATION_TESTS

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FFicsitAIScreenHostTest, "FicsitAI.UI.ScreenHost", EAutomationTestFlags_ApplicationContextMask | EAutomationTestFlags::ProductFilter)

bool FFicsitAIScreenHostTest::RunTest(const FString& Parameters)
{
    UFicsitAITestScreenHost* Host = NewObject<UFicsitAITestScreenHost>();
    UFicsitAIScreenModuleFactoryImpl* Factory = NewObject<UFicsitAIScreenModuleFactoryImpl>();
    Host->InitializeTestHost(TEXT("test-save-id-42"), Factory);

    // 1. Проверка начального состояния и доступных модулей
    TestEqual(TEXT("Начальное состояние хоста: Ready"), Host->GetHostState(), EFicsitAIHostState::Ready);
    TestEqual(TEXT("SaveId хоста корректен"), Host->GetScreenContext().SaveId, TEXT("test-save-id-42"));
    TestEqual(TEXT("Нет активного модуля"), Host->GetActiveModuleId(), NAME_None);

    TArray<FName> AvailableModules = Host->GetAvailableModules();
    TestTrue(TEXT("Хост объявляет доступные модули"), AvailableModules.Num() >= 2);
    TestTrue(TEXT("Содержит Notes"), AvailableModules.Contains(FName(TEXT("Notes"))));
    TestTrue(TEXT("Содержит Status"), AvailableModules.Contains(FName(TEXT("Status"))));

    // 2. Открытие модуля Notes
    TestTrue(TEXT("Открытие модуля Notes"), Host->OpenModule(FName(TEXT("Notes"))));
    TestEqual(TEXT("Активный модуль - Notes"), Host->GetActiveModuleId(), FName(TEXT("Notes")));
    TestNotNull(TEXT("Экземпляр модуля существует"), Host->GetActiveModuleInstance().GetObject());

    // Проверка поверхности экрана
    UFicsitAIScreenSurfaceWidget* Surface = Cast<UFicsitAIScreenSurfaceWidget>(Host->GetScreenSurface().GetObject());
    TestNotNull(TEXT("Поверхность экрана существует"), Surface);
    if (Surface)
    {
        TestEqual(TEXT("Поверхность отображает активный модуль"), Surface->GetActiveModule(), Host->GetActiveModuleInstance());
    }

    // 3. Проверка хоткеев, переназначения клавиш (Gs-15 раунд 3) и требований модуля Notes
    IFicsitAIScreenModule* ModuleInterface = Cast<IFicsitAIScreenModule>(Host->GetActiveModuleInstance().GetObject());
    TestNotNull(TEXT("Интерфейс модуля валиден"), ModuleInterface);
    if (ModuleInterface)
    {
        TestEqual(TEXT("Версия API модуля 0.3.0"), ModuleInterface->GetRequiredApiVersion(), TEXT("0.3.0"));
        TestTrue(TEXT("Модулю Notes требуется ввод"), ModuleInterface->WantsInputFocus());

        TArray<FFicsitAIHotkeyHint> NotesHints = ModuleInterface->GetHotkeyHints();
        TestTrue(TEXT("Модуль Notes объявляет хоткеи"), NotesHints.Num() > 0);
        TestEqual(TEXT("Хоткей Notes - IA_FicsitAI_Notes"), NotesHints[0].ActionId, FName(TEXT("IA_FicsitAI_Notes")));
    }

    if (Surface)
    {
        TMap<FName, FKey> DefaultBindings;
        DefaultBindings.Add(FName(TEXT("IA_FicsitAI_OpenTerminal")), EKeys::E);
        DefaultBindings.Add(FName(TEXT("IA_FicsitAI_Notes")), EKeys::F);
        DefaultBindings.Add(FName(TEXT("IA_FicsitAI_Status")), EKeys::R);
        DefaultBindings.Add(FName(TEXT("IA_FicsitAI_Back")), EKeys::Escape);
        Surface->SetActionKeyBindings(DefaultBindings);

        FString HintsStr = Surface->GetFormattedHotkeyHints().ToString();
        TestTrue(TEXT("Полоса подсказок содержит [F] для Notes по умолчанию"), HintsStr.Contains(TEXT("[F]")));
        TestTrue(TEXT("Полоса подсказок содержит [Esc] для Back по умолчанию"), HintsStr.Contains(TEXT("[Esc]")));

        // Переназначение клавиши Notes на N
        Surface->SetActionKeyBinding(FName(TEXT("IA_FicsitAI_Notes")), EKeys::N);
        FString RemappedHints = Surface->GetFormattedHotkeyHints().ToString();
        TestTrue(TEXT("После переназначения полоса содержит [N]"), RemappedHints.Contains(TEXT("[N]")));
        TestFalse(TEXT("После переназначения полоса больше не содержит [F]"), RemappedHints.Contains(TEXT("[F]")));
        TestEqual(TEXT("GetKeyForAction возвращает клавишу N"), Surface->GetKeyForAction(FName(TEXT("IA_FicsitAI_Notes"))), EKeys::N);
    }

    // 4. Запись данных и переключение на модуль Status
    UFicsitAITestNotesModule* NotesModule = Cast<UFicsitAITestNotesModule>(Host->GetActiveModuleInstance().GetObject());
    TestNotNull(TEXT("Каст к NotesModule успешен"), NotesModule);
    if (NotesModule)
    {
        NotesModule->SetNoteContent(TEXT("Factory must grow"));
        NotesModule->SetInputFocus(true);
    }

    // Проверка снятия фокуса через HandleBackAction (Esc) по Gs-4
    TestTrue(TEXT("HandleBackAction снимает фокус с поля ввода"), Host->HandleBackAction());
    TestEqual(TEXT("Модуль всё ещё открыт после первого Esc"), Host->GetActiveModuleId(), FName(TEXT("Notes")));

    TestTrue(TEXT("Переключение на модуль Status"), Host->OpenModule(FName(TEXT("Status"))));
    TestEqual(TEXT("Активный модуль - Status"), Host->GetActiveModuleId(), FName(TEXT("Status")));

    // Проверяем, что состояние Notes было сохранено в хосте (AC-14)
    const TMap<FName, FString>& SavedStates = Host->GetModulePersistentStates();
    TestTrue(TEXT("Хост содержит сохранённое состояние Notes"), SavedStates.Contains(FName(TEXT("Notes"))));
    TestTrue(TEXT("Сохранённый текст содержит заметку"), SavedStates[FName(TEXT("Notes"))].Contains(TEXT("Factory must grow")));

    // 5. Переключение обратно на Notes с восстановлением состояния
    TestTrue(TEXT("Возврат к модулю Notes"), Host->OpenModule(FName(TEXT("Notes"))));
    NotesModule = Cast<UFicsitAITestNotesModule>(Host->GetActiveModuleInstance().GetObject());
    TestNotNull(TEXT("NotesModule снова активен"), NotesModule);
    if (NotesModule)
    {
        TestEqual(TEXT("Текст заметки успешно восстановлен из состояния"), NotesModule->GetNoteContent(), TEXT("Factory must grow"));

        // Проверка round-trip кавычек и спецсимволов (Gs-15 раунд 4, пункт 2)
        NotesModule->SetNoteContent(TEXT("Pump \"A\" offline"));
        const FString JsonWithQuotes = NotesModule->SavePersistentState();
        NotesModule->SetNoteContent(TEXT("Temporary old cached text"));
        NotesModule->RestorePersistentState(JsonWithQuotes);
        TestEqual(TEXT("Заметка с кавычками полностью восстановлена"), NotesModule->GetNoteContent(), TEXT("Pump \"A\" offline"));

        // Проверка очистки заметки пустой сохранённой строкой (Gs-15 раунд 4, пункт 2)
        NotesModule->RestorePersistentState(TEXT(""));
        TestTrue(TEXT("Пустая сохранённая строка очищает заметку"), NotesModule->GetNoteContent().IsEmpty());

        // Восстанавливаем рабочий текст перед проверкой смены состояний
        NotesModule->SetNoteContent(TEXT("Factory must grow"));
    }

    // 6. Переход в инертный режим (Inert) при открытом модуле (Gs-15.3, ADR-016)
    Host->SetTestHostState(EFicsitAIHostState::Inert);
    TestEqual(TEXT("Хост перешёл в Inert"), Host->GetHostState(), EFicsitAIHostState::Inert);
    TestEqual(TEXT("Активный модуль сброшен при переходе в Inert"), Host->GetActiveModuleId(), NAME_None);
    if (Surface)
    {
        TestEqual(TEXT("Поверхность перешла в Inert"), Surface->GetHostState(), EFicsitAIHostState::Inert);
        TestNull(TEXT("Модуль очищен с поверхности"), Surface->GetActiveModule().GetObject());
    }

    // 7. Попытка открыть модуль в Inert блокируется
    TestFalse(TEXT("Открытие модуля в Inert запрещено"), Host->OpenModule(FName(TEXT("Notes"))));

    // 8. Возврат в Ready, отключение питания (NoPower) и проверка данных
    Host->SetTestHostState(EFicsitAIHostState::Ready);
    TestTrue(TEXT("Открытие Notes после возврата в Ready"), Host->OpenModule(FName(TEXT("Notes"))));

    Host->SetTestHostState(EFicsitAIHostState::NoPower);
    TestEqual(TEXT("Хост перешёл в NoPower"), Host->GetHostState(), EFicsitAIHostState::NoPower);
    TestEqual(TEXT("Активный модуль сброшен при NoPower"), Host->GetActiveModuleId(), NAME_None);

    // 9. Восстановление питания и проверка сохранённых данных
    Host->SetTestHostState(EFicsitAIHostState::Ready);
    TestTrue(TEXT("Открытие Notes после восстановления питания"), Host->OpenModule(FName(TEXT("Notes"))));
    NotesModule = Cast<UFicsitAITestNotesModule>(Host->GetActiveModuleInstance().GetObject());
    if (NotesModule)
    {
        TestEqual(TEXT("Текст сохраняется после отключения питания"), NotesModule->GetNoteContent(), TEXT("Factory must grow"));
    }

    // 10. Закрытие активного модуля через CloseActiveModule
    Host->CloseActiveModule();
    TestEqual(TEXT("Модуль закрыт"), Host->GetActiveModuleId(), NAME_None);

    // 11. Негативный тест: отказ в открытии модуля с несовместимой версией API (Gs-15 раунд 3)
    // Открываем рабочий модуль Notes
    TestTrue(TEXT("Notes открыт перед негативным тестом"), Host->OpenModule(FName(TEXT("Notes"))));
    TestEqual(TEXT("Notes активен перед негативным тестом"), Host->GetActiveModuleId(), FName(TEXT("Notes")));

    TestFalse(TEXT("Открытие модуля с API 2.0.0 отклонено хостом"), Host->OpenModule(FName(TEXT("Incompatible"))));
    TestEqual(TEXT("При отказе несовместимого модуля Notes остаётся активным (Gs-15 раунд 3)"), Host->GetActiveModuleId(), FName(TEXT("Notes")));

    UFicsitAITestIncompatibleModule* IncompModule = Cast<UFicsitAITestIncompatibleModule>(Host->GetLoadedModules().FindRef(FName(TEXT("Incompatible"))).GetObject());
    TestNotNull(TEXT("Хост содержит экземпляр Incompatible"), IncompModule);
    if (IncompModule)
    {
        TestFalse(TEXT("OnAttach не вызывался для несовместимого модуля"), IncompModule->IsAttached());
    }

    Host->CloseActiveModule();
    TestEqual(TEXT("Модуль закрыт после завершения теста"), Host->GetActiveModuleId(), NAME_None);

    if (Surface)
    {
        TestTrue(TEXT("Status opens before testing the interaction key"), Host->OpenModule(TEXT("Status")));
        const TSharedRef<SWidget> SlateSurface = Surface->TakeWidget();
        const FInputDeviceId Device = FInputDeviceId::CreateFromInternalId(0);
        const FKeyEvent HeldUseKey(EKeys::E, FModifierKeysState(), Device, true, 0, 0, 0);
        TestTrue(TEXT("The surface handles auto-repeat of its interaction key"),
            SlateSurface->OnKeyDown(FGeometry(), HeldUseKey).IsEventHandled());
        TestEqual(TEXT("Holding the interaction key keeps the opened module active"),
            Host->GetActiveModuleId(), FName(TEXT("Status")));

        Surface->SetActionKeyBinding(TEXT("IA_FicsitAI_OpenTerminal"), EKeys::T);
        const FKeyEvent PressedReboundKey(EKeys::T, FModifierKeysState(), Device, false, 0, 0, 0);
        TestTrue(TEXT("The surface handles a fresh press of the remapped interaction key"),
            SlateSurface->OnKeyDown(FGeometry(), PressedReboundKey).IsEventHandled());
        TestEqual(TEXT("The remapped interaction key closes the module"),
            Host->GetActiveModuleId(), NAME_None);

        // 11.1 Проверка режима поверхности в мире (bWorldSurface = true скрывает нижнюю полосу клавиш, §6.6 / Co3-2)
        Surface->SetWorldSurfaceMode(true);
        TestTrue(TEXT("SetWorldSurfaceMode(true) активирован"), Surface->IsWorldSurfaceMode());
        Surface->SetWorldSurfaceMode(false);
        TestFalse(TEXT("SetWorldSurfaceMode(false) восстановлен"), Surface->IsWorldSurfaceMode());
    }

    // 12. Перенос состояния между двумя хостами одного сохранения (Gs-15.5, AC-14)
    UFicsitAITestScreenHost* HostA = NewObject<UFicsitAITestScreenHost>();
    HostA->InitializeTestHost(TEXT("save-shared-100"), Factory);
    TestTrue(TEXT("HostA открывает Notes"), HostA->OpenModule(FName(TEXT("Notes"))));
    UFicsitAITestNotesModule* NotesA = Cast<UFicsitAITestNotesModule>(HostA->GetActiveModuleInstance().GetObject());
    if (NotesA)
    {
        NotesA->SetNoteContent(TEXT("Shared state between terminals"));
    }
    HostA->CloseActiveModule();

    // Создаём второй хост в том же сохранении
    UFicsitAITestScreenHost* HostB = NewObject<UFicsitAITestScreenHost>();
    HostB->InitializeTestHost(TEXT("save-shared-100"), Factory);
    const FString SavedStateA = HostA->GetModulePersistentStates().FindRef(FName(TEXT("Notes")));
    TestFalse(TEXT("Сохранённое состояние не пустое"), SavedStateA.IsEmpty());

    TestTrue(TEXT("HostB открывает Notes"), HostB->OpenModule(FName(TEXT("Notes"))));
    UFicsitAITestNotesModule* NotesB = Cast<UFicsitAITestNotesModule>(HostB->GetActiveModuleInstance().GetObject());
    if (NotesB)
    {
        NotesB->RestorePersistentState(SavedStateA);
        TestEqual(TEXT("HostB в том же сохранении видит состояние HostA"), NotesB->GetNoteContent(), TEXT("Shared state between terminals"));
    }

    return true;
}

#endif
