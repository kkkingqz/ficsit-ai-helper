#pragma once

#include "CoreMinimal.h"

class UWorld;

namespace FicsitAI::Diagnostics
{

/**
 * Опциональный диагностический сценарий, активируемый исключительно флагом CLI
 * (-FicsitAIDiagnostics=1, -FicsitAITestScenario=S1Screen).
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

    FName Scenario = NAME_None;
    FString SaveId;
    bool bIsMainMenuWorld = false;
    bool bFinished = false;

    float ElapsedSeconds = 0.0f;
};

} // namespace FicsitAI::Diagnostics
