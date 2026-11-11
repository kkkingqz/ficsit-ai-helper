#include "GameFacade/Lines/FicsitAILineRegistry.h"
#include "Misc/ScopeLock.h"

namespace FicsitAI::Lines
{

void FFicsitAILineRegistry::DetachBuildingFromPreviousLineLocked(const FString& BuildingId, const FString& TargetLineId)
{
    if (const FString* OldLineId = LineIdByBuildingId.Find(BuildingId))
    {
        if (*OldLineId != TargetLineId)
        {
            if (FProductionLine* OldLine = LinesById.Find(*OldLineId))
            {
                OldLine->Members.RemoveAll([&BuildingId](const FBuildingRef& Item) {
                    return Item.BuildingId == BuildingId;
                });
            }
        }
    }
}

bool FFicsitAILineRegistry::RegisterLine(const FProductionLine& Line)
{
    if (Line.LineId.IsEmpty())
    {
        return false;
    }

    // Sanitize members (filter empty BuildingIds and keep unique references)
    FProductionLine SanitizedLine = Line;
    TArray<FBuildingRef> UniqueMembers;
    UniqueMembers.Reserve(Line.Members.Num());
    for (const FBuildingRef& Member : Line.Members)
    {
        if (!Member.BuildingId.IsEmpty())
        {
            UniqueMembers.AddUnique(Member);
        }
    }
    SanitizedLine.Members = MoveTemp(UniqueMembers);

    FScopeLock Lock(&Mutex);

    // If updating an existing line, clear its previous reverse mappings first
    if (const FProductionLine* Existing = LinesById.Find(SanitizedLine.LineId))
    {
        for (const FBuildingRef& OldMember : Existing->Members)
        {
            if (const FString* MappedLineId = LineIdByBuildingId.Find(OldMember.BuildingId))
            {
                if (*MappedLineId == SanitizedLine.LineId)
                {
                    LineIdByBuildingId.Remove(OldMember.BuildingId);
                }
            }
        }
    }

    FProductionLine& StoredLine = LinesById.Add(SanitizedLine.LineId, MoveTemp(SanitizedLine));

    // Transfer any buildings reassigned from other lines so forward/reverse indices stay consistent
    for (const FBuildingRef& Member : StoredLine.Members)
    {
        DetachBuildingFromPreviousLineLocked(Member.BuildingId, StoredLine.LineId);
        LineIdByBuildingId.Add(Member.BuildingId, StoredLine.LineId);
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
            if (const FString* MappedLineId = LineIdByBuildingId.Find(Member.BuildingId))
            {
                if (*MappedLineId == LineId)
                {
                    LineIdByBuildingId.Remove(Member.BuildingId);
                }
            }
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

    DetachBuildingFromPreviousLineLocked(Building.BuildingId, LineId);

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
