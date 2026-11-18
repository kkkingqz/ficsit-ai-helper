#pragma once

#include "CoreMinimal.h"
#include "Misc/Crc.h"
#include "UObject/ObjectKey.h"

class AActor;

namespace FicsitAI::Lines { class FFicsitAILineRegistry; }

namespace FicsitAI::Buildings
{
struct FEntry
{
    FString BuildingId;
    FName ClassName;
    FString ClassPath;
    FVector Position = FVector::ZeroVector;
    TWeakObjectPtr<AActor> Actor;
    // Resolved from the line registry when read; never an independent assignment.
    FString LineId;
};

template<typename ValueType>
struct TBuildingIdKeyFuncs : BaseKeyFuncs<TPair<FString, ValueType>, FString, false>
{
    using Super = BaseKeyFuncs<TPair<FString, ValueType>, FString, false>;
    using typename Super::KeyInitType;
    using typename Super::ElementInitType;
    static KeyInitType GetSetKey(ElementInitType Element) { return Element.Key; }
    static bool Matches(KeyInitType A, KeyInitType B) { return A.Equals(B, ESearchCase::CaseSensitive); }
    static uint32 GetKeyHash(KeyInitType Key) { return FCrc::StrCrc32(*Key); }
};

/** Game-thread-only identity index. It never keeps actors alive or samples production values. */
class FIndex
{
public:
    explicit FIndex(Lines::FFicsitAILineRegistry* InLines = nullptr) : Lines(InLines) {}
    bool Upsert(FEntry Entry);
    bool RemoveActor(AActor* Actor);
    TOptional<FEntry> Find(const FString& BuildingId) const;
    // Visitor must not mutate the index.
    void ForEach(TFunctionRef<void(const FEntry&)> Visitor) const;
    int32 Num() const { return Entries.Num(); }
    // Clearing a session does not dismantle its saved buildings or erase line membership.
    void Reset();
    // The registry must outlive its attachment. The caller retains ownership.
    void SetLineRegistry(Lines::FFicsitAILineRegistry* InLines) { Lines = InLines; }

private:
    void DetachLine(const FString& BuildingId);
    FEntry WithLine(const FEntry& Entry) const;

    struct FStoredEntry
    {
        FEntry Entry;
        TObjectKey<AActor> ActorKey;
    };
    TMap<FString, FStoredEntry, FDefaultSetAllocator, TBuildingIdKeyFuncs<FStoredEntry>> Entries;
    TMap<TObjectKey<AActor>, FString> IdByActor;
    Lines::FFicsitAILineRegistry* Lines;
};
}
