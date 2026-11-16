#include "FicsitAIApiWiring.h"

#include "Engine/World.h"
#include "FicsitAIApiSubsystem.h"
#include "GameFacade/Terminal/FicsitAISubsystem.h"
#include "Subsystem/SubsystemActorManager.h"

namespace
{
constexpr float SyncIntervalSec = 0.5f;
}

bool UFicsitAIApiWiring::ShouldCreateSubsystem(UObject* Outer) const
{
    const UWorld* World = Cast<UWorld>(Outer);
    return World && (World->WorldType == EWorldType::Game || World->WorldType == EWorldType::PIE)
        && Super::ShouldCreateSubsystem(Outer);
}

TStatId UFicsitAIApiWiring::GetStatId() const
{
    RETURN_QUICK_DECLARE_CYCLE_STAT(UFicsitAIApiWiring, STATGROUP_Tickables);
}

void UFicsitAIApiWiring::Tick(float DeltaTime)
{
    SinceSync += DeltaTime;
    if (bSynced && SinceSync < SyncIntervalSec)
    {
        return;
    }
    SinceSync = 0.0f;

    UWorld* World = GetWorld();
    UFicsitAIApiSubsystem* Api = UFicsitAIApiSubsystem::Get(World);
    USubsystemActorManager* Manager = World ? World->GetSubsystem<USubsystemActorManager>() : nullptr;
    const AFicsitAISubsystem* Mod = Manager ? Manager->GetSubsystemActor<AFicsitAISubsystem>() : nullptr;
    if (!Api || !Mod)
    {
        return;
    }

    const FString& SaveId = Mod->GetSaveId();
    const bool bInert = Mod->IsInertMode();
    if (bSynced && SaveId == LastSaveId && bInert == bLastInert)
    {
        return;
    }
    bSynced = true;
    LastSaveId = SaveId;
    bLastInert = bInert;
    Api->SetModState(SaveId, bInert,
        NSLOCTEXT("FicsitAI", "ApiInertReason", "Мультиплеерная сессия: функции FICSIT AI отключены"));
}
