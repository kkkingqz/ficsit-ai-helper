#pragma once

#include "CoreMinimal.h"

namespace FicsitAI::Lines
{

/**
 * Reference to a building inside a production line (ARCHITECTURE.md §5.7).
 */
struct FBuildingRef
{
    FString BuildingId;
    FName ClassName = NAME_None;

    bool operator==(const FBuildingRef& Other) const
    {
        return BuildingId == Other.BuildingId;
    }
};

/**
 * Production line contract structure (contracts/schemas/line.schema.json).
 */
struct FProductionLine
{
    FString LineId;
    FString SaveId;
    FString Name;
    FString Source = TEXT("manual"); // "manual" or "auto"
    TArray<FBuildingRef> Members;
    FString Notes;
};

} // namespace FicsitAI::Lines
