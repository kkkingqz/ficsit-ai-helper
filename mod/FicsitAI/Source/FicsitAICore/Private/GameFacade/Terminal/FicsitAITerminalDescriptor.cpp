#include "GameFacade/Terminal/FicsitAITerminalDescriptor.h"
#include "GameFacade/Terminal/FicsitAITerminal.h"
#include "FGBuildCategory.h"

UFicsitAITerminalDescriptor::UFicsitAITerminalDescriptor()
{
    EnsureCategoriesConfigured();
}

void UFicsitAITerminalDescriptor::EnsureCategoriesConfigured()
{
    mBuildableClass = AFicsitAITerminal::StaticClass();
    mUseDisplayNameAndDescription = true;
    mDisplayName = NSLOCTEXT("FicsitAI", "TerminalDescriptorTitle", "AI Terminal");
    mDescription = NSLOCTEXT("FicsitAI", "TerminalDescriptorDesc", "FICSIT AI interactive factory management terminal (10 MW).");

    if (!mCategory)
    {
        mCategory = LoadClass<UFGCategory>(nullptr, TEXT("/Game/FactoryGame/Interface/UI/InGame/BuildMenu/BuildCategories/BC_TradingPost.BC_TradingPost_C"));
    }
    if (mSubCategories.Num() == 0)
    {
        if (UClass* SubCat = LoadClass<UFGCategory>(nullptr, TEXT("/Game/FactoryGame/Interface/UI/InGame/BuildMenu/BuildCategories/Sub_Special/SC_Progression.SC_Progression_C")))
        {
            mSubCategories.Add(SubCat);
        }
    }
}
