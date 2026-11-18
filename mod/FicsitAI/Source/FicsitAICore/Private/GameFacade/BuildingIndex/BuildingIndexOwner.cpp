#include "BuildingIndexOwner.h"

#include "Buildables/FGBuildable.h"
#include "FGBuildableSubsystem.h"
#include "GameFacade/Terminal/FicsitAISubsystem.h"
#include "Engine/World.h"
#include "HAL/PlatformTime.h"
#include "Subsystem/SubsystemActorManager.h"

DEFINE_LOG_CATEGORY_STATIC(LogFicsitAIBuildingIndex, Log, All);

namespace
{
constexpr int32 MaxBuildingIndexFailedAttempts = 600;
const AFicsitAISubsystem* FindBuildingIndexMod(const UWorld* World)
{
    auto* Manager = World ? World->GetSubsystem<USubsystemActorManager>() : nullptr;
    return Manager ? Manager->GetSubsystemActor<AFicsitAISubsystem>() : nullptr;
}
}

AFicsitAIBuildingIndexOwner::AFicsitAIBuildingIndexOwner()
{
    PrimaryActorTick.bCanEverTick = true;
    PrimaryActorTick.bStartWithTickEnabled = true;
    ReplicationPolicy = ESubsystemReplicationPolicy::SpawnOnServer;
}

AFicsitAIBuildingIndexOwner* AFicsitAIBuildingIndexOwner::Get(const UObject* Context)
{
    const UWorld* World = Context ? Context->GetWorld() : nullptr;
    auto* Manager = World ? World->GetSubsystem<USubsystemActorManager>() : nullptr;
    return Manager ? Manager->GetSubsystemActor<AFicsitAIBuildingIndexOwner>() : nullptr;
}

void AFicsitAIBuildingIndexOwner::Tick(float DeltaSeconds)
{
    Super::Tick(DeltaSeconds);
    const UWorld* World = GetWorld();
    if (!World || !World->HasBegunPlay()) return;

    const auto* Mod = FindBuildingIndexMod(World);
    if (World->GetNetMode() != NM_Standalone || (Mod && Mod->IsInertMode()))
    {
        StopIndex();
        SetActorTickEnabled(false);
        return;
    }
    if (TryInitialize()) return;
    if (++FailedAttempts >= MaxBuildingIndexFailedAttempts)
    {
        UE_LOG(LogFicsitAIBuildingIndex, Warning, TEXT("Building index unavailable after %d frames"), FailedAttempts);
        SetActorTickEnabled(false);
    }
}

bool AFicsitAIBuildingIndexOwner::IsModActive() const
{
    const UWorld* World = GetWorld();
    const auto* Mod = FindBuildingIndexMod(World);
    return World && World->IsGameWorld() && World->HasBegunPlay() &&
        World->GetNetMode() == NM_Standalone && Mod && !Mod->IsInertMode();
}

bool AFicsitAIBuildingIndexOwner::TryInitialize()
{
    check(IsInGameThread());
    if (!IsModActive()) return false;
    if (bInitialized) return true;

    auto* Subsystem = AFGBuildableSubsystem::Get(GetWorld());
    if (!IsValid(Subsystem)) return false;
    Buildables = Subsystem;
    // Subscribe before reading: later construction/demolition cannot fall into a gap.
    Subsystem->mBuildableAddedDelegate.AddUniqueDynamic(this, &ThisClass::HandleAdded);
    Subsystem->mBuildableRemovedDelegate.AddUniqueDynamic(this, &ThisClass::HandleRemoved);
    bInitialized = true;
    const double Start = FPlatformTime::Seconds();
    for (AFGBuildable* Buildable : Subsystem->GetAllBuildablesRef()) AddBuildable(Buildable);
    UE_LOG(LogFicsitAIBuildingIndex, Log, TEXT("Indexed %d persistent actors in %.3f ms"),
        Index.Num(), (FPlatformTime::Seconds() - Start) * 1000);
    FailedAttempts = 0;
    SetActorTickEnabled(false);
    return true;
}

const FicsitAI::Buildings::FIndex* AFicsitAIBuildingIndexOwner::GetIndex() const
{
    check(IsInGameThread());
    return bInitialized && IsModActive() ? &Index : nullptr;
}

void AFicsitAIBuildingIndexOwner::AddBuildable(AFGBuildable* Buildable)
{
    if (!IsValid(Buildable) || Buildable->GetWorld() != GetWorld() ||
        Buildable->GetIsLightweightTemporary() || Buildable->ShouldConvertToLightweight())
    {
        return;
    }
    FicsitAI::Buildings::FEntry Entry;
    Entry.BuildingId = Buildable->GetPathName();
    Entry.ClassName = Buildable->GetClass()->GetFName();
    Entry.ClassPath = Buildable->GetClass()->GetPathName();
    Entry.Position = Buildable->GetActorLocation();
    Entry.Actor = Buildable;
    Index.Upsert(MoveTemp(Entry));
}

void AFicsitAIBuildingIndexOwner::HandleAdded(AFGBuildable* Buildable)
{
    if (!bInitialized) return;
    if (!IsModActive()) { StopIndex(); return; }
    AddBuildable(Buildable);
}

void AFicsitAIBuildingIndexOwner::HandleRemoved(AFGBuildable* Buildable)
{
    if (!bInitialized) return;
    if (!IsModActive()) { StopIndex(); return; }
    // Do not dereference weak references here: removal may already mark the actor for destruction.
    Index.RemoveActor(Buildable);
}

void AFicsitAIBuildingIndexOwner::StopIndex()
{
    check(IsInGameThread());
    if (auto* Subsystem = Buildables.Get())
    {
        Subsystem->mBuildableAddedDelegate.RemoveDynamic(this, &ThisClass::HandleAdded);
        Subsystem->mBuildableRemovedDelegate.RemoveDynamic(this, &ThisClass::HandleRemoved);
    }
    Buildables.Reset();
    bInitialized = false;
    Index.Reset();
}

void AFicsitAIBuildingIndexOwner::EndPlay(const EEndPlayReason::Type Reason)
{
    StopIndex();
    Index.SetLineRegistry(nullptr);
    Super::EndPlay(Reason);
}
