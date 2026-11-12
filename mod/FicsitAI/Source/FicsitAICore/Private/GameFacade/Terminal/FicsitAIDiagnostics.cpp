#include "GameFacade/Terminal/FicsitAIDiagnostics.h"
#include "GameFacade/Terminal/FicsitAITerminal.h"
#include "GameFacade/Terminal/FicsitAISubsystem.h"
#include "GameFacade/Telemetry/Generators/FicsitAIGeneratorCollector.h"
#include "GameFacade/Telemetry/PowerStorage/FicsitAIPowerStorageCollector.h"
#include "GameFacade/Telemetry/CircuitBreakers/FicsitAICircuitBreakerCollector.h"
#include "GameFacade/Telemetry/ProductionLoad/FicsitAIMachineLoadCollector.h"
#include "Buildables/FGBuildable.h"
#include "Buildables/FGBuildableFactory.h"
#include "Buildables/FGBuildableGenerator.h"
#include "Buildables/FGBuildablePowerStorage.h"
#include "Buildables/FGBuildableCircuitSwitch.h"
#include "FGCharacterPlayer.h"
#include "FGFactoryConnectionComponent.h"
#include "FGPipeConnectionComponent.h"
#include "EngineUtils.h"
#include "Engine/World.h"
#include "Engine/Texture2D.h"
#include "Engine/TextureRenderTarget2D.h"
#include "GameFramework/PlayerController.h"
#include "Kismet/GameplayStatics.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "Misc/CommandLine.h"
#include "Misc/Parse.h"
#include "HAL/PlatformTime.h"

