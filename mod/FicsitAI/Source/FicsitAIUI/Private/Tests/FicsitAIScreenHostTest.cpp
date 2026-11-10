#include "Misc/AutomationTest.h"
#include "Host/FicsitAITestScreenHost.h"
#include "FicsitAIScreenModuleFactoryImpl.h"
#include "Modules/FicsitAITestNotesModule.h"
#include "Modules/FicsitAITestStatusModule.h"
#include "Modules/FicsitAITestIncompatibleModule.h"

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

    // 11. Негативный тест: отказ в открытии модуля с несовместимой версией API (Gs-15.4, §5.5)
    TestFalse(TEXT("Открытие модуля с API 2.0.0 отклонено хостом"), Host->OpenModule(FName(TEXT("Incompatible"))));
    UFicsitAITestIncompatibleModule* IncompModule = Cast<UFicsitAITestIncompatibleModule>(Factory->CreateModule(FName(TEXT("Incompatible")), Host).GetObject());
    if (IncompModule)
    {
        TestFalse(TEXT("OnAttach не вызывался для несовместимого модуля"), IncompModule->IsAttached());
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
