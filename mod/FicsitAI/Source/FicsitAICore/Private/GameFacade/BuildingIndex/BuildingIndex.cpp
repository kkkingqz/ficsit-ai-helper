#include "BuildingIndex.h"

#include "GameFacade/Lines/FicsitAILineRegistry.h"
#include "GameFramework/Actor.h"
#include "UObject/UObjectGlobals.h"

namespace FicsitAI::Buildings
{
namespace
{
bool FindExactLine(Lines::FFicsitAILineRegistry* Registry, const FString& BuildingId, Lines::FProductionLine& OutLine)
{
    // The existing line prototype compares FString keys without case. Never attribute or remove another ID.
    return Registry && Registry->FindLineForBuilding(BuildingId, OutLine) &&
        OutLine.Members.ContainsByPredicate([&](const Lines::FBuildingRef& Ref) {
            return Ref.BuildingId.Equals(BuildingId, ESearchCase::CaseSensitive);
        });
}
}

FIndex::FIndex(Lines::FFicsitAILineRegistry* InLines) : Lines(InLines)
{
    // Actor default objects can be constructed during loading. Subscribe only on the first game-thread insert.
}

FIndex::~FIndex()
{
    if (GcHandle.IsValid()) FCoreUObjectDelegates::GetPostGarbageCollect().Remove(GcHandle);
}

void FIndex::PruneExpired()
{
    check(IsInGameThread());
    // GC is not a demolition event. Reclaim weak records without erasing saved line assignments.
    for (auto It = Entries.CreateIterator(); It; ++It)
    {
        if (!It.Value().Entry.Actor.IsValid())
        {
            IdByActor.Remove(It.Value().ActorKey);
            It.RemoveCurrent();
        }
    }
    if (Entries.IsEmpty()) Reset();
}

bool FIndex::Upsert(FEntry Entry)
{
    check(IsInGameThread());
    AActor* Actor = Entry.Actor.Get();
    if (!IsValid(Actor) || Entry.BuildingId.IsEmpty() || Entry.ClassName.IsNone() ||
        Entry.ClassPath.IsEmpty() || Entry.Position.ContainsNaN())
    {
        return false;
    }

    const TObjectKey<AActor> ActorKey(Actor);
    if (const FString* PreviousId = IdByActor.Find(ActorKey))
    {
        if (!PreviousId->Equals(Entry.BuildingId, ESearchCase::CaseSensitive))
        {
            const FString OldId = *PreviousId;
            Entries.Remove(OldId);
            DetachLine(OldId);
        }
    }
    if (const FStoredEntry* Previous = Entries.Find(Entry.BuildingId))
    {
        IdByActor.Remove(Previous->ActorKey);
    }
    Entry.LineId.Reset();
    IdByActor.Add(ActorKey, Entry.BuildingId);
    const FString Id = Entry.BuildingId;
    Entries.Add(Id, {MoveTemp(Entry), ActorKey});
    if (!GcHandle.IsValid())
    {
        GcHandle = FCoreUObjectDelegates::GetPostGarbageCollect().AddRaw(this, &FIndex::PruneExpired);
    }
    return true;
}

bool FIndex::RemoveActor(AActor* Actor)
{
    check(IsInGameThread());
    if (!Actor) return false;
    const TObjectKey<AActor> ActorKey(Actor);
    FString Id;
    if (!IdByActor.RemoveAndCopyValue(ActorKey, Id)) return false;
    if (const FStoredEntry* Stored = Entries.Find(Id); Stored && Stored->ActorKey == ActorKey)
    {
        Entries.Remove(Id);
        DetachLine(Id);
        if (Entries.IsEmpty()) Reset();
        return true;
    }
    return false;
}

TOptional<FEntry> FIndex::Find(const FString& BuildingId) const
{
    check(IsInGameThread());
    const FStoredEntry* Stored = Entries.Find(BuildingId);
    return Stored && Stored->Entry.Actor.IsValid()
        ? TOptional<FEntry>(WithLine(Stored->Entry)) : TOptional<FEntry>();
}

void FIndex::ForEach(TFunctionRef<void(const FEntry&)> Visitor) const
{
    check(IsInGameThread());
    // Resolve line assignments once per traversal, not by copying an entire line per building.
    TMap<FString, FString, FDefaultSetAllocator, TBuildingIdKeyFuncs<FString>> LineIds;
    if (Lines)
    {
        for (const auto& Line : Lines->GetAllLines())
        {
            for (const auto& Member : Line.Members) LineIds.Add(Member.BuildingId, Line.LineId);
        }
    }
    for (const auto& Pair : Entries)
    {
        const FEntry& Entry = Pair.Value.Entry;
        if (!Entry.Actor.IsValid()) continue;
        if (!Lines) { Visitor(Entry); continue; }
        FEntry Result = Entry;
        if (const FString* LineId = LineIds.Find(Entry.BuildingId)) Result.LineId = *LineId;
        Visitor(Result);
    }
}

void FIndex::Reset()
{
    check(IsInGameThread());
    Entries.Reset();
    IdByActor.Reset();
    if (GcHandle.IsValid())
    {
        FCoreUObjectDelegates::GetPostGarbageCollect().Remove(GcHandle);
        GcHandle.Reset();
    }
}

void FIndex::DetachLine(const FString& BuildingId)
{
    Lines::FProductionLine Line;
    if (FindExactLine(Lines, BuildingId, Line))
    {
        Lines->RemoveBuildingFromLine(Line.LineId, BuildingId);
    }
}

FEntry FIndex::WithLine(const FEntry& Entry) const
{
    FEntry Result = Entry;
    Lines::FProductionLine Line;
    if (FindExactLine(Lines, Entry.BuildingId, Line)) Result.LineId = Line.LineId;
    return Result;
}
}
