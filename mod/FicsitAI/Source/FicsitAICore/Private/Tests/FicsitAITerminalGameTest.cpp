#include "Misc/AutomationTest.h"
#include "GameFacade/Terminal/FicsitAITerminal.h"
#include "GameFacade/Terminal/FicsitAISubsystem.h"
#include "Modules/FicsitAITestNotesModule.h"
#include "Modules/FicsitAITestStatusModule.h"
#include "Modules/FicsitAITestIncompatibleModule.h"

#if WITH_DEV_AUTOMATION_TESTS

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FFicsitAITerminalGameTest, "FicsitAI.Core.TerminalGame", EAutomationTestFlags_ApplicationContextMask | EAutomationTestFlags::ProductFilter)

bool FFicsitAITerminalGameTest::RunTest(const FString& Parameters)
{
    // 1. Создаём подсистему и проверяем персистентный SaveId
    AFicsitAISubsystem* Subsystem = NewObject<AFicsitAISubsystem>();
    const FString TestSaveId = TEXT("save-gameplay-test-42");
    Subsystem->SetSaveId(TestSaveId);
    TestEqual(TEXT("SaveId подсистемы инициализирован"), Subsystem->GetSaveId(), TestSaveId);

    // 2. Создаём терминал A и проверяем параметры постройки (P-7 §1.1)
    AFicsitAITerminal* TerminalA = NewObject<AFicsitAITerminal>();
    TerminalA->SetCustomSubsystem(Subsystem);
    TerminalA->InitializeHost();

    // Проверка 10 МВт (ADR-001, AC-01, P-7 §1.1)
    TestEqual(TEXT("Потребление энергии зафиксировано на 10 МВт"), TerminalA->GetTargetConsumption(), 10.0f);
    TestNotNull(TEXT("PowerInfoComponent существует"), TerminalA->PowerInfoComponent.Get());
    TestNotNull(TEXT("PowerConnectionComponent существует"), TerminalA->PowerConnectionComponent.Get());

    // 2.1 Проверка потери и восстановления питания (Gs-15 раунд 3, AC-01)
    TerminalA->SetPowerOverride(false);
    TerminalA->UpdateHostState();
    TestEqual(TEXT("При отключении питания терминал переходит в NoPower"), TerminalA->GetScreenContext().HostState, EFicsitAIHostState::NoPower);
    TestFalse(TEXT("Обесточенный терминал не открывает модули"), TerminalA->OpenModule(FName(TEXT("Notes"))));

    // Восстанавливаем питание (10 МВт)
    TerminalA->SetPowerOverride(true);
    TerminalA->UpdateHostState();
    TestEqual(TEXT("При подаче питания терминал переходит в Ready"), TerminalA->GetScreenContext().HostState, EFicsitAIHostState::Ready);

    // Проверка плоской поверхности экрана 16:9 на меше (ADR-030, P-7 §1.1)
    TestNotNull(TEXT("ScreenMeshComponent существует"), TerminalA->ScreenMeshComponent.Get());
    if (TerminalA->ScreenMeshComponent)
    {
        const FVector Scale = TerminalA->ScreenMeshComponent->GetRelativeScale3D();
        const float Ratio = Scale.Y / Scale.X;
        TestTrue(TEXT("Меш экрана имеет соотношение сторон 16:9"), FMath::IsNearlyEqual(Ratio, 16.0f / 9.0f, 0.05f));
    }

    // 3. Первое открытие терминала A и редактирование заметок (AC-14)
    TestTrue(TEXT("TerminalA открывает Notes"), TerminalA->OpenModule(FName(TEXT("Notes"))));
    TestEqual(TEXT("TerminalA активен Notes"), TerminalA->GetActiveModuleId(), FName(TEXT("Notes")));

    UFicsitAITestNotesModule* NotesA = Cast<UFicsitAITestNotesModule>(TerminalA->GetActiveModuleInstance().GetObject());
    TestNotNull(TEXT("Экземпляр NotesA валиден"), NotesA);
    const FString NoteText = TEXT("Autotest: Factory Must Grow at 100% efficiency!");
    if (NotesA)
    {
        NotesA->SetNoteContent(NoteText);
        TestEqual(TEXT("Текст заметки в NotesA записан"), NotesA->GetNoteContent(), NoteText);
    }

    // 4. Имитация сохранения игры с ОТКРЫТЫМ экраном (Gs-15 раунд 2 и 3, пункт 4)
    // PreSaveGame_Implementation должен сбросить состояние открытого экрана без ручного вызова
    Subsystem->PreSaveGame_Implementation(0, 0);

    const FString FlushedState = Subsystem->GetModuleState(TestSaveId, FName(TEXT("Notes")));
    TestFalse(TEXT("Состояние открытого модуля сброшено в подсистему при сохранении"), FlushedState.IsEmpty());
    TestTrue(TEXT("Сброшенное состояние содержит актуальный текст заметки"), FlushedState.Contains(NoteText));

    // Имитация загрузки сохранения
    Subsystem->PostLoadGame_Implementation(0, 0);

    // 5. Создаём терминал B в том же мире/сохранении и открываем Notes
    // Состояние должно восстановиться автоматически через подсистему (AC-14, Gs-15 раунд 3)
    AFicsitAITerminal* TerminalB = NewObject<AFicsitAITerminal>();
    TerminalB->SetCustomSubsystem(Subsystem);
    TerminalB->SetPowerOverride(true);
    TerminalB->InitializeHost();

    TestTrue(TEXT("TerminalB открывает Notes"), TerminalB->OpenModule(FName(TEXT("Notes"))));
    TestEqual(TEXT("TerminalB активен Notes"), TerminalB->GetActiveModuleId(), FName(TEXT("Notes")));

    UFicsitAITestNotesModule* NotesB = Cast<UFicsitAITestNotesModule>(TerminalB->GetActiveModuleInstance().GetObject());
    TestNotNull(TEXT("Экземпляр NotesB валиден"), NotesB);
    if (NotesB)
    {
        TestEqual(TEXT("TerminalB автоматически получил сохранённую заметку из подсистемы без ручного переноса"), NotesB->GetNoteContent(), NoteText);
    }

    // 6. Негативный тест: отказ несовместимого модуля сохраняет активный экран (Gs-15 раунд 3, пункт 3)
    TestFalse(TEXT("TerminalB отклоняет несовместимый модуль"), TerminalB->OpenModule(FName(TEXT("Incompatible"))));
    TestEqual(TEXT("После отклонения несовместимого модуля Notes остаётся активным на TerminalB"), TerminalB->GetActiveModuleId(), FName(TEXT("Notes")));

    // 7. Переключение между модулями на TerminalB
    TestTrue(TEXT("TerminalB переключается на Status"), TerminalB->OpenModule(FName(TEXT("Status"))));
    TestEqual(TEXT("TerminalB активен Status"), TerminalB->GetActiveModuleId(), FName(TEXT("Status")));

    TestTrue(TEXT("TerminalB возвращается на Notes"), TerminalB->OpenModule(FName(TEXT("Notes"))));
    NotesB = Cast<UFicsitAITestNotesModule>(TerminalB->GetActiveModuleInstance().GetObject());
    if (NotesB)
    {
        TestEqual(TEXT("Содержимое заметки сохранено при переключении модулей"), NotesB->GetNoteContent(), NoteText);
    }

    // 8. Закрытие терминалов
    TerminalA->CloseActiveModule();
    TerminalB->CloseActiveModule();
    Subsystem->UnregisterTerminal(TerminalA);
    Subsystem->UnregisterTerminal(TerminalB);
    TestEqual(TEXT("TerminalA закрыт"), TerminalA->GetActiveModuleId(), NAME_None);
    TestEqual(TEXT("TerminalB закрыт"), TerminalB->GetActiveModuleId(), NAME_None);

    return true;
}

#endif
