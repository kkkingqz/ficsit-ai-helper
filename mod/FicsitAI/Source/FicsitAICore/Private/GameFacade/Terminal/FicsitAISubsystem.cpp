#include "GameFacade/Terminal/FicsitAISubsystem.h"
#include "GameFacade/Terminal/FicsitAITerminal.h"
#include "GameFacade/Terminal/FicsitAIInputMappingContext.h"
#include "FGCharacterPlayer.h"
#include "FGPlayerController.h"
#include "FGUseableInterface.h"
#include "EnhancedInputComponent.h"
#include "EnhancedInputSubsystems.h"
#include "EngineUtils.h"
#include "Engine/World.h"
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
    PrimaryActorTick.bStartWithTickEnabled = true;
    ReplicationPolicy = ESubsystemReplicationPolicy::SpawnOnServer;
}

AFicsitAISubsystem::~AFicsitAISubsystem() = default;

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
        UE_LOG(LogFicsitAISubsystem, Log, TEXT("Активирован диагностический сценарий: %s (автоматические сценарии в мире отложены до готовности OperationRegistry, ARCHITECTURE §13)"), *ScenarioStr);
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
            // Используем Started вместо Triggered, чтобы удержание клавиши не спамило переключение (Gs-15 раунд 6)
            EnhancedInput->BindAction(IMC->ActionOpenTerminal, ETriggerEvent::Started, this, &AFicsitAISubsystem::HandleActionOpenTerminal);
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

    if (UFicsitAIScreenSurfaceWidget::IsOpenForPlayer(PC))
    {
        return;
    }

    AFGCharacterPlayer* Character = Cast<AFGCharacterPlayer>(PC->GetPawn());
    if (Character)
    {
        if (AFicsitAITerminal* Terminal = Cast<AFicsitAITerminal>(Character->GetBestUsableActor()))
        {
            FUseState UseState;
            IFGUseableInterface::Execute_OnUse(Terminal, Character, UseState);
        }
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
