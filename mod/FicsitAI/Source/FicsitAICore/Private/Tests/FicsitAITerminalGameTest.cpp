#include "Misc/AutomationTest.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "Serialization/MemoryWriter.h"
#include "Serialization/MemoryReader.h"
#include "GameFacade/Terminal/FicsitAITerminal.h"
#include "GameFacade/Terminal/FicsitAISubsystem.h"
#include "GameFacade/Terminal/FicsitAIInputMappingContext.h"
#include "Surface/FicsitAIScreenSurfaceWidget.h"
#include "PlayerMappableKeySettings.h"
#include "InputTriggers.h"
#include "Modules/FicsitAITestNotesModule.h"
#include "Modules/FicsitAITestStatusModule.h"
#include "Modules/FicsitAITestIncompatibleModule.h"

#if WITH_DEV_AUTOMATION_TESTS

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FFicsitAITerminalGameTest, "FicsitAI.Core.TerminalGame", EAutomationTestFlags_ApplicationContextMask | EAutomationTestFlags::ProductFilter)

bool FFicsitAITerminalGameTest::RunTest(const FString& Parameters)
{
    // 1. Создаём подсистему и проверяем персистентный SaveId (ADR-014, AC-07)
    AFicsitAISubsystem* SubsystemA = NewObject<AFicsitAISubsystem>();
    const FString TestSaveId = TEXT("save-gameplay-test-42");
    SubsystemA->SetSaveId(TestSaveId);
    TestEqual(TEXT("SaveId подсистемы инициализирован"), SubsystemA->GetSaveId(), TestSaveId);

    // 2. Создаём терминал A и проверяем параметры постройки (P-7 §1.1)
    AFicsitAITerminal* TerminalA = NewObject<AFicsitAITerminal>();
    TerminalA->SetCustomSubsystem(SubsystemA);
    TerminalA->InitializeHost();

    // Проверка 10 МВт (ADR-001, AC-01, P-7 §1.1)
    TestEqual(TEXT("Потребление энергии зафиксировано на 10 МВт"), TerminalA->GetTargetConsumption(), 10.0f);
    TestNotNull(TEXT("PowerInfoComponent существует"), TerminalA->PowerInfoComponent.Get());
    TestNotNull(TEXT("PowerConnectionComponent существует"), TerminalA->PowerConnectionComponent.Get());

    // Проверка плоской поверхности экрана 16:9 на меше с учётом родителя (ADR-030, P-7 §1.1, Gs-15 раунд 4)
    TestNotNull(TEXT("ScreenMeshComponent существует"), TerminalA->ScreenMeshComponent.Get());
    TestTrue(TEXT("Меш экрана имеет соотношение сторон 16:9 с учётом родителя"), FMath::IsNearlyEqual(TerminalA->GetScreenAspectRatio(), 16.0f / 9.0f, 0.01f));

    // 2.1 Проверка потери и восстановления питания через сеть (Authority & Replication) (ADR-027, AC-01, Gs-15 раунд 4)
    AFicsitAITerminal* TerminalClient = NewObject<AFicsitAITerminal>();
    TerminalClient->SetCustomSubsystem(SubsystemA);
    TerminalClient->InitializeHost();

    // Сервер теряет питание
    TerminalA->SetPowerOverride(false);
    TerminalA->UpdateHostState();
    TestEqual(TEXT("Сервер при потере питания переходит в NoPower"), TerminalA->GetScreenContext().HostState, EFicsitAIHostState::NoPower);
    TestFalse(TEXT("Обесточенный сервер не открывает модули"), TerminalA->OpenModule(FName(TEXT("Notes"))));

    // Клиент получает реплицированный контекст от сервера
    TerminalClient->SetHostContextForClient(TerminalA->GetScreenContext());
    TerminalClient->OnRep_HostContext();
    TestEqual(TEXT("Клиент реплицирует NoPower от сервера"), TerminalClient->GetScreenContext().HostState, EFicsitAIHostState::NoPower);
    TestFalse(TEXT("Клиент не открывает модули при NoPower"), TerminalClient->OpenModule(FName(TEXT("Notes"))));

    // Сервер восстанавливает питание (10 МВт)
    TerminalA->SetPowerOverride(true);
    TerminalA->UpdateHostState();
    TestEqual(TEXT("Сервер при подаче питания переходит в Ready"), TerminalA->GetScreenContext().HostState, EFicsitAIHostState::Ready);

    // Клиент реплицирует восстановление питания
    TerminalClient->SetHostContextForClient(TerminalA->GetScreenContext());
    TerminalClient->OnRep_HostContext();
    TestEqual(TEXT("Клиент реплицирует Ready от сервера"), TerminalClient->GetScreenContext().HostState, EFicsitAIHostState::Ready);

    // 2.2 Проверка Enhanced Input до открытия терминала (P-7 §1.3–1.4, Gs-15 раунды 5 и 6)
    const UFicsitAIInputMappingContext* IMC = GetDefault<UFicsitAIInputMappingContext>();
    TestNotNull(TEXT("IMC существует"), IMC);
    if (IMC)
    {
        TestEqual(TEXT("Приоритет меню контекста равен 200 (SML стандарт)"), IMC->mMenuPriority, 200.0f);
        TestNotNull(TEXT("ActionOpenTerminal задан"), IMC->ActionOpenTerminal.Get());
        TestNotNull(TEXT("ActionNotes задан"), IMC->ActionNotes.Get());
        TestNotNull(TEXT("ActionStatus задан"), IMC->ActionStatus.Get());
        TestNotNull(TEXT("ActionBack задан"), IMC->ActionBack.Get());

        // Проверка отсутствия поглощения ввода при закрытом терминале (Gs-15 раунд 6, замечание 3)
        TestFalse(TEXT("ActionOpenTerminal не поглощает ввод (bConsumeInput = false)"), IMC->ActionOpenTerminal->bConsumeInput);
        TestFalse(TEXT("ActionNotes не поглощает ввод (bConsumeInput = false)"), IMC->ActionNotes->bConsumeInput);
        TestFalse(TEXT("ActionStatus не поглощает ввод (bConsumeInput = false)"), IMC->ActionStatus->bConsumeInput);
        TestFalse(TEXT("ActionBack не поглощает ввод (bConsumeInput = false)"), IMC->ActionBack->bConsumeInput);

        TestFalse(TEXT("ActionOpenTerminal не блокирует Action/Axis mappings"), IMC->ActionOpenTerminal->bConsumesActionAndAxisMappings);
        TestFalse(TEXT("ActionNotes не блокирует Action/Axis mappings"), IMC->ActionNotes->bConsumesActionAndAxisMappings);
        TestFalse(TEXT("ActionStatus не блокирует Action/Axis mappings"), IMC->ActionStatus->bConsumesActionAndAxisMappings);
        TestFalse(TEXT("ActionBack не блокирует Action/Axis mappings"), IMC->ActionBack->bConsumesActionAndAxisMappings);

        // Проверка наличия триггера нажатия на ActionOpenTerminal (предотвращает повтор по кадрам при удержании)
        TestTrue(TEXT("ActionOpenTerminal имеет триггеры"), IMC->ActionOpenTerminal->Triggers.Num() > 0);
        TestTrue(TEXT("Триггер ActionOpenTerminal является UInputTriggerPressed"), IMC->ActionOpenTerminal->Triggers[0]->IsA<UInputTriggerPressed>());

        TestNotNull(TEXT("ActionOpenTerminal имеет MappableKeySettings"), IMC->ActionOpenTerminal->GetPlayerMappableKeySettings().Get());
        TestNotNull(TEXT("ActionNotes имеет MappableKeySettings"), IMC->ActionNotes->GetPlayerMappableKeySettings().Get());
        TestNotNull(TEXT("ActionStatus имеет MappableKeySettings"), IMC->ActionStatus->GetPlayerMappableKeySettings().Get());
        TestNotNull(TEXT("ActionBack имеет MappableKeySettings"), IMC->ActionBack->GetPlayerMappableKeySettings().Get());

        TestEqual(TEXT("Имя привязки OpenTerminal корректно"), IMC->ActionOpenTerminal->GetPlayerMappableKeySettings()->Name, FName(TEXT("FicsitAI.OpenTerminal")));
        TestEqual(TEXT("Имя привязки Notes корректно"), IMC->ActionNotes->GetPlayerMappableKeySettings()->Name, FName(TEXT("FicsitAI.Notes")));
    }

    // Проверка отображения клавиш виджетом по умолчанию и при динамическом переназначении (P-7 §1.3–1.4)
    UFicsitAIScreenSurfaceWidget* TestWidget = NewObject<UFicsitAIScreenSurfaceWidget>();
    TestEqual(TEXT("GetKeyForAction для Notes по умолчанию возвращает F"), TestWidget->GetKeyForAction(FName(TEXT("IA_FicsitAI_Notes"))), EKeys::F);
    TestEqual(TEXT("GetKeyForAction для OpenTerminal по умолчанию возвращает E"), TestWidget->GetKeyForAction(FName(TEXT("IA_FicsitAI_OpenTerminal"))), EKeys::E);

    // Динамическое переназначение клавиш в настройках (например, Notes -> N, Open -> T)
    TestWidget->SetActionKeyBinding(FName(TEXT("IA_FicsitAI_Notes")), EKeys::N);
    TestWidget->SetActionKeyBinding(FName(TEXT("IA_FicsitAI_OpenTerminal")), EKeys::T);

    TestEqual(TEXT("GetKeyForAction для Notes возвращает переназначенную N с первого открытия"), TestWidget->GetKeyForAction(FName(TEXT("IA_FicsitAI_Notes"))), EKeys::N);
    TestEqual(TEXT("GetKeyForAction для OpenTerminal возвращает переназначенную T с первого открытия"), TestWidget->GetKeyForAction(FName(TEXT("IA_FicsitAI_OpenTerminal"))), EKeys::T);

    // 3. Первое открытие терминала A и редактирование заметок (AC-14, Gs-15 раунд 4)
    TestTrue(TEXT("TerminalA открывает Notes"), TerminalA->OpenModule(FName(TEXT("Notes"))));
    TestEqual(TEXT("TerminalA активен Notes"), TerminalA->GetActiveModuleId(), FName(TEXT("Notes")));

    UFicsitAITestNotesModule* NotesA = Cast<UFicsitAITestNotesModule>(TerminalA->GetActiveModuleInstance().GetObject());
    TestNotNull(TEXT("Экземпляр NotesA валиден"), NotesA);
    // Проверка сложного текста с кавычками и переводами строк (Gs-15 раунд 4, пункт 2)
    const FString ComplexNoteText = TEXT("Pump \"A\" offline\nLine 2: 100% efficiency guaranteed!");
    if (NotesA)
    {
        NotesA->SetNoteContent(ComplexNoteText);
        TestEqual(TEXT("Текст заметки с кавычками в NotesA записан"), NotesA->GetNoteContent(), ComplexNoteText);
    }

    // 4. Сброс состояния открытого экрана и реальная сериализация в .sav файл на диске (§1.4 P-7, Gs-15 раунд 4)
    SubsystemA->PreSaveGame_Implementation(0, 0);

    // Сериализация через UE Archive с флагом ArIsSaveGame = true (проверяет UPROPERTY(SaveGame))
    TArray<uint8> SaveData;
    FMemoryWriter MemWriter(SaveData, true);
    MemWriter.ArIsSaveGame = true;
    SubsystemA->Serialize(MemWriter);
    TestTrue(TEXT("Буфер сохранения SaveGame не пуст"), SaveData.Num() > 0);

    const FString SaveFilePath = FPaths::ProjectSavedDir() / TEXT("SaveGames/FicsitAI_SpikeS1_Test.sav");
    TestTrue(TEXT("Файл .sav успешно записан на диск"), FFileHelper::SaveArrayToFile(SaveData, *SaveFilePath));
    TestTrue(TEXT("Файл .sav существует на диске"), FPaths::FileExists(SaveFilePath));

    // 5. Загрузка файла .sav в НОВЫЙ экземпляр подсистемы (новый мир/сессия)
    AFicsitAISubsystem* SubsystemB = NewObject<AFicsitAISubsystem>();
    TestTrue(TEXT("Новая подсистема изначально не имеет SaveId"), SubsystemB->GetSaveId().IsEmpty());

    TArray<uint8> LoadedData;
    TestTrue(TEXT("Файл .sav успешно прочитан с диска"), FFileHelper::LoadFileToArray(LoadedData, *SaveFilePath));
    FMemoryReader MemReader(LoadedData, true);
    MemReader.ArIsSaveGame = true;
    SubsystemB->Serialize(MemReader);
    SubsystemB->PostLoadGame_Implementation(0, 0);

    TestEqual(TEXT("SaveId восстановлен из файла .sav"), SubsystemB->GetSaveId(), TestSaveId);
    const FString RestoredRawState = SubsystemB->GetModuleState(TestSaveId, FName(TEXT("Notes")));
    TestFalse(TEXT("Состояние Notes восстановлено из файла .sav"), RestoredRawState.IsEmpty());

    // 6. Создаём терминал B в новом мире/сохранении и открываем Notes
    // Состояние должно восстановиться автоматически из файла .sav без ручного переноса (AC-14, §1.4 P-7)
    AFicsitAITerminal* TerminalB = NewObject<AFicsitAITerminal>();
    TerminalB->SetCustomSubsystem(SubsystemB);
    TerminalB->SetPowerOverride(true);
    TerminalB->InitializeHost();

    TestTrue(TEXT("TerminalB открывает Notes"), TerminalB->OpenModule(FName(TEXT("Notes"))));
    TestEqual(TEXT("TerminalB активен Notes"), TerminalB->GetActiveModuleId(), FName(TEXT("Notes")));

    UFicsitAITestNotesModule* NotesB = Cast<UFicsitAITestNotesModule>(TerminalB->GetActiveModuleInstance().GetObject());
    TestNotNull(TEXT("Экземпляр NotesB валиден"), NotesB);
    if (NotesB)
    {
        TestEqual(TEXT("TerminalB полностью восстановил кавычки и переводы строк из файла .sav"), NotesB->GetNoteContent(), ComplexNoteText);
    }

    // 7. Негативный тест: отказ несовместимого модуля сохраняет активный экран (Gs-15 раунд 3, пункт 3)
    TestFalse(TEXT("TerminalB отклоняет несовместимый модуль"), TerminalB->OpenModule(FName(TEXT("Incompatible"))));
    TestEqual(TEXT("После отклонения несовместимого модуля Notes остаётся активным на TerminalB"), TerminalB->GetActiveModuleId(), FName(TEXT("Notes")));

    // 8. Переключение между модулями на TerminalB
    TestTrue(TEXT("TerminalB переключается на Status"), TerminalB->OpenModule(FName(TEXT("Status"))));
    TestEqual(TEXT("TerminalB активен Status"), TerminalB->GetActiveModuleId(), FName(TEXT("Status")));

    TestTrue(TEXT("TerminalB возвращается на Notes"), TerminalB->OpenModule(FName(TEXT("Notes"))));
    NotesB = Cast<UFicsitAITestNotesModule>(TerminalB->GetActiveModuleInstance().GetObject());
    if (NotesB)
    {
        TestEqual(TEXT("Содержимое сложной заметки сохранено при переключении модулей"), NotesB->GetNoteContent(), ComplexNoteText);
    }

    // 9. Закрытие терминалов и очистка
    TerminalA->CloseActiveModule();
    TerminalB->CloseActiveModule();
    TerminalClient->CloseActiveModule();
    SubsystemA->UnregisterTerminal(TerminalA);
    SubsystemB->UnregisterTerminal(TerminalB);
    TestEqual(TEXT("TerminalA закрыт"), TerminalA->GetActiveModuleId(), NAME_None);
    TestEqual(TEXT("TerminalB закрыт"), TerminalB->GetActiveModuleId(), NAME_None);

    // Удаляем временный тестовый файл .sav
    IFileManager::Get().Delete(*SaveFilePath);

    return true;
}

#endif
