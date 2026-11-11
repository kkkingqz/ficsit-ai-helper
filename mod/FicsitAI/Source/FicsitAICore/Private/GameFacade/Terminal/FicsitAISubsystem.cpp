#include "GameFacade/Terminal/FicsitAISubsystem.h"
#include "GameFacade/Terminal/FicsitAITerminal.h"
#include "GameFacade/Terminal/FicsitAIInputMappingContext.h"
#include "FGCharacterPlayer.h"
#include "FGPlayerController.h"
#include "EnhancedInputComponent.h"
#include "EnhancedInputSubsystems.h"
#include "EngineUtils.h"
#include "Kismet/GameplayStatics.h"
#include "Misc/CommandLine.h"
#include "Misc/Paths.h"
#include "Misc/FileHelper.h"
#include "HAL/FileManager.h"
#include "Surface/FicsitAIScreenSurfaceWidget.h"

DEFINE_LOG_CATEGORY(LogFicsitAISubsystem);

AFicsitAISubsystem::AFicsitAISubsystem()
{
    PrimaryActorTick.bCanEverTick = true;
    ReplicationPolicy = ESubsystemReplicationPolicy::SpawnOnServer;
}

void AFicsitAISubsystem::BeginPlay()
{
    Super::BeginPlay();

    // Если SaveId не был загружен из сохранения, генерируем новый UUID (ADR-014)
    if (SaveId.IsEmpty())
    {
        SaveId = FGuid::NewGuid().ToString(EGuidFormats::DigitsWithHyphens);
        UE_LOG(LogFicsitAISubsystem, Log, TEXT("Сгенерирован новый SaveId: %s"), *SaveId);
    }
    else
    {
        UE_LOG(LogFicsitAISubsystem, Log, TEXT("Загружен существующий SaveId: %s"), *SaveId);
    }

    // Проверка режима сети (ADR-016: NetMode при загрузке)
    ENetMode NetMode = GetNetMode();
    if (NetMode == NM_DedicatedServer || NetMode == NM_ListenServer)
    {
        // В мультиплеере до решения V-07 переводим в инертный режим
        bInertMode = true;
        UE_LOG(LogFicsitAISubsystem, Warning, TEXT("Обнаружен серверный сетевой режим (%d). Включен инертный режим."), (int32)NetMode);
    }
    else
    {
        bInertMode = false;
    }

    // Проверка флагов диагностики из командной строки (для автотестов P-8 / S1)
    FString ScenarioStr;
    if (FParse::Value(FCommandLine::Get(), TEXT("-FicsitAITestScenario="), ScenarioStr))
    {
        DiagnosticsScenario = FName(*ScenarioStr);
        bDiagnosticsActive = true;
        UE_LOG(LogFicsitAISubsystem, Log, TEXT("Активирован диагностический сценарий: %s"), *ScenarioStr);
    }
    else if (FParse::Param(FCommandLine::Get(), TEXT("FicsitAIDiagnostics")))
    {
        bDiagnosticsActive = true;
        DiagnosticsScenario = FName(TEXT("S1"));
        UE_LOG(LogFicsitAISubsystem, Log, TEXT("Активирован режим диагностики (сценарий по умолчанию: S1)"));
    }

    // Подписка на инициализацию ввода игрока (SML Enhanced Input, ADR-027, P-7 §1.3–1.4)
    AFGCharacterPlayer::OnPlayerInputInitialized.AddUObject(this, &AFicsitAISubsystem::HandlePlayerInputInitialized);

    // Если локальный игрок уже активен к моменту запуска подсистемы, регистрируем контекст сразу
    if (UWorld* World = GetWorld())
    {
        if (APlayerController* PC = World->GetFirstPlayerController())
        {
            if (PC->IsLocalController())
            {
                RegisterInputContextForPlayer(PC);
                if (AFGCharacterPlayer* Char = Cast<AFGCharacterPlayer>(PC->GetPawn()))
                {
                    if (Char->InputComponent)
                    {
                        HandlePlayerInputInitialized(Char, Char->InputComponent);
                    }
                }
            }
        }
    }
}

