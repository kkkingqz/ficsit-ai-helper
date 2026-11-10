#include "GameFacade/Terminal/FicsitAIWorldModule.h"
#include "GameFacade/Terminal/FicsitAISubsystem.h"
#include "GameFacade/Terminal/FicsitAITerminalSchematic.h"
#include "Registry/ModContentRegistry.h"

UFicsitAIWorldModule::UFicsitAIWorldModule()
{
    bRootModule = true;
    ModSubsystems.Add(AFicsitAISubsystem::StaticClass());
    mSchematics.Add(UFicsitAITerminalSchematic::StaticClass());
}

void UFicsitAIWorldModule::DispatchLifecycleEvent(ELifecyclePhase Phase)
{
    Super::DispatchLifecycleEvent(Phase);

    if (Phase == ELifecyclePhase::CONSTRUCTION)
    {
        if (UWorld* World = GetWorld())
        {
            if (UModContentRegistry* Registry = UModContentRegistry::Get(World))
            {
                Registry->RegisterSchematic(FName(TEXT("FicsitAI")), UFicsitAITerminalSchematic::StaticClass());
            }
        }
    }
}
