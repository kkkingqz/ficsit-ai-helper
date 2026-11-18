#include "../BuildingIndex.h"
#include "GameFacade/Lines/FicsitAILineRegistry.h"
#include "GameFramework/Actor.h"
#include "UObject/StrongObjectPtr.h"
#include "UObject/GarbageCollection.h"

#if WITH_DEV_AUTOMATION_TESTS
#include "Misc/AutomationTest.h"

namespace FicsitAI::Buildings
{
namespace
{
FEntry MakeEntry(AActor* Actor, const TCHAR* Id)
{
    FEntry Entry;
    Entry.BuildingId = Id;
    Entry.ClassName = TEXT("Build_Constructor_C");
    Entry.ClassPath = TEXT("/Game/FactoryGame/Build_Constructor.Build_Constructor_C");
    Entry.Position = FVector(100, 200, 300);
    Entry.Actor = Actor;
    return Entry;
}
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FBuildingIndexEntriesTest, "FicsitAI.BuildingIndex.Entries",
    EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)

bool FBuildingIndexEntriesTest::RunTest(const FString&)
{
    // Breaks caught: lost insert/update, key case folding, duplicate entries and stale object removals.
    TStrongObjectPtr<AActor> ActorA(NewObject<AActor>());
    TStrongObjectPtr<AActor> ActorB(NewObject<AActor>());
    TStrongObjectPtr<AActor> Replacement(NewObject<AActor>());
    FIndex Index;
    const FString Id = TEXT("Persistent_Level:PersistentLevel.Build_Constructor_C_10");
    TestTrue(TEXT("A complete record is inserted"), Index.Upsert(MakeEntry(ActorA.Get(), *Id)));
    TestEqual(TEXT("There is exactly one building"), Index.Num(), 1);
    TOptional<FEntry> Found = Index.Find(Id);
    TestTrue(TEXT("The inserted building is found"), Found.IsSet());
    if (Found.IsSet())
    {
        TestEqual(TEXT("Position is retained"), Found->Position, FVector(100, 200, 300));
        TestEqual(TEXT("Class path is retained"), Found->ClassPath, FString(TEXT("/Game/FactoryGame/Build_Constructor.Build_Constructor_C")));
        TestEqual(TEXT("Weak object reference is retained"), Found->Actor.Get(), ActorA.Get());
    }
    FEntry Updated = MakeEntry(ActorA.Get(), *Id);
    Updated.Position = FVector(400, 500, 600);
    TestTrue(TEXT("An existing record is updated"), Index.Upsert(Updated));
    TestEqual(TEXT("Updating does not duplicate the actor"), Index.Num(), 1);
    Found = Index.Find(Id);
    if (Found.IsSet()) TestEqual(TEXT("The new position is visible"), Found->Position, FVector(400, 500, 600));

    const FString CaseId = TEXT("persistent_level:persistentlevel.build_constructor_c_10");
    TestTrue(TEXT("A case-distinct ID is independent"), Index.Upsert(MakeEntry(ActorB.Get(), *CaseId)));
    TestEqual(TEXT("Both distinct IDs are indexed"), Index.Num(), 2);
    TestTrue(TEXT("Case-distinct lookup resolves actor B"), Index.Find(CaseId).IsSet() && Index.Find(CaseId)->Actor.Get() == ActorB.Get());

    TestTrue(TEXT("The replacement takes over the same ID"), Index.Upsert(MakeEntry(Replacement.Get(), *Id)));
    TestFalse(TEXT("A late removal of the old object is ignored"), Index.RemoveActor(ActorA.Get()));
    TestTrue(TEXT("The replacement remains indexed"), Index.Find(Id).IsSet() && Index.Find(Id)->Actor.Get() == Replacement.Get());

    TestTrue(TEXT("The same object can change its key"), Index.Upsert(MakeEntry(Replacement.Get(), TEXT("Renamed"))));
    TestFalse(TEXT("The old key is gone"), Index.Find(Id).IsSet());
    TestEqual(TEXT("Renaming does not duplicate a record"), Index.Num(), 2);

    TestFalse(TEXT("Null object is rejected"), Index.Upsert(MakeEntry(nullptr, TEXT("Invalid"))));
    TestFalse(TEXT("An empty ID is rejected"), Index.Upsert(MakeEntry(ActorA.Get(), TEXT(""))));
    TestFalse(TEXT("An unknown object cannot be removed"), Index.RemoveActor(ActorA.Get()));
    TestTrue(TEXT("An indexed object is removed"), Index.RemoveActor(Replacement.Get()));
    TestFalse(TEXT("A duplicate removal is harmless"), Index.RemoveActor(Replacement.Get()));
    TestFalse(TEXT("The removed key cannot be found"), Index.Find(TEXT("Renamed")).IsSet());

    int32 Visited = 0;
    Index.ForEach([&](const FEntry& Entry) { ++Visited; TestEqual(TEXT("Iteration sees the remaining actor"), Entry.Actor.Get(), ActorB.Get()); });
    TestEqual(TEXT("Iteration visits each record once"), Visited, 1);
    Index.Reset();
    TestEqual(TEXT("Reset empties the index"), Index.Num(), 0);
    TestFalse(TEXT("Reset clears reverse lookups"), Index.RemoveActor(ActorB.Get()));
    TWeakObjectPtr<AActor> Weak;
    {
        TStrongObjectPtr<AActor> Temporary(NewObject<AActor>());
        Weak = Temporary.Get();
        Index.Upsert(MakeEntry(Temporary.Get(), TEXT("Temporary")));
    }
    CollectGarbage(RF_NoFlags);
    TestFalse(TEXT("The index does not keep an actor alive"), Weak.IsValid());
    TestFalse(TEXT("A dead actor is not returned"), Index.Find(TEXT("Temporary")).IsSet());
    Visited = 0;
    Index.ForEach([&](const FEntry&) { ++Visited; });
    TestEqual(TEXT("Iteration skips dead weak references"), Visited, 0);
    return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FBuildingIndexLinesTest, "FicsitAI.BuildingIndex.Lines",
    EAutomationTestFlags::EditorContext | EAutomationTestFlags::EngineFilter)

bool FBuildingIndexLinesTest::RunTest(const FString&)
{
    // Breaks caught: stale cached line assignment, missed dismantle cleanup and destructive session reset.
    using namespace FicsitAI::Lines;
    TStrongObjectPtr<AActor> Actor(NewObject<AActor>());
    FFicsitAILineRegistry Lines;
    FProductionLine First; First.LineId = TEXT("line-a"); First.Name = TEXT("A");
    FProductionLine Second; Second.LineId = TEXT("line-b"); Second.Name = TEXT("B");
    Lines.RegisterLine(First); Lines.RegisterLine(Second);
    FIndex Index(&Lines);
    FEntry Entry = MakeEntry(Actor.Get(), TEXT("Machine"));
    Entry.LineId = TEXT("untrusted-cache");
    Index.Upsert(Entry);
    TOptional<FEntry> Found = Index.Find(TEXT("Machine"));
    TestTrue(TEXT("An unassigned building has no cached line"), Found.IsSet() && Found->LineId.IsEmpty());
    Lines.AddBuildingToLine(TEXT("line-a"), {TEXT("Machine"), TEXT("Build_Constructor_C")});
    Found = Index.Find(TEXT("Machine"));
    TestTrue(TEXT("Line assignment is read from its owner"), Found.IsSet() && Found->LineId == TEXT("line-a"));
    Lines.AddBuildingToLine(TEXT("line-b"), {TEXT("Machine"), TEXT("Build_Constructor_C")});
    Found = Index.Find(TEXT("Machine"));
    TestTrue(TEXT("A reassignment is visible without rebuilding the index"), Found.IsSet() && Found->LineId == TEXT("line-b"));

    Index.RemoveActor(Actor.Get());
    FProductionLine Removed;
    TestFalse(TEXT("Dismantling detaches the building from its line"), Lines.FindLineForBuilding(TEXT("Machine"), Removed));
    Lines.FindLineById(TEXT("line-b"), Removed);
    TestEqual(TEXT("The line survives empty"), Removed.Members.Num(), 0);

    Index.Upsert(Entry);
    Lines.AddBuildingToLine(TEXT("line-a"), {TEXT("Machine"), TEXT("Build_Constructor_C")});
    Index.Reset();
    TestTrue(TEXT("Ending a session preserves saved membership"), Lines.FindLineForBuilding(TEXT("Machine"), Removed));
    TestEqual(TEXT("Preserved membership still belongs to line A"), Removed.LineId, FString(TEXT("line-a")));
    return true;
}
}
#endif