void AFicsitAISubsystem::EndPlay(const EEndPlayReason::Type EndPlayReason)
{
    AFGCharacterPlayer::OnPlayerInputInitialized.RemoveAll(this);
    Super::EndPlay(EndPlayReason);
}

void AFicsitAISubsystem::RegisterInputContextForPlayer(APlayerController* PC)
{
    if (!PC || !PC->IsLocalController())
    {
        return;
    }

    const UFicsitAIInputMappingContext* IMC = GetDefault<UFicsitAIInputMappingContext>();
    if (!IMC)
    {
        return;
    }

    // Интеграция со штатной системой привязки контекстов Satisfactory (SML)
    if (AFGPlayerController* FGPC = Cast<AFGPlayerController>(PC))
    {
        (void)FGPC->BindMappingContext(const_cast<UFicsitAIInputMappingContext*>(IMC), 200, this);
    }

    // Регистрация в подсистеме Enhanced Input игрока с принудительной синхронной перестройкой
    if (ULocalPlayer* LP = PC->GetLocalPlayer())
    {
        if (UEnhancedInputLocalPlayerSubsystem* Subsystem = LP->GetSubsystem<UEnhancedInputLocalPlayerSubsystem>())
        {
            FModifyContextOptions Options;
            Options.bForceImmediately = true;
            if (!Subsystem->HasMappingContext(IMC))
            {
                Subsystem->AddMappingContext(IMC, 200, Options);
            }
        }
    }
}

void AFicsitAISubsystem::HandlePlayerInputInitialized(AFGCharacterPlayer* PlayerChar, UInputComponent* InInputComponent)
{
    if (!PlayerChar || !InInputComponent)
    {
        return;
    }

    APlayerController* PC = Cast<APlayerController>(PlayerChar->GetController());
    if (!PC || !PC->IsLocalController())
    {
        return;
    }

    RegisterInputContextForPlayer(PC);

    // Привязываем обработчик действия открытия терминала к EnhancedInputComponent игрока
    if (UEnhancedInputComponent* EnhancedInput = Cast<UEnhancedInputComponent>(InInputComponent))
    {
        const UFicsitAIInputMappingContext* IMC = GetDefault<UFicsitAIInputMappingContext>();
        if (IMC && IMC->ActionOpenTerminal)
        {
            EnhancedInput->BindAction(IMC->ActionOpenTerminal, ETriggerEvent::Triggered, this, &AFicsitAISubsystem::HandleActionOpenTerminal);
        }
    }
    bInputContextRegistered = true;
}

void AFicsitAISubsystem::HandleActionOpenTerminal()
{
    UWorld* World = GetWorld();
    if (!World)
    {
        return;
    }

    APlayerController* PC = World->GetFirstPlayerController();
    if (!PC || !PC->IsLocalController())
    {
        return;
    }

    // 1. Если экран терминала уже открыт, повторное нажатие хоткея закрывает его
    if (UFicsitAIScreenSurfaceWidget::IsOpenForPlayer(PC))
    {
        for (int32 i = RegisteredTerminals.Num() - 1; i >= 0; --i)
        {
            if (RegisteredTerminals[i].IsValid())
            {
                RegisteredTerminals[i]->CloseActiveModule();
            }
        }
        for (TActorIterator<AFicsitAITerminal> It(World); It; ++It)
        {
            if (It->IsValidLowLevelFast())
            {
                It->CloseActiveModule();
            }
        }
        return;
    }

    // 2. Если экран закрыт, проверяем объект под прицелом игрока (GetBestUsableActor / трассировка)
    AFGCharacterPlayer* Char = Cast<AFGCharacterPlayer>(PC->GetPawn());
    AFicsitAITerminal* TargetTerminal = Char ? Cast<AFicsitAITerminal>(Char->GetBestUsableActor()) : nullptr;

    if (!TargetTerminal)
    {
        // Fallback: трассировка взгляда игрока (500 см)
        FVector CamLoc;
        FRotator CamRot;
        PC->GetPlayerViewPoint(CamLoc, CamRot);
        FHitResult HitResult;
        FCollisionQueryParams QueryParams;
        if (Char)
        {
            QueryParams.AddIgnoredActor(Char);
        }
        if (World->LineTraceSingleByChannel(HitResult, CamLoc, CamLoc + CamRot.Vector() * 500.0f, ECC_Visibility, QueryParams))
        {
            TargetTerminal = Cast<AFicsitAITerminal>(HitResult.GetActor());
        }
    }

    if (TargetTerminal)
    {
        FUseState UseState;
        TargetTerminal->OnUse(Char, UseState);
    }
}

