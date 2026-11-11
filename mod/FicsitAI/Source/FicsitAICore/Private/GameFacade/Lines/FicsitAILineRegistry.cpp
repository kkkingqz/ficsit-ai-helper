#include "GameFacade/Lines/FicsitAILineRegistry.h"
#include "Misc/ScopeLock.h"

namespace FicsitAI::Lines
{

bool FFicsitAILineRegistry::RegisterLine(const FProductionLine& Line)
{
    if (Line.LineId.IsEmpty())
    {
        return false;
    }

    FScopeLock Lock(&Mutex);

    // If updating existing line, clear previous reverse mapping
    if (const FProductionLine* Existing = LinesById.Find(Line.LineId))
    {
        for (const FBuildingRef& Member : Existing->Members)
        {
            LineIdByBuildingId.Remove(Member.BuildingId);
        }
    }

    LinesById.Add(Line.LineId, Line);

    for (const FBuildingRef& Member : Line.Members)
    {
        if (!Member.BuildingId.IsEmpty())
        {
            LineIdByBuildingId.Add(Member.BuildingId, Line.LineId);
        }
    }

    return true;
}

bool FFicsitAILineRegistry::UnregisterLine(const FString& LineId)
{
    FScopeLock Lock(&Mutex);

    FProductionLine RemovedLine;
    if (LinesById.RemoveAndCopyValue(LineId, RemovedLine))
    {
        for (const FBuildingRef& Member : RemovedLine.Members)
        {
            LineIdByBuildingId.Remove(Member.BuildingId);
        }
        return true;
    }

    return false;
}

bool FFicsitAILineRegistry::AddBuildingToLine(const FString& LineId, const FBuildingRef& Building)
{
    if (LineId.IsEmpty() || Building.BuildingId.IsEmpty())
    {
        return false;
    }

    FScopeLock Lock(&Mutex);

    FProductionLine* Line = LinesById.Find(LineId);
    if (!Line)
    {
        return false;
    }

    // If building is already in another line, remove it from that line
    if (const FString* OldLineId = LineIdByBuildingId.Find(Building.BuildingId))
    {
        if (*OldLineId != LineId)
        {
            if (FProductionLine* OldLine = LinesById.Find(*OldLineId))
            {
                OldLine->Members.RemoveAll([&Building](const FBuildingRef& Item) {
                    return Item.BuildingId == Building.BuildingId;
                });
            }
        }
    }

    Line->Members.AddUnique(Building);
    LineIdByBuildingId.Add(Building.BuildingId, LineId);

    return true;
}

bool FFicsitAILineRegistry::RemoveBuildingFromLine(const FString& LineId, const FString& BuildingId)
{
    if (LineId.IsEmpty() || BuildingId.IsEmpty())
    {
        return false;
    }

    FScopeLock Lock(&Mutex);

    FProductionLine* Line = LinesById.Find(LineId);
    if (!Line)
    {
        return false;
    }

    const int32 Removed = Line->Members.RemoveAll([&BuildingId](const FBuildingRef& Item) {
        return Item.BuildingId == BuildingId;
    });

    if (Removed > 0)
    {
        LineIdByBuildingId.Remove(BuildingId);
        return true;
    }

    return false;
}

bool FFicsitAILineRegistry::FindLineById(const FString& LineId, FProductionLine& OutLine) const
{
    FScopeLock Lock(&Mutex);

    if (const FProductionLine* Found = LinesById.Find(LineId))
    {
        OutLine = *Found;
        return true;
    }

    return false;
}

bool FFicsitAILineRegistry::FindLineForBuilding(const FString& BuildingId, FProductionLine& OutLine) const
{
    FScopeLock Lock(&Mutex);

    if (const FString* LineId = LineIdByBuildingId.Find(BuildingId))
    {
        if (const FProductionLine* Found = LinesById.Find(*LineId))
        {
            OutLine = *Found;
            return true;
        }
    }

    return false;
}

TArray<FProductionLine> FFicsitAILineRegistry::GetAllLines() const
{
    FScopeLock Lock(&Mutex);

    TArray<FProductionLine> Result;
    LinesById.GenerateValueArray(Result);
    return Result;
}

void FFicsitAILineRegistry::Clear()
{
    FScopeLock Lock(&Mutex);
    LinesById.Empty();
    LineIdByBuildingId.Empty();
}

} // namespace FicsitAI::Lines
