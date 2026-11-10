#include "Misc/AutomationTest.h"
#include "Host/FicsitAITestScreenHost.h"
#include "FicsitAIScreenModuleFactoryImpl.h"
#include "Modules/FicsitAITestNotesModule.h"
#include "Modules/FicsitAITestStatusModule.h"

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

    // 3. Проверка хоткеев и требований модуля Notes
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

    return true;
}

#endif