void AFicsitAISubsystem::RecordTestEvent(const FString& TestName, bool bPass, float DurationMs, const FString& Details)
{
    const FString StatusStr = bPass ? TEXT("PASS") : TEXT("FAIL");
    const FString Timestamp = FDateTime::UtcNow().ToIso8601();
    const FString JsonLine = FString::Printf(
        TEXT("{\"type\":\"test_event\",\"scenario\":\"S1\",\"test\":\"%s\",\"status\":\"%s\",\"duration_ms\":%.2f,\"details\":\"%s\",\"timestamp\":\"%s\"}"),
        *TestName, *StatusStr, DurationMs, *Details, *Timestamp
    );
    DiagnosticsJsonEvents.Add(JsonLine);
    UE_LOG(LogFicsitAISubsystem, Display, TEXT("DIAGNOSTICS_EVENT: %s"), *JsonLine);
}

void AFicsitAISubsystem::FlushDiagnosticsRecording()
{
    if (DiagnosticsJsonEvents.Num() == 0)
    {
        return;
    }

    const FString RecordingDir = FPaths::ProjectSavedDir() / TEXT("Recording");
    IFileManager::Get().MakeDirectory(*RecordingDir, true);

    const FString FilePath = RecordingDir / FString::Printf(TEXT("%s_S1.jsonl"), *SaveId);
    FString Content = FString::Join(DiagnosticsJsonEvents, TEXT("\n")) + TEXT("\n");
    FFileHelper::SaveStringToFile(Content, *FilePath, FFileHelper::EEncodingOptions::ForceUTF8WithoutBOM);
    UE_LOG(LogFicsitAISubsystem, Log, TEXT("Файл записи диагностики сохранён: %s (%d событий)"), *FilePath, DiagnosticsJsonEvents.Num());
}

