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

    // 1. Проверка начального состояния
    TestEqual(TEXT("Начальное состояние хоста: Ready"), Host->GetHostState(), EFicsitAIHostState::Ready);
    TestEqual(TEXT("SaveId хоста корректен"), Host->GetHostContext().SaveId, TEXT("test-save-id-42"));
    TestEqual(TEXT("Нет активного модуля"), Host->GetActiveModule(), NAME_None);

    // 2. Открытие модуля Notes
    TestTrue(TEXT("Открытие модуля Notes"), Host->OpenModule(FName(TEXT("Notes"))));
    TestEqual(TEXT("Активный модуль - Notes"), Host->GetActiveModule(), FName(TEXT("Notes")));
    TestNotNull(TEXT("Экземпляр модуля существует"), Host->GetActiveModuleInstance().GetObject());

    // 3. Проверка хоткеев модуля Notes (клавиша F)
    TArray<FFicsitAIHotkeyHint> NotesHints = Host->GetActiveModuleInstance()->GetHotkeyHints();
    TestTrue(TEXT("Модуль Notes объявляет хоткеи"), NotesHints.Num() > 0);
    TestEqual(TEXT("Хоткей Notes - клавиша F"), NotesHints[0].PrimaryKey, EKeys::F);

    // 4. Запись данных и переключение на модуль Status
    UFicsitAITestNotesModule* NotesModule = Cast<UFicsitAITestNotesModule>(Host->GetActiveModuleInstance().GetObject());
    TestNotNull(TEXT("Каст к NotesModule успешен"), NotesModule);
    if (NotesModule)
    {
        NotesModule->SetNoteContent(TEXT("Factory must grow"));
    }

    TestTrue(TEXT("Переключение на модуль Status"), Host->OpenModule(FName(TEXT("Status"))));
    TestEqual(TEXT("Активный модуль - Status"), Host->GetActiveModule(), FName(TEXT("Status")));

    // Проверяем, что состояние Notes было сохранено в хосте
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

    // 6. Отключение питания (NoPower)
    Host->SetTestHostState(EFicsitAIHostState::NoPower);
    TestEqual(TEXT("Хост перешёл в NoPower"), Host->GetHostState(), EFicsitAIHostState::NoPower);
    TestEqual(TEXT("Активный модуль сброшен при потере питания"), Host->GetActiveModule(), NAME_None);

    // 7. Восстановление питания и проверка данных
    Host->SetTestHostState(EFicsitAIHostState::Ready);
    TestTrue(TEXT("Открытие Notes после восстановления питания"), Host->OpenModule(FName(TEXT("Notes"))));
    NotesModule = Cast<UFicsitAITestNotesModule>(Host->GetActiveModuleInstance().GetObject());
    if (NotesModule)
    {
        TestEqual(TEXT("Текст сохраняется после отключения питания"), NotesModule->GetNoteContent(), TEXT("Factory must grow"));
    }

    // 8. Закрытие модуля
    Host->CloseModule(FName(TEXT("Notes")));
    TestEqual(TEXT("Модуль закрыт"), Host->GetActiveModule(), NAME_None);

    return true;
}

#endif
