#include "CatalogProvider.h"

#include "Containers/StringConv.h"
#include "Misc/SecureHash.h"

namespace FicsitAI::Catalog
{
namespace
{
class FRevisionWriter
{
public:
    template <typename ValueType>
    void Add(const ValueType& Value)
    {
        Hash.Update(Value);
    }

    void AddText(const FString& Value)
    {
        const FTCHARToUTF8 Utf8(*Value);
        Add(Utf8.Length());
        Hash.Update(reinterpret_cast<const uint8*>(Utf8.Get()), Utf8.Length());
    }

    template <typename ValueType>
    void AddOptional(const TOptional<ValueType>& Value)
    {
        Add(Value.IsSet());
        if (Value.IsSet())
        {
            Add(Value.GetValue());
        }
    }

    uint64 Finish()
    {
        const FSHAHash Digest = Hash.Finalize();
        uint64 Revision = 0;
        for (int32 Index = 0; Index < 7; ++Index)
        {
            Revision = (Revision << 8) | Digest.Hash[Index];
        }
        // The contract carries a JSON number. Keep it exact in JavaScript clients.
        Revision &= (1ull << 53) - 1;
        return Revision == 0 ? 1 : Revision;
    }

private:
    FSHA1 Hash;
};

template <typename Row, typename Key, typename Write>
void WriteSorted(FRevisionWriter& Writer, const TArray<Row>& Rows, Key GetPath, Write WriteRow)
{
    TArray<const Row*> Ordered;
    Ordered.Reserve(Rows.Num());
    for (const Row& Value : Rows)
    {
        Ordered.Add(&Value);
    }
    Ordered.Sort([&GetPath](const Row& Left, const Row& Right)
    {
        return GetPath(Left).Compare(GetPath(Right), ESearchCase::CaseSensitive) < 0;
    });

    Writer.Add(Ordered.Num());
    for (const Row* Value : Ordered)
    {
        WriteRow(*Value);
    }
}

void WriteClassIds(FRevisionWriter& Writer, const TArray<FClassId>& Ids)
{
    WriteSorted(Writer, Ids, [](const FClassId& Id) -> const FString& { return Id.ClassPath; },
        [&Writer](const FClassId& Id) { Writer.AddText(Id.ClassPath); });
}

void WriteAmounts(FRevisionWriter& Writer, const TArray<FRecipeAmount>& Amounts)
{
    Writer.Add(Amounts.Num());
    for (const FRecipeAmount& Amount : Amounts)
    {
        Writer.AddText(Amount.Item.ClassPath);
        Writer.Add(static_cast<uint8>(Amount.Quantity.Unit));
        Writer.Add(Amount.Quantity.PerCraft);
        Writer.AddOptional(Amount.Quantity.PerMinute);
    }
}
}

uint64 ComputeCatalogRevision(const FSnapshot& Snapshot)
{
    FRevisionWriter Writer;
    Writer.AddOptional(Snapshot.PartsCostMultiplier);

    // Display labels are localized separately. Use full paths as stable class identities.
    const auto ClassPath = [](const auto& Entry) -> const FString& { return Entry.Id.ClassPath; };
    WriteSorted(Writer, Snapshot.Recipes, ClassPath, [&Writer](const FRecipe& Recipe)
    {
        Writer.AddText(Recipe.Id.ClassPath);
        Writer.AddText(Recipe.OwnerMod.ToString());
        Writer.Add(Recipe.bIsVanilla);
        Writer.Add(Recipe.bIsAlternate);
        Writer.Add(Recipe.bUnlocked);
        Writer.Add(Recipe.DurationSeconds);
        WriteAmounts(Writer, Recipe.Ingredients);
        WriteAmounts(Writer, Recipe.Products);
        WriteClassIds(Writer, Recipe.ProducedIn);
    });
    WriteSorted(Writer, Snapshot.Items, ClassPath, [&Writer](const FItem& Item)
    {
        Writer.AddText(Item.Id.ClassPath);
        Writer.AddText(Item.OwnerMod.ToString());
        Writer.AddOptional(Item.Unit);
        Writer.Add(Item.bIsVanilla);
        Writer.Add(Item.bUnlocked);
        Writer.Add(Item.bIsBuildingDescriptor);
    });
    WriteSorted(Writer, Snapshot.Buildings, ClassPath, [&Writer](const FBuilding& Building)
    {
        Writer.AddText(Building.Id.ClassPath);
        WriteClassIds(Writer, Building.Descriptors);
        Writer.AddOptional(Building.DefaultProducingPowerConsumptionMW);
        Writer.Add(Building.bBuildable);
    });
    return Writer.Finish();
}
}
