#include "GameFacade/Terminal/FicsitAISubsystem.h"
#include "Kismet/GameplayStatics.h"
#include "Misc/CommandLine.h"

DEFINE_LOG_CATEGORY(LogFicsitAISubsystem);

AFicsitAISubsystem::AFicsitAISubsystem()
{
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
}

void AFicsitAISubsystem::PreSaveGame_Implementation(int32 SaveVersion, int32 GameVersion)
{
    UE_LOG(LogFicsitAISubsystem, Verbose, TEXT("PreSaveGame: сохранение состояния FicsitAI (SaveId: %s)"), *SaveId);
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
