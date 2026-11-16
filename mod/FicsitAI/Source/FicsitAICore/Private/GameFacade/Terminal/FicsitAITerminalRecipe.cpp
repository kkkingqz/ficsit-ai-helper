#include "GameFacade/Terminal/FicsitAITerminalRecipe.h"
#include "GameFacade/Terminal/FicsitAITerminalDescriptor.h"
#include "Equipment/FGBuildGun.h"

UFicsitAITerminalRecipe::UFicsitAITerminalRecipe()
{
    EnsureRecipeConfigured();
}

void UFicsitAITerminalRecipe::EnsureRecipeConfigured()
{
    mDisplayNameOverride = true;
    mDisplayName = NSLOCTEXT("FicsitAI", "TerminalRecipeTitle", "AI Terminal");

    // Выходной продукт — терминал (строительный объект)
    mProduct.Reset();
    mProduct.Add(FItemAmount(UFicsitAITerminalDescriptor::StaticClass(), 1));

    // Инструмент постройки — Build Gun (AFGBuildGun и BP_BuildGun_C)
    mProducedIn.AddUnique(AFGBuildGun::StaticClass());
    mProducedIn.AddUnique(TSoftClassPtr<UObject>(FSoftObjectPath(TEXT("/Game/FactoryGame/Equipment/BuildGun/BP_BuildGun.BP_BuildGun_C"))));
    if (UClass* BPBuildGunClass = LoadClass<UObject>(nullptr, TEXT("/Game/FactoryGame/Equipment/BuildGun/BP_BuildGun.BP_BuildGun_C")))
    {
        mProducedIn.AddUnique(BPBuildGunClass);
    }

    if (mIngredients.Num() == 0)
    {
        if (UClass* IronPlateDesc = LoadClass<UFGItemDescriptor>(nullptr, TEXT("/Game/FactoryGame/Resource/Parts/IronPlate/Desc_IronPlate.Desc_IronPlate_C")))
        {
            mIngredients.Add(FItemAmount(IronPlateDesc, 1));
        }
    }

    mManufactoringDuration = 1.0f;
}
