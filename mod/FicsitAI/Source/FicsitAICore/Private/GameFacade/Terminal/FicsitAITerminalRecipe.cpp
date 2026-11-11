#include "GameFacade/Terminal/FicsitAITerminalRecipe.h"
#include "GameFacade/Terminal/FicsitAITerminalDescriptor.h"
#include "Equipment/FGBuildGun.h"

UFicsitAITerminalRecipe::UFicsitAITerminalRecipe()
{
    mDisplayNameOverride = true;
    mDisplayName = NSLOCTEXT("FicsitAI", "TerminalRecipeTitle", "AI Terminal");

    // Выходной продукт — терминал (строительный объект)
    mProduct.Add(FItemAmount(UFicsitAITerminalDescriptor::StaticClass(), 1));

    // Инструмент постройки — Build Gun (AFGBuildGun)
    mProducedIn.Add(AFGBuildGun::StaticClass());

    mManufactoringDuration = 1.0f;
}