namespace FicsitAI::Diagnostics
{

static void ComputeStatsMs(const TArray<double>& Samples, double& OutMin, double& OutAvg, double& OutP95, double& OutMax)
{
    if (Samples.Num() == 0)
    {
        OutMin = OutAvg = OutP95 = OutMax = 0.0;
        return;
    }
    TArray<double> Sorted = Samples;
    Sorted.Sort();
    double Sum = 0.0;
    for (double V : Sorted)
    {
        Sum += V;
    }
    OutMin = Sorted[0];
    OutMax = Sorted.Last();
    OutAvg = Sum / static_cast<double>(Sorted.Num());
    const int32 P95Idx = FMath::Clamp(FMath::CeilToInt(Sorted.Num() * 0.95) - 1, 0, Sorted.Num() - 1);
    OutP95 = Sorted[P95Idx];
}

void FFicsitAIDiagnosticsRunner::Initialize(UWorld* InWorld, FName InScenario)
{
    Scenario = InScenario;
    ElapsedSeconds = 0.0f;
    bSaveLoadRequested = false;
    bFinished = false;
    S1Stage = 0;
    S1StageTimer = 0.0f;
    P7Phase = 0;
    P7PhaseTimer = 0.0f;
    P7SecondAccumulator = 0.0f;
    P7SampledTicks = 0;
    P7BaseFrameMs.Reset();
    P7TelemetryFrameMs.Reset();
    P7CollectMs.Reset();

    FParse::Value(FCommandLine::Get(), TEXT("-FicsitAISave="), AutoLoadSaveName);
    const FString MapName = InWorld ? InWorld->GetMapName() : FString();
    bIsMainMenuWorld = !MapName.Contains(TEXT("Persistent_Level"));

    UE_LOG(LogFicsitAISubsystem, Display, TEXT("[Diag:%s] Init Map='%s' MainMenu=%d SaveArg='%s'"),
        *Scenario.ToString(), *MapName, bIsMainMenuWorld ? 1 : 0, *AutoLoadSaveName);
}

void FFicsitAIDiagnosticsRunner::TryAutoLoadSave(UWorld* InWorld, float DeltaSeconds)
{
    ElapsedSeconds += DeltaSeconds;
    if (bSaveLoadRequested || AutoLoadSaveName.IsEmpty() || ElapsedSeconds < 1.5f)
    {
        return;
    }
    bSaveLoadRequested = true;
    const FString Options = FString::Printf(TEXT("loadgame=%s"), *AutoLoadSaveName);
    UE_LOG(LogFicsitAISubsystem, Display, TEXT("[Diag:%s] Opening Persistent_Level with '%s'"), *Scenario.ToString(), *Options);
    UGameplayStatics::OpenLevel(InWorld, FName(TEXT("/Game/FactoryGame/Map/GameLevel01/Persistent_Level")), true, Options);
}

void FFicsitAIDiagnosticsRunner::Tick(UWorld* InWorld, float DeltaSeconds)
{
    if (!InWorld || bFinished)
    {
        return;
    }

    if (bIsMainMenuWorld)
    {
        TryAutoLoadSave(InWorld, DeltaSeconds);
        return;
    }

    ElapsedSeconds += DeltaSeconds;
    if (Scenario == FName(TEXT("S1Screen")) || Scenario == FName(TEXT("S1")))
    {
        TickScenarioS1Screen(InWorld, DeltaSeconds);
    }
    else if (Scenario == FName(TEXT("P7")))
    {
        TickScenarioP7(InWorld, DeltaSeconds);
    }
}

void FFicsitAIDiagnosticsRunner::TickScenarioS1Screen(UWorld* InWorld, float DeltaSeconds)
{
    S1StageTimer += DeltaSeconds;

    if (S1Stage == 0)
    {
        if (S1StageTimer < 2.0f)
        {
            return;
        }

        APlayerController* PC = InWorld->GetFirstPlayerController();
        APawn* Pawn = PC ? PC->GetPawn() : nullptr;
        FVector SpawnLoc(0.0f, 0.0f, 200.0f);
        FRotator SpawnRot = FRotator::ZeroRotator;
        if (Pawn)
        {
            const FVector Forward = Pawn->GetActorForwardVector().GetSafeNormal2D();
            SpawnLoc = Pawn->GetActorLocation() + Forward * 250.0f;
            // Поворачиваем экран (+X) лицом к игроку
            SpawnRot = (-Forward).Rotation();
        }

        FActorSpawnParameters SpawnParams;
        SpawnParams.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
        AFicsitAITerminal* Term = InWorld->SpawnActor<AFicsitAITerminal>(AFicsitAITerminal::StaticClass(), SpawnLoc, SpawnRot, SpawnParams);
        if (!Term)
        {
            UE_LOG(LogFicsitAISubsystem, Error, TEXT("[DiagS1Screen] FAIL: SpawnActor<AFicsitAITerminal> returned nullptr"));
            bFinished = true;
            return;
        }

        Term->SetPowerOverride(true);
        Term->InitializeHost();
        Term->UpdateHostState();
        const bool bOpened = Term->OpenModule(FName(TEXT("Status")));
        UE_LOG(LogFicsitAISubsystem, Display, TEXT("[DiagS1Screen] PreRender opened=%d"), bOpened ? 1 : 0);
        if (GLog) { GLog->Flush(); }

        const bool bRenderedNow = Term->RenderWorldScreenIfDirty();
        UE_LOG(LogFicsitAISubsystem, Display, TEXT("[DiagS1Screen] PostRender rendered=%d"), bRenderedNow ? 1 : 0);
        if (GLog) { GLog->Flush(); }

        S1Terminal = Term;
        S1InitialDraws = Term->GetWorldScreenDrawCount();

        UE_LOG(LogFicsitAISubsystem, Display,
            TEXT("[DiagS1Screen] Spawned: aspect=%.4f mat=%s rt=%s opened=%d rendered=%d draws=%llu rev=%llu"),
            Term->GetScreenAspectRatio(),
            Term->GetWorldScreenMaterial() ? *Term->GetWorldScreenMaterial()->GetName() : TEXT("null"),
            Term->GetWorldScreenRenderTarget() ? *FString::Printf(TEXT("%dx%d"), Term->GetWorldScreenRenderTarget()->SizeX, Term->GetWorldScreenRenderTarget()->SizeY) : TEXT("null"),
            bOpened ? 1 : 0, bRenderedNow ? 1 : 0, Term->GetWorldScreenDrawCount(), Term->GetWorldScreenRenderRevision());

        S1Stage = 1;
        S1StageTimer = 0.0f;
        return;
    }

    if (S1Stage == 1)
    {
        // Ждём ~0.5 с в простое и убеждаемся, что без NotifyContentChanged лишних перерисовок нет (S8 3.5)
        if (S1StageTimer < 0.5f)
        {
            return;
        }

        AFicsitAITerminal* Term = S1Terminal.Get();
        if (!Term)
        {
            bFinished = true;
            return;
        }

        const uint64 IdleDraws = Term->GetWorldScreenDrawCount();
        bool bTraceHit = false;
        FVector2D HitUV = FVector2D::ZeroVector;
        if (Term->ScreenMeshComponent)
        {
            const FVector Center = Term->ScreenMeshComponent->GetComponentLocation();
            const FVector Normal = Term->ScreenMeshComponent->GetUpVector(); // Локальный +Z Plane направлен наружу
            const FVector TraceStart = Center + Normal * 100.0f;
            const FVector TraceEnd = Center - Normal * 20.0f;
            FHitResult Hit;
            FCollisionQueryParams QParams(SCENE_QUERY_STAT(FicsitAIS1ScreenTrace), true);
            if (InWorld->LineTraceSingleByChannel(Hit, TraceStart, TraceEnd, ECC_Visibility, QParams) &&
                Hit.GetComponent() == Term->ScreenMeshComponent)
            {
                bTraceHit = Term->TryProjectWorldHitToScreenUV(Hit.Location, HitUV);
            }
        }

        UTexture2D* ExternalTex = UTexture2D::CreateTransient(16, 9, PF_B8G8R8A8);
        Term->SetWorldScreenTexture(ExternalTex);
        const bool bExternalBound = (Term->GetWorldScreenTexture() == ExternalTex);
        Term->SetWorldScreenTexture(nullptr);

        Term->SetPowerOverride(false);
        Term->UpdateHostState();
        const bool bNoPowerRenderBlocked = !Term->RenderWorldScreenIfDirty() && (Term->GetHostState() == EFicsitAIHostState::NoPower);

        UE_LOG(LogFicsitAISubsystem, Display,
            TEXT("[DiagS1Screen] RESULT: idleNoRedraw=%d (draws %llu->%llu) traceHit=%d uv=(%.3f,%.3f) externalTexOk=%d noPowerBlocked=%d"),
            (IdleDraws == S1InitialDraws) ? 1 : 0, S1InitialDraws, IdleDraws,
            bTraceHit ? 1 : 0, HitUV.X, HitUV.Y, bExternalBound ? 1 : 0, bNoPowerRenderBlocked ? 1 : 0);
        if (GLog) { GLog->Flush(); }

        Term->Destroy();
        bFinished = true;
    }
}

void FFicsitAIDiagnosticsRunner::TickScenarioP7(UWorld* InWorld, float DeltaSeconds)
{
    P7PhaseTimer += DeltaSeconds;

    // Фаза 0: 8с прогрев кэшей и стабилизация после загрузки мира
    if (P7Phase == 0)
    {
        if (P7PhaseTimer >= 8.0f)
        {
            int32 TotalBuildables = 0, TotalFactories = 0, TotalGenerators = 0, TotalBatteries = 0, TotalSwitches = 0;
            for (TActorIterator<AFGBuildable> It(InWorld); It; ++It)
            {
                ++TotalBuildables;
                if (It->IsA<AFGBuildableFactory>()) { ++TotalFactories; }
                if (It->IsA<AFGBuildableGenerator>()) { ++TotalGenerators; }
                if (It->IsA<AFGBuildablePowerStorage>()) { ++TotalBatteries; }
                if (It->IsA<AFGBuildableCircuitSwitch>()) { ++TotalSwitches; }
            }
            UE_LOG(LogFicsitAISubsystem, Display,
                TEXT("[DiagP7] WorldScale: buildables=%d factories=%d generators=%d batteries=%d switches=%d"),
                TotalBuildables, TotalFactories, TotalGenerators, TotalBatteries, TotalSwitches);
            P7Phase = 1;
            P7PhaseTimer = 0.0f;
        }
        return;
    }

    // Фаза 1: 8с замера базового GameThread без активных сборщиков
    if (P7Phase == 1)
    {
        P7BaseFrameMs.Add(static_cast<double>(DeltaSeconds) * 1000.0);
        if (P7PhaseTimer >= 8.0f)
        {
            P7Phase = 2;
            P7PhaseTimer = 0.0f;
            P7SecondAccumulator = 1.0f; // первый тик сразу
        }
        return;
    }

    // Фаза 2: 12с тик 1 Гц всех 4 сборщиков телеметрии + замер кадрового времени
    if (P7Phase == 2)
    {
        P7TelemetryFrameMs.Add(static_cast<double>(DeltaSeconds) * 1000.0);
        P7SecondAccumulator += DeltaSeconds;
        if (P7SecondAccumulator >= 1.0f)
        {
            P7SecondAccumulator -= 1.0f;
            const double T0 = FPlatformTime::Seconds();

            TArray<FicsitAI::Telemetry::FGeneratorTelemetryItem> GenItems;
            TArray<FicsitAI::Telemetry::FPowerStorageTelemetryItem> BatItems;
            TArray<FicsitAI::Telemetry::FCircuitBreakerTelemetryItem> SwItems;
            TArray<FicsitAI::Telemetry::FMachineLoadTelemetryItem> MacItems;

            for (TActorIterator<AFGBuildableGenerator> It(InWorld); It; ++It)
            {
                FicsitAI::Telemetry::FGeneratorTelemetryItem Item;
                if (FicsitAI::Telemetry::FFicsitAIGeneratorCollector::Collect(*It, Item)) { GenItems.Add(Item); }
            }
            for (TActorIterator<AFGBuildablePowerStorage> It(InWorld); It; ++It)
            {
                FicsitAI::Telemetry::FPowerStorageTelemetryItem Item;
                if (FicsitAI::Telemetry::FFicsitAIPowerStorageCollector::Collect(*It, Item)) { BatItems.Add(Item); }
            }
            for (TActorIterator<AFGBuildableCircuitSwitch> It(InWorld); It; ++It)
            {
                FicsitAI::Telemetry::FCircuitBreakerTelemetryItem Item;
                if (FicsitAI::Telemetry::FFicsitAICircuitBreakerCollector::Collect(*It, Item)) { SwItems.Add(Item); }
            }
            for (TActorIterator<AFGBuildableFactory> It(InWorld); It; ++It)
            {
                FicsitAI::Telemetry::FMachineLoadTelemetryItem Item;
                if (FicsitAI::Telemetry::FFicsitAIMachineLoadCollector::Collect(*It, Item)) { MacItems.Add(Item); }
            }

            FicsitAI::Telemetry::FGeneratorsTelemetryAggregate GenAgg;
            FicsitAI::Telemetry::FPowerStorageTelemetryAggregate BatAgg;
            FicsitAI::Telemetry::FCircuitBreakersTelemetryAggregate SwAgg;
            FicsitAI::Telemetry::FMachineLoadTelemetryAggregate MacAgg;
            FicsitAI::Telemetry::FFicsitAIGeneratorCollector::Aggregate(GenItems, GenAgg);
            FicsitAI::Telemetry::FFicsitAIPowerStorageCollector::Aggregate(BatItems, BatAgg);
            FicsitAI::Telemetry::FFicsitAICircuitBreakerCollector::Aggregate(SwItems, SwAgg);
            FicsitAI::Telemetry::FFicsitAIMachineLoadCollector::Aggregate(MacItems, MacAgg);

            const double CollectMs = (FPlatformTime::Seconds() - T0) * 1000.0;
            P7CollectMs.Add(CollectMs);
            ++P7SampledTicks;
        }

        if (P7PhaseTimer >= 12.0f)
        {
            P7Phase = 3;
            P7PhaseTimer = 0.0f;
        }
        return;
    }

    // Фаза 3: микрозамеры P-7 §3.4 (ApplyMeshPrimitiveData + BFS конвейеров/труб глубины <= 15)
    if (P7Phase == 3)
    {
        TArray<AFGBuildableFactory*> SampleFactories;
        for (TActorIterator<AFGBuildableFactory> It(InWorld); It; ++It)
        {
            SampleFactories.Add(*It);
            if (SampleFactories.Num() >= 50)
            {
                break;
            }
        }

        TArray<double> CustomDataSamplesMs;
        TArray<double> BfsSamplesMs;
        int32 TotalVisitedAcrossRuns = 0;

        for (AFGBuildableFactory* Factory : SampleFactories)
        {
            if (!IsValid(Factory))
            {
                continue;
            }

            // 3.4.1 Запись пользовательских данных примитива без изменения сохранения
            const FFactoryCustomizationData& OrigCustomData = Factory->GetCustomizationData_Native();
            const double C0 = FPlatformTime::Seconds();
            Factory->ApplyCustomizationData_Native(OrigCustomData);
            CustomDataSamplesMs.Add((FPlatformTime::Seconds() - C0) * 1000.0);

            // 3.4.2 Локальный BFS по связям конвейеров и труб глубины <= 15
            const double B0 = FPlatformTime::Seconds();
            TSet<const AActor*> Visited;
            TArray<TPair<const AActor*, int32>> Queue;
            Visited.Add(Factory);
            Queue.Emplace(Factory, 0);

            int32 Head = 0;
            TArray<UFGFactoryConnectionComponent*> BeltConns;
            TArray<UFGPipeConnectionComponentBase*> PipeConns;
            while (Head < Queue.Num())
            {
                const AActor* CurActor = Queue[Head].Key;
                const int32 Depth = Queue[Head].Value;
                ++Head;
                if (Depth >= 15 || !CurActor)
                {
                    continue;
                }

                BeltConns.Reset();
                CurActor->GetComponents<UFGFactoryConnectionComponent>(BeltConns);
                for (const UFGFactoryConnectionComponent* Conn : BeltConns)
                {
                    if (const UFGFactoryConnectionComponent* Peer = Conn ? Conn->GetConnection() : nullptr)
                    {
                        if (const AActor* PeerOwner = Peer->GetOwner())
                        {
                            if (!Visited.Contains(PeerOwner))
                            {
                                Visited.Add(PeerOwner);
                                Queue.Emplace(PeerOwner, Depth + 1);
                            }
                        }
                    }
                }

                PipeConns.Reset();
                CurActor->GetComponents<UFGPipeConnectionComponentBase>(PipeConns);
                for (const UFGPipeConnectionComponentBase* Pipe : PipeConns)
                {
                    if (const UFGPipeConnectionComponentBase* Peer = Pipe ? Pipe->GetConnection() : nullptr)
                    {
                        if (const AActor* PeerOwner = Peer->GetOwner())
                        {
                            if (!Visited.Contains(PeerOwner))
                            {
                                Visited.Add(PeerOwner);
                                Queue.Emplace(PeerOwner, Depth + 1);
                            }
                        }
                    }
                }
            }
            BfsSamplesMs.Add((FPlatformTime::Seconds() - B0) * 1000.0);
            TotalVisitedAcrossRuns += Visited.Num();
        }

        double BaseMin, BaseAvg, BaseP95, BaseMax;
        double TelMin, TelAvg, TelP95, TelMax;
        double ColMin, ColAvg, ColP95, ColMax;
        double CdMin, CdAvg, CdP95, CdMax;
        double BfsMin, BfsAvg, BfsP95, BfsMax;
        ComputeStatsMs(P7BaseFrameMs, BaseMin, BaseAvg, BaseP95, BaseMax);
        ComputeStatsMs(P7TelemetryFrameMs, TelMin, TelAvg, TelP95, TelMax);
        ComputeStatsMs(P7CollectMs, ColMin, ColAvg, ColP95, ColMax);
        ComputeStatsMs(CustomDataSamplesMs, CdMin, CdAvg, CdP95, CdMax);
        ComputeStatsMs(BfsSamplesMs, BfsMin, BfsAvg, BfsP95, BfsMax);

        const double AvgVisited = SampleFactories.Num() > 0 ? static_cast<double>(TotalVisitedAcrossRuns) / SampleFactories.Num() : 0.0;
        UE_LOG(LogFicsitAISubsystem, Display,
            TEXT("[DiagP7] SUMMARY save='%s' baseFrameAvg=%.3fms (p95=%.3fms n=%d) telFrameAvg=%.3fms (p95=%.3fms delta=%.3fms n=%d) collect1HzAvg=%.3fms (max=%.3fms ticks=%d)"),
            *AutoLoadSaveName, BaseAvg, BaseP95, P7BaseFrameMs.Num(), TelAvg, TelP95, (TelAvg - BaseAvg), P7TelemetryFrameMs.Num(), ColAvg, ColMax, P7SampledTicks);
        UE_LOG(LogFicsitAISubsystem, Display,
            TEXT("[DiagP7] MICRO_3_4 samples=%d customDataAvg=%.4fms (max=%.4fms budget=0.05ms) bfsDepth15Avg=%.4fms (p95=%.4fms max=%.4fms avgNodes=%.1f budget=0.5ms)"),
            SampleFactories.Num(), CdAvg, CdMax, BfsAvg, BfsP95, BfsMax, AvgVisited);
        if (GLog) { GLog->Flush(); }

        bFinished = true;
    }
}

} // namespace FicsitAI::Diagnostics
