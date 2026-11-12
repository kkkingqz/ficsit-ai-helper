#pragma once

#include "CoreMinimal.h"
#include "GameFacade/Lines/FicsitAILineTypes.h"

namespace FicsitAI::Lines
{

/**
 * Registry prototype for managing and querying production lines and building assignments.
 */
class FICSITAICORE_API FFicsitAILineRegistry
{
public:
    FFicsitAILineRegistry() = default;

    /**
     * Registers or updates a production line.
     */
    bool RegisterLine(const FProductionLine& Line);

    /**
     * Removes a production line by ID.
     */
    bool UnregisterLine(const FString& LineId);

    /**
     * Adds a building to a line.
     */
    bool AddBuildingToLine(const FString& LineId, const FBuildingRef& Building);

    /**
     * Removes a building from a line.
     */
    bool RemoveBuildingFromLine(const FString& LineId, const FString& BuildingId);

    /**
     * Finds a line by ID.
     */
    bool FindLineById(const FString& LineId, FProductionLine& OutLine) const;

    /**
     * Finds the line containing the specified buildingId.
     */
    bool FindLineForBuilding(const FString& BuildingId, FProductionLine& OutLine) const;

    /**
     * Gets all registered lines.
     */
    TArray<FProductionLine> GetAllLines() const;

    /**
     * Clears all lines from the registry.
     */
    void Clear();

private:
    void DetachBuildingFromPreviousLineLocked(const FString& BuildingId, const FString& TargetLineId);

    mutable FCriticalSection Mutex;
    TMap<FString, FProductionLine> LinesById;
    TMap<FString, FString> LineIdByBuildingId;
};

} // namespace FicsitAI::Lines
