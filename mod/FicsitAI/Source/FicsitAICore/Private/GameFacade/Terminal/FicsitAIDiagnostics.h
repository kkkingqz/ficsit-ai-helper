#pragma once

#include "CoreMinimal.h"

class UWorld;

namespace FicsitAI::Diagnostics
{

/**
 * Опциональный диагностический сценарий, активируемый исключительно флагом CLI
 * (-FicsitAIDiagnostics=1, -FicsitAITestScenario=S1Screen | P7).
 * В штатном игровом режиме полностью неактивен (§6.9).
 * В соответствии с §13 архитектуры не изменяет игровой мир (ADR-009).
 */
class FFicsitAIDiagnosticsRunner
{
public:
    void Initialize(UWorld* InWorld, FName InScenario);
    void Tick(UWorld* InWorld, float DeltaSeconds);

private:
    void TickScenarioS1Screen(UWorld* InWorld, float DeltaSeconds);
    void TickScenarioP7(UWorld* InWorld, float DeltaSeconds);

    FName Scenario = NAME_None;
    FString SaveId;
    bool bIsMainMenuWorld = false;
    bool bFinished = false;

    float ElapsedSeconds = 0.0f;

    // Состояние P7
    int32 P7Phase = 0;
    float P7PhaseTimer = 0.0f;
    float P7SecondAccumulator = 0.0f;
    TArray<double> P7BaseFrameMs;
    TArray<double> P7TelemetryFrameMs;
    TArray<double> P7CollectMs;
    int32 P7SampledTicks = 0;
};

} // namespace FicsitAI::Diagnostics
