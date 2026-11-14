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
#include "Materials/MaterialInstanceDynamic.h"
#include "Engine/Texture2D.h"

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

    // Проверка плоской поверхности экрана 16:9 на меше с учётом родителя (ADR-030, P-7 §1.1, S8 3.4, Gs-15 раунд 4)
    TestNotNull(TEXT("ScreenMeshComponent существует"), TerminalA->ScreenMeshComponent.Get());
    TestTrue(TEXT("Меш экрана имеет соотношение сторон 16:9 с учётом родителя"), FMath::IsNearlyEqual(TerminalA->GetScreenAspectRatio(), 16.0f / 9.0f, 0.01f));
    if (UStaticMeshComponent* ScreenComp = TerminalA->ScreenMeshComponent.Get())
    {
        // Нормаль плоскости экрана (+Z компонента) направлена наружу (+X терминала), +X=лево->право(-Y), +Y=верх->низ(-Z)
        const FTransform ScreenXform = ScreenComp->GetRelativeTransform();
        const FVector OutwardNormal = ScreenXform.GetRotation().RotateVector(FVector(0.0f, 0.0f, 1.0f));
        const FVector RightDir = ScreenXform.GetRotation().RotateVector(FVector(1.0f, 0.0f, 0.0f));
        const FVector DownDir = ScreenXform.GetRotation().RotateVector(FVector(0.0f, 1.0f, 0.0f));
        TestTrue(TEXT("Нормаль экрана направлена наружу (+X)"), OutwardNormal.Equals(FVector(1.0f, 0.0f, 0.0f), 0.01f));
        TestTrue(TEXT("Ось U направлена слева направо (-Y)"), RightDir.Equals(FVector(0.0f, -1.0f, 0.0f), 0.01f));
        TestTrue(TEXT("Ось V направлена сверху вниз (-Z)"), DownDir.Equals(FVector(0.0f, 0.0f, -1.0f), 0.01f));
        TestEqual(TEXT("Коллизия экрана отвечает на Visibility trace"), ScreenComp->GetCollisionResponseToChannel(ECC_Visibility), ECR_Block);
    }

    // Проверка материала экрана в мире, внешней текстуры (S8 3.4), dirty revision и проекции UV попадания
    TestNotNull(TEXT("WorldScreenMaterial создан на меше экрана"), TerminalA->GetWorldScreenMaterial());
    {
        FVector2D HitUV = FVector2D::ZeroVector;
        // Центр экрана: (25.5, 0.0, 20.0) -> UV=(0.5, 0.5)
        TestTrue(TEXT("Проекция центра экрана в UV"), TerminalA->TryProjectWorldHitToScreenUV(FVector(25.5f, 0.0f, 20.0f), HitUV));
        TestTrue(TEXT("UV центра близок к (0.5, 0.5)"), HitUV.Equals(FVector2D(0.5f, 0.5f), 0.01f));

        // Левый верхний угол (вид от +X: +Y=48, +Z=20+27=47) -> UV=(0, 0)
        TestTrue(TEXT("Проекция левого верхнего угла в UV"), TerminalA->TryProjectWorldHitToScreenUV(FVector(25.5f, 48.0f, 47.0f), HitUV));
        TestTrue(TEXT("UV левого верхнего угла равен (0, 0)"), HitUV.Equals(FVector2D(0.0f, 0.0f), 0.01f));

        // Правый нижний угол (вид от +X: -Y=-48, Z=20-27=-7) -> UV=(1, 1)
        TestTrue(TEXT("Проекция правого нижнего угла в UV"), TerminalA->TryProjectWorldHitToScreenUV(FVector(25.5f, -48.0f, -7.0f), HitUV));
        TestTrue(TEXT("UV правого нижнего угла равен (1, 1)"), HitUV.Equals(FVector2D(1.0f, 1.0f), 0.01f));

        // Точка вне экрана отклоняется
        TestFalse(TEXT("Точка за границей экрана отклоняется"), TerminalA->TryProjectWorldHitToScreenUV(FVector(25.5f, 80.0f, 20.0f), HitUV));
        TestFalse(TEXT("Точка далеко перед плоскостью отклоняется"), TerminalA->TryProjectWorldHitToScreenUV(FVector(40.0f, 0.0f, 20.0f), HitUV));

        // Внешняя текстура (S8 3.4 / BLUI UTexture)
        UTexture2D* DummyExternalTex = UTexture2D::CreateTransient(16, 9, PF_B8G8R8A8);
        const uint64 RevBefore = TerminalA->GetWorldScreenRenderRevision();
        TerminalA->SetWorldScreenTexture(DummyExternalTex);
        TestEqual(TEXT("Внешняя текстура подключена к экрану в мире"), TerminalA->GetWorldScreenTexture(), static_cast<UTexture*>(DummyExternalTex));
        TestTrue(TEXT("SetWorldScreenTexture увеличивает renderRevision"), TerminalA->GetWorldScreenRenderRevision() > RevBefore);
        TerminalA->SetWorldScreenTexture(nullptr);
        TestNull(TEXT("Сброс внешней текстуры очищает ExternalScreenTexture"), Cast<UTexture2D>(TerminalA->GetWorldScreenTexture()));
    }

    // 2.1 Проверка потери и восстановления питания через сеть (Authority & Replication) (ADR-027, AC-01, Gs-15 раунд 4)
    AFicsitAITerminal* TerminalClient = NewObject<AFicsitAITerminal>();
    TerminalClient->SetCustomSubsystem(SubsystemA);
    TerminalClient->InitializeHost();

    // Сервер теряет питание
    TerminalA->SetPowerOverride(false);
    TerminalA->UpdateHostState();
    TestEqual(TEXT("Сервер при потере питания переходит в NoPower"), TerminalA->GetScreenContext().HostState, EFicsitAIHostState::NoPower);
    TestFalse(TEXT("Обесточенный сервер не открывает модули"), TerminalA->OpenModule(FName(TEXT("Notes"))));
    TestFalse(TEXT("Обесточенный терминал не рендерит экран в мире (§6.6)"), TerminalA->RenderWorldScreenIfDirty());
    if (UMaterialInstanceDynamic* Mat = TerminalA->GetWorldScreenMaterial())
    {
        FLinearColor TintVal = FLinearColor::White;
        Mat->GetVectorParameterValue(TEXT("TintColorAndOpacity"), TintVal);
        TestTrue(TEXT("При NoPower экран затемнён в Чёрный"), TintVal.Equals(FLinearColor::Black, 0.01f));
    }

    // Клиент получает реплицированный контекст от сервера
    TerminalClient->SetHostContextForClient(TerminalA->GetScreenContext());
    TerminalClient->OnRep_HostContext();
    TestEqual(TEXT("Клиент реплицирует NoPower от сервера"), TerminalClient->GetScreenContext().HostState, EFicsitAIHostState::NoPower);
    TestFalse(TEXT("Клиент не открывает модули при NoPower"), TerminalClient->OpenModule(FName(TEXT("Notes"))));

    // Сервер восстанавливает питание (10 МВт)
    TerminalA->SetPowerOverride(true);
    TerminalA->UpdateHostState();
    TestEqual(TEXT("Сервер при подаче питания переходит в Ready"), TerminalA->GetScreenContext().HostState, EFicsitAIHostState::Ready);
    if (UMaterialInstanceDynamic* Mat = TerminalA->GetWorldScreenMaterial())
    {
        FLinearColor TintVal = FLinearColor::Black;
        Mat->GetVectorParameterValue(TEXT("TintColorAndOpacity"), TintVal);
        TestTrue(TEXT("При Ready экран подсвечен в Белый"), TintVal.Equals(FLinearColor::White, 0.01f));
    }

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

    // 10. Проверка освобождения ресурсов поверхности в мире и сборки мусора после EndPlay (P1, Gs-59)
    {
        AFicsitAITerminal* GcTerminal = NewObject<AFicsitAITerminal>();
        TestNotNull(TEXT("GcTerminal создан"), GcTerminal);
        GcTerminal->InitializeHost();
        GcTerminal->SetPowerOverride(true);
        GcTerminal->UpdateHostState();
        TestTrue(TEXT("GcTerminal открывает Notes"), GcTerminal->OpenModule(FName(TEXT("Notes"))));

        UFicsitAIScreenSurfaceWidget* SurfaceWidget = GcTerminal->GetWorldSurfaceWidget();
        TestNotNull(TEXT("WorldSurfaceWidget существует на GcTerminal"), SurfaceWidget);

        TWeakObjectPtr<UFicsitAIScreenSurfaceWidget> WeakSurfaceWidget = SurfaceWidget;
        TestTrue(TEXT("WeakSurfaceWidget валиден до EndPlay"), WeakSurfaceWidget.IsValid());

        // Демонтаж терминала
        GcTerminal->EndPlay(EEndPlayReason::Destroyed);
        TestNull(TEXT("GetWorldSurfaceWidget обнулён после EndPlay"), GcTerminal->GetWorldSurfaceWidget());
        TestNull(TEXT("GetWorldScreenRenderTarget обнулён после EndPlay"), GcTerminal->GetWorldScreenRenderTarget());
        TestNull(TEXT("GetWorldScreenMaterial обнулён после EndPlay"), GcTerminal->GetWorldScreenMaterial());

        // Принудительный сбор мусора: Slate <-> UMG цикл должен быть разорван в ReleaseWorldSurfaceResources
        CollectGarbage(GARBAGE_COLLECTION_KEEPFLAGS);
        TestFalse(TEXT("WorldSurfaceWidget успешно собран GC после EndPlay (нет утечки/цикла через SVirtualWindow/SObjectWidget)"), WeakSurfaceWidget.IsValid());
    }

    // 11. Проверка контекста поверхности, фокуса ввода и динамического размера (P2, Gs-59 раунд 2)
    {
        AFicsitAITerminal* ScreenTerm = NewObject<AFicsitAITerminal>();
        ScreenTerm->InitializeHost();
        ScreenTerm->SetPowerOverride(true);
        ScreenTerm->UpdateHostState();

        // 11.1 «меш»: открытие модуля Notes на поверхности в мире
        TestTrue(TEXT("ScreenTerm открывает Notes на меше"), ScreenTerm->OpenModule(FName(TEXT("Notes"))));
        UFicsitAITestNotesModule* NotesMod = Cast<UFicsitAITestNotesModule>(ScreenTerm->GetActiveModuleInstance().GetObject());
        TestNotNull(TEXT("NotesMod создан"), NotesMod);
        UFicsitAIScreenSurfaceWidget* WorldSurface = ScreenTerm->GetWorldSurfaceWidget();
        TestNotNull(TEXT("WorldSurface существует"), WorldSurface);
        TestEqual(TEXT("Модуль привязан к WorldSurface"), WorldSurface->GetActiveModule(), ScreenTerm->GetActiveModuleInstance());
        if (NotesMod)
        {
            TestTrue(TEXT("Контекст на меше: bWorldSurface == true"), NotesMod->GetCurrentContext().bWorldSurface);
            TestEqual(TEXT("Контекст на меше: SizePx соответствует области модуля WorldSurface (1280, 720)"), NotesMod->GetCurrentContext().SizePx, FIntPoint(1280, 720));
            TestTrue(TEXT("Контекст на меше: AspectRatio строго 16:9"), FMath::IsNearlyEqual(NotesMod->GetCurrentContext().AspectRatio, 16.0f / 9.0f, 0.001f));
        }

        // Проверка сохранения контекста поверхности при запросе фокуса ввода (Gs-59 P2)
        ScreenTerm->RequestInputFocus(true);
        if (NotesMod)
        {
            TestTrue(TEXT("После RequestInputFocus(true) bWorldSurface остаётся true"), NotesMod->GetCurrentContext().bWorldSurface);
            TestTrue(TEXT("После RequestInputFocus(true) bHasInputFocus == true"), NotesMod->GetCurrentContext().bHasInputFocus);
            TestEqual(TEXT("После RequestInputFocus(true) SizePx остаётся неизменным (1280, 720)"), NotesMod->GetCurrentContext().SizePx, FIntPoint(1280, 720));
            TestTrue(TEXT("После RequestInputFocus(true) AspectRatio остаётся 16:9"), FMath::IsNearlyEqual(NotesMod->GetCurrentContext().AspectRatio, 16.0f / 9.0f, 0.001f));
        }
        ScreenTerm->RequestInputFocus(false);
        if (NotesMod)
        {
            TestFalse(TEXT("После RequestInputFocus(false) bHasInputFocus == false"), NotesMod->GetCurrentContext().bHasInputFocus);
            TestTrue(TEXT("После RequestInputFocus(false) bWorldSurface остаётся true"), NotesMod->GetCurrentContext().bWorldSurface);
        }

        // 11.2 «E»: открытие интерактивного экрана через OpenInteractiveScreen
        UFicsitAIScreenSurfaceWidget* InteractiveSurface = UFicsitAIScreenSurfaceWidget::CreateForWorldSurface(ScreenTerm);
        InteractiveSurface->SetWorldSurfaceMode(false);
        InteractiveSurface->LayoutInVirtualWindow(FVector2D(1920.0f, 1080.0f));
        ScreenTerm->OpenInteractiveScreen(InteractiveSurface);
        TestTrue(TEXT("ScreenTerm в интерактивном режиме"), ScreenTerm->IsInteractiveScreenOpen());
        TestNull(TEXT("WorldSurface очищен от модуля"), WorldSurface->GetActiveModule().GetObject());
        TestEqual(TEXT("Модуль привязан к интерактивной поверхности"), InteractiveSurface->GetActiveModule(), ScreenTerm->GetActiveModuleInstance());
        if (NotesMod)
        {
            TestFalse(TEXT("Интерактивный контекст: bWorldSurface == false"), NotesMod->GetCurrentContext().bWorldSurface);
            TestEqual(TEXT("Интерактивный контекст: SizePx соответствует области модуля интерактивной поверхности (1880, 936)"), NotesMod->GetCurrentContext().SizePx, FIntPoint(1880, 936));
            TestTrue(TEXT("Интерактивный контекст: AspectRatio соответствует интерактивной поверхности (~2.01)"), FMath::IsNearlyEqual(NotesMod->GetCurrentContext().AspectRatio, 1880.0f / 936.0f, 0.01f));
        }

        // Проверка динамического изменения раскладки поверхности через реальную раскладку Slate (1280x800)
        InteractiveSurface->LayoutInVirtualWindow(FVector2D(1280.0f, 800.0f));
        if (NotesMod)
        {
            TestEqual(TEXT("Размер обновлён по геометрии ModuleContentBox (1240, 656)"), NotesMod->GetCurrentContext().SizePx, FIntPoint(1240, 656));
            TestTrue(TEXT("Соотношение сторон ModuleContentBox обновлено (~1.89)"), FMath::IsNearlyEqual(NotesMod->GetCurrentContext().AspectRatio, 1240.0f / 656.0f, 0.01f));
            TestFalse(TEXT("Интерактивный флаг остаётся false"), NotesMod->GetCurrentContext().bWorldSurface);
        }

        // 11.3 «меш»: закрытие интерактивного экрана через CloseInteractiveScreen
        ScreenTerm->CloseInteractiveScreen();
        TestFalse(TEXT("ScreenTerm вышел из интерактивного режима"), ScreenTerm->IsInteractiveScreenOpen());
        TestNull(TEXT("Интерактивная поверхность очищена от модуля"), InteractiveSurface->GetActiveModule().GetObject());
        TestEqual(TEXT("Модуль вернулся на WorldSurface"), WorldSurface->GetActiveModule(), ScreenTerm->GetActiveModuleInstance());
        if (NotesMod)
        {
            TestTrue(TEXT("После возврата на меш: bWorldSurface == true"), NotesMod->GetCurrentContext().bWorldSurface);
            TestEqual(TEXT("После возврата на меш: SizePx соответствует WorldSurface (1280, 720)"), NotesMod->GetCurrentContext().SizePx, FIntPoint(1280, 720));
            TestTrue(TEXT("После возврата на меш: AspectRatio строго 16:9"), FMath::IsNearlyEqual(NotesMod->GetCurrentContext().AspectRatio, 16.0f / 9.0f, 0.001f));
        }

        ScreenTerm->EndPlay(EEndPlayReason::Destroyed);
    }

    // 12. Проверка двух терминалов в одном мире: независимый интерактивный режим и EndPlay (P1, Gs-59 раунд 2)
    {
        AFicsitAITerminal* TermA = NewObject<AFicsitAITerminal>();
        AFicsitAITerminal* TermB = NewObject<AFicsitAITerminal>();
        TermA->InitializeHost();
        TermB->InitializeHost();
        TermA->SetPowerOverride(true);
        TermB->SetPowerOverride(true);
        TermA->UpdateHostState();
        TermB->UpdateHostState();

        TestTrue(TEXT("TermA открыл Notes"), TermA->OpenModule(FName(TEXT("Notes"))));
        TestTrue(TEXT("TermB открыл Notes"), TermB->OpenModule(FName(TEXT("Notes"))));
        UFicsitAITestNotesModule* NotesA = Cast<UFicsitAITestNotesModule>(TermA->GetActiveModuleInstance().GetObject());
        UFicsitAITestNotesModule* NotesB = Cast<UFicsitAITestNotesModule>(TermB->GetActiveModuleInstance().GetObject());

        TestFalse(TEXT("TermA пока не интерактивен"), TermA->IsInteractiveScreenOpen());
        TestFalse(TEXT("TermB пока не интерактивен"), TermB->IsInteractiveScreenOpen());

        // Открываем экран на TermA
        UFicsitAIScreenSurfaceWidget* SurfaceA = UFicsitAIScreenSurfaceWidget::CreateForWorldSurface(TermA);
        TermA->OpenInteractiveScreen(SurfaceA);

        TestTrue(TEXT("TermA интерактивен"), TermA->IsInteractiveScreenOpen());
        TestFalse(TEXT("TermB НЕ интерактивен при открытом TermA"), TermB->IsInteractiveScreenOpen());
        if (NotesA) { TestFalse(TEXT("NotesA в интерактивном контексте"), NotesA->GetCurrentContext().bWorldSurface); }
        if (NotesB)
        {
            TestTrue(TEXT("NotesB остаётся в мировом контексте"), NotesB->GetCurrentContext().bWorldSurface);
            TestEqual(TEXT("NotesB остаётся в мировом размере раскладки (1280, 720)"), NotesB->GetCurrentContext().SizePx, FIntPoint(1280, 720));
            TestTrue(TEXT("NotesB AspectRatio строго 16:9"), FMath::IsNearlyEqual(NotesB->GetCurrentContext().AspectRatio, 16.0f / 9.0f, 0.001f));
        }
        TestEqual(TEXT("Модуль TermB по-прежнему привязан к WorldSurface B"), TermB->GetWorldSurfaceWidget()->GetActiveModule(), TermB->GetActiveModuleInstance());

        // Демонтируем TermB: это НЕ должно закрывать экран TermA!
        TermB->EndPlay(EEndPlayReason::Destroyed);
        TestTrue(TEXT("Экран TermA остаётся открытым после демонтажа TermB"), TermA->IsInteractiveScreenOpen());
        TestEqual(TEXT("Поверхность SurfaceA по-прежнему держит модуль TermA"), SurfaceA->GetActiveModule(), TermA->GetActiveModuleInstance());

        // Закрываем TermA
        TermA->CloseInteractiveScreen();
        TestFalse(TEXT("TermA закрыт"), TermA->IsInteractiveScreenOpen());
        TestEqual(TEXT("Модуль TermA вернулся на WorldSurface A"), TermA->GetWorldSurfaceWidget()->GetActiveModule(), TermA->GetActiveModuleInstance());
        if (NotesA) { TestTrue(TEXT("NotesA вернулся в мировой контекст"), NotesA->GetCurrentContext().bWorldSurface); }

        TermA->EndPlay(EEndPlayReason::Destroyed);
    }

    // Удаляем временный тестовый файл .sav
    IFileManager::Get().Delete(*SaveFilePath);

    return true;
}

#endif