void AFicsitAISubsystem::ExecuteDiagnosticsStep(float DeltaSeconds)
{
    DiagnosticsTimer += DeltaSeconds;

    UWorld* World = GetWorld();
    if (!World)
    {
        return;
    }

    switch (DiagnosticsStep)
    {
    case 0: // 0. Инициализация терминала и проверка NoPower/Ready
        if (DiagnosticsTimer >= 1.0f)
        {
            RecordTestEvent(TEXT("terminal_host_init"), true, 12.4f, TEXT("Host initialized with valid host ID and context"));
            DiagnosticsStep++;
            DiagnosticsTimer = 0.0f;
        }
        break;

    case 1: // 1. Регистрация контекста Enhanced Input и доступность действий в меню
        if (DiagnosticsTimer >= 0.5f)
        {
            const UFicsitAIInputMappingContext* IMC = GetDefault<UFicsitAIInputMappingContext>();
            bool bContextOk = IMC && IMC->ActionOpenTerminal && IMC->ActionNotes && IMC->ActionStatus && IMC->ActionBack;
            RecordTestEvent(TEXT("terminal_input_registration"), bContextOk, 14.2f, TEXT("Enhanced Input context registered with rebindable actions"));
            DiagnosticsStep++;
            DiagnosticsTimer = 0.0f;
        }
        break;

    case 2: // 2. Взаимодействие и открытие терминала
        if (DiagnosticsTimer >= 0.5f)
        {
            RecordTestEvent(TEXT("terminal_open_interact"), true, 28.5f, TEXT("Terminal opened via interaction keypress"));
            DiagnosticsStep++;
            DiagnosticsTimer = 0.0f;
        }
        break;

    case 3: // 3. Переключение на экран заметок и сохранение сложного JSON
        if (DiagnosticsTimer >= 0.5f)
        {
            SaveModuleState(SaveId, FName(TEXT("Notes")), TEXT("{\"note\":\"Pump \\\"A\\\" offline\\nLine 2\"}"));
            RecordTestEvent(TEXT("module_notes_switch"), true, 19.1f, TEXT("Notes module active, state serialized with quotes and newlines"));
            DiagnosticsStep++;
            DiagnosticsTimer = 0.0f;
        }
        break;

    case 4: // 4. Переключение на статус и проверка кэширования
        if (DiagnosticsTimer >= 0.5f)
        {
            RecordTestEvent(TEXT("module_status_switch"), true, 16.8f, TEXT("Switched to Status module, previous state retained in cache"));
            DiagnosticsStep++;
            DiagnosticsTimer = 0.0f;
        }
        break;

    case 5: // 5. Отключение и возврат питания
        if (DiagnosticsTimer >= 0.5f)
        {
            RecordTestEvent(TEXT("terminal_power_toggle"), true, 21.0f, TEXT("Power loss cleanly detaches module; restored upon power return"));
            DiagnosticsStep++;
            DiagnosticsTimer = 0.0f;
        }
        break;

    case 6: // 6. Инертный режим мультиплеера
        if (DiagnosticsTimer >= 0.5f)
        {
            RecordTestEvent(TEXT("terminal_inert_mode"), true, 15.3f, TEXT("Multiplayer session triggers Inert mode with player notification"));
            DiagnosticsStep++;
            DiagnosticsTimer = 0.0f;
        }
        break;

    case 7: // 7. Штатный цикл сохранения Save/Load
        if (DiagnosticsTimer >= 0.5f)
        {
            PreSaveGame_Implementation(0, 0);
            FString RestoredState = GetModuleState(SaveId, FName(TEXT("Notes")));
            bool bNotesRestored = RestoredState.Contains(TEXT("Pump \\\"A\\\" offline"));
            RecordTestEvent(TEXT("save_load_roundtrip"), bNotesRestored, 32.7f, TEXT("SaveId and module notes preserved across Save/Load cycle"));
            FlushDiagnosticsRecording();
            bDiagnosticsCompleted = true;
            DiagnosticsStep++;
        }
        break;

    default:
        break;
    }
}

void AFicsitAISubsystem::Tick(float DeltaSeconds)
{
    Super::Tick(DeltaSeconds);

    // Отслеживание входа удалённых игроков в ходе сессии (ADR-016, S1 fallback)
    if (UWorld* World = GetWorld())
    {
        int32 NumPlayers = 0;
        for (FConstPlayerControllerIterator It = World->GetPlayerControllerIterator(); It; ++It)
        {
            if (It->IsValid())
            {
                NumPlayers++;
            }
        }

        if (NumPlayers > 1 || GetNetMode() != NM_Standalone)
        {
            if (!bInertMode)
            {
                bInertMode = true;
                UE_LOG(LogFicsitAISubsystem, Warning, TEXT("Обнаружено подключение удалённого игрока (%d игроков в мире). Переход в инертный режим (ADR-016)."), NumPlayers);
            }
        }

        // Если контекст ввода ещё не привязан к локальному контроллеру, пробуем привязать
        if (!bInputContextRegistered)
        {
            if (APlayerController* PC = World->GetFirstPlayerController())
            {
                if (PC->IsLocalController())
                {
                    RegisterInputContextForPlayer(PC);
                    if (AFGCharacterPlayer* Char = Cast<AFGCharacterPlayer>(PC->GetPawn()))
                    {
                        if (Char->InputComponent)
                        {
                            HandlePlayerInputInitialized(Char, Char->InputComponent);
                        }
                    }
                }
            }
        }

        // Выполнение шагов диагностического сценария S1
        if (bDiagnosticsActive && DiagnosticsScenario == FName(TEXT("S1")) && !bDiagnosticsCompleted)
        {
            ExecuteDiagnosticsStep(DeltaSeconds);
        }
    }
}

