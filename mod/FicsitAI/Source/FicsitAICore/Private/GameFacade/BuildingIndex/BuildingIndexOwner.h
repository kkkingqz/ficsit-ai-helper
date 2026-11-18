#pragma once

#include "CoreMinimal.h"
#include "Subsystem/ModSubsystem.h"
#include "BuildingIndex.h"
#include "BuildingIndexOwner.generated.h"

class AFGBuildable;
class AFGBuildableSubsystem;

/** Per-world owner of the persistent actor index. Registration belongs to the SML world module. */
UCLASS()
class AFicsitAIBuildingIndexOwner : public AModSubsystem
{
    GENERATED_BODY()
public:
    AFicsitAIBuildingIndexOwner();
    static AFicsitAIBuildingIndexOwner* Get(const UObject* WorldContext);
    virtual void Tick(float DeltaSeconds) override;
    virtual void EndPlay(const EEndPlayReason::Type Reason) override;

    // Only the active single-player game may initialize/read this index. Game thread only.
    bool TryInitialize();
    const FicsitAI::Buildings::FIndex* GetIndex() const;
    void StopIndex();
    // Borrowed registry must outlive attachment; no registry is created by the index.
    void SetLineRegistry(FicsitAI::Lines::FFicsitAILineRegistry* Lines) { Index.SetLineRegistry(Lines); }

private:
    bool IsModActive() const;
    void AddBuildable(AFGBuildable* Buildable);
    UFUNCTION() void HandleAdded(AFGBuildable* Buildable);
    UFUNCTION() void HandleRemoved(AFGBuildable* Buildable);

    FicsitAI::Buildings::FIndex Index;
    TWeakObjectPtr<AFGBuildableSubsystem> Buildables;
    bool bInitialized = false;
    int32 FailedAttempts = 0;
};