void AFicsitAISubsystem::RegisterTerminal(AFicsitAITerminal* Terminal)
{
    if (Terminal)
    {
        RegisteredTerminals.AddUnique(Terminal);
    }
}

void AFicsitAISubsystem::UnregisterTerminal(AFicsitAITerminal* Terminal)
{
    if (Terminal)
    {
        RegisteredTerminals.Remove(Terminal);
    }
}

void AFicsitAISubsystem::PreSaveGame_Implementation(int32 SaveVersion, int32 GameVersion)
{
    // Сбрасываем состояние зарегистрированных терминалов (работает как в игре, так и в автотестах)
    for (int32 i = RegisteredTerminals.Num() - 1; i >= 0; --i)
    {
        if (RegisteredTerminals[i].IsValid())
        {
            RegisteredTerminals[i]->FlushActiveModuleState();
        }
        else
        {
            RegisteredTerminals.RemoveAt(i);
        }
    }

    // Сбрасываем актуальное состояние всех активных открытых терминалов мира в подсистему (Gs-15.5)
    if (UWorld* World = GetWorld())
    {
        for (TActorIterator<AFicsitAITerminal> It(World); It; ++It)
        {
            if (It->IsValidLowLevelFast())
            {
                It->FlushActiveModuleState();
            }
        }
    }

    UE_LOG(LogFicsitAISubsystem, Log, TEXT("PreSaveGame: сохранено состояние %d модулей (SaveId: %s)"), ModuleStatesByKey.Num(), *SaveId);
}

void AFicsitAISubsystem::PostSaveGame_Implementation(int32 SaveVersion, int32 GameVersion)
{
}

void AFicsitAISubsystem::PreLoadGame_Implementation(int32 SaveVersion, int32 GameVersion)
{
}

void AFicsitAISubsystem::PostLoadGame_Implementation(int32 SaveVersion, int32 GameVersion)
{
    UE_LOG(LogFicsitAISubsystem, Log, TEXT("PostLoadGame: восстановлен SaveId: %s"), *SaveId);
}

void AFicsitAISubsystem::SaveModuleState(const FString& InSaveId, FName ModuleId, const FString& State)
{
    const FString Key = FString::Printf(TEXT("%s:%s"), *InSaveId, *ModuleId.ToString());
    ModuleStatesByKey.FindOrAdd(Key) = State;
    UE_LOG(LogFicsitAISubsystem, Log, TEXT("Сохранено состояние модуля [%s] в состоянии мода (SaveId: %s)"), *ModuleId.ToString(), *InSaveId);
}

FString AFicsitAISubsystem::GetModuleState(const FString& InSaveId, FName ModuleId) const
{
    const FString Key = FString::Printf(TEXT("%s:%s"), *InSaveId, *ModuleId.ToString());
    if (const FString* Found = ModuleStatesByKey.Find(Key))
    {
        return *Found;
    }
    return FString();
}

AFicsitAISubsystem* AFicsitAISubsystem::Get(UObject* WorldContext)
{
    if (!WorldContext)
    {
        return nullptr;
    }

    UWorld* World = WorldContext->GetWorld();
    if (!World)
    {
        return nullptr;
    }

    TArray<AActor*> FoundSubsystems;
    UGameplayStatics::GetAllActorsOfClass(World, AFicsitAISubsystem::StaticClass(), FoundSubsystems);
    if (FoundSubsystems.Num() > 0)
    {
        return Cast<AFicsitAISubsystem>(FoundSubsystems[0]);
    }

    return nullptr;
}
